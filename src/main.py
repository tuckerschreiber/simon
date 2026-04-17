"""End-to-end prospect scraper.

1. Query Apollo for Ontario mid-market companies running a competitor security
   stack (i.e. unlikely to be PANW customers today).
2. For each prospect, pull target-persona contacts from Apollo.
3. Ask Claude for a full account strategy + per-persona outreach emails.
4. Write one .docx per prospect to ./output.

Usage:
    python src/main.py                 # default: 10 prospects
    python src/main.py --limit 25      # 25 prospects
    python src/main.py --dry-run       # don't call Claude, just print what
                                       #   Apollo returned
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from apollo_client import (
    ApolloClient,
    detect_competitor_signals,
    is_likely_panw_customer,
)
from doc_writer import write_account_doc
from strategy_generator import StrategyGenerator

TARGET_LOCATIONS = ["Ontario, Canada"]
MAX_EMPLOYEES = 1500
TARGET_TITLES = [
    "CIO",
    "Chief Information Officer",
    "CISO",
    "Chief Information Security Officer",
    "VP of Security",
    "Vice President of Security",
    "Director of Security",
    "Director of Information Security",
    "Director of IT",
    "Director of Information Technology",
    "IT Manager",
]

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"


def run(limit: int, dry_run: bool) -> int:
    load_dotenv()
    apollo_key = os.environ.get("APOLLO_API_KEY")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")

    if not apollo_key:
        print("ERROR: APOLLO_API_KEY not set. Copy .env.example to .env.", file=sys.stderr)
        return 1
    if not dry_run and not anthropic_key:
        print("ERROR: ANTHROPIC_API_KEY not set (required unless --dry-run).", file=sys.stderr)
        return 1

    apollo = ApolloClient(api_key=apollo_key)
    generator = None if dry_run else StrategyGenerator(api_key=anthropic_key)

    print(f"Searching Apollo for Ontario companies (<= {MAX_EMPLOYEES} employees) "
          f"running competitor security stacks...")
    orgs = apollo.search_companies(
        locations=TARGET_LOCATIONS,
        max_employees=MAX_EMPLOYEES,
    )
    print(f"  Apollo returned {len(orgs)} raw candidates.")

    prospects = []
    for org in orgs:
        if is_likely_panw_customer(org):
            continue
        competitors = detect_competitor_signals(org)
        if not competitors:
            continue
        prospects.append((org, competitors))
        if len(prospects) >= limit:
            break
    print(f"  Kept {len(prospects)} prospects after filtering out PANW customers "
          f"and stacks with no competitor signals.")

    if not prospects:
        print("No prospects matched. Try widening the tech filter or employee range.")
        return 0

    generated = 0
    for i, (org, competitors) in enumerate(prospects, 1):
        name = org.get("name", "unknown")
        org_id = org.get("id")
        print(f"\n[{i}/{len(prospects)}] {name} — competitors: {', '.join(competitors)}")

        contacts: list[dict] = []
        if org_id:
            try:
                contacts = apollo.search_people(
                    organization_id=org_id,
                    titles=TARGET_TITLES,
                )
            except Exception as e:
                print(f"  WARN: people search failed for {name}: {e}")
        print(f"  Found {len(contacts)} target-persona contacts.")

        if dry_run:
            for c in contacts:
                print(f"    - {c.get('first_name')} {c.get('last_name')} ({c.get('title')})")
            continue

        try:
            strategy = generator.generate(org, contacts, competitors)
        except Exception as e:
            print(f"  ERROR: Claude generation failed: {e}")
            continue

        path = write_account_doc(org, contacts, competitors, strategy, OUTPUT_DIR)
        print(f"  Wrote {path.name}")
        generated += 1

    print(f"\nDone. Generated {generated} account plan(s) in {OUTPUT_DIR}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=10,
                        help="Max prospects to generate plans for (default: 10)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Fetch from Apollo only; skip Claude + docx generation")
    args = parser.parse_args()
    return run(limit=args.limit, dry_run=args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
