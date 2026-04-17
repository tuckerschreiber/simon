# PANW Prospect Scraper

Generates account strategy plans for prospective Palo Alto Networks customers
in Ontario, Canada. Pulls companies and contacts from Apollo.io, asks Claude
Opus 4.7 to draft a full plan + per-persona outreach emails, and writes one
`.docx` per prospect.

## What it does

1. Queries Apollo for Ontario companies with ≤ 1,500 employees running a
   competitor security stack (Fortinet, Check Point, Cisco, Zscaler,
   CrowdStrike, SentinelOne, Netskope, Cloudflare, Arctic Wolf, Sophos).
2. Skips anyone whose tech stack shows PANW/Prisma/Cortex — they're probably
   already customers.
3. Pulls CIO / CISO / VP/Director of Security / Director of IT / IT Manager
   contacts at each company.
4. Asks Claude to produce a strategy doc: competitive landscape, pain
   hypotheses, PANW product fit, recommended entry point, draft emails.
5. Writes `output/<company>_account_plan.docx` per prospect.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# edit .env and add APOLLO_API_KEY and ANTHROPIC_API_KEY
```

Get the keys:

- **Apollo**: apollo.io → Settings → Integrations → API. Free tier has ~50
  credits/month and rate-limits API access, so start small.
- **Anthropic**: console.anthropic.com → API Keys.

## Run

```bash
# default: 10 prospects, full pipeline
python src/main.py

# more prospects
python src/main.py --limit 25

# just see what Apollo returns without burning Claude credits
python src/main.py --dry-run
```

Output lands in `./output/` as `<company>_account_plan.docx`. Drag-and-drop
into Google Drive → right-click → "Open with Google Docs" to convert.

## Configuration

All targeting lives at the top of `src/main.py`:

- `TARGET_LOCATIONS` — currently `["Ontario, Canada"]`
- `MAX_EMPLOYEES` — currently `1500`
- `TARGET_TITLES` — persona title list

Competitor tech signals and the "is PANW customer" check are in
`src/apollo_client.py` (`COMPETITOR_TECH_UIDS`, `PANW_TECH_UIDS`).

The PANW product knowledge and messaging style guide that Claude uses is in
`src/strategy_generator.py` (`SYSTEM_PROMPT`). That block is prompt-cached, so
accounts 2–N cost ~90% less on input tokens than account 1.

## Caveats

- Apollo's free tier rate-limits aggressively. If you hit 429s, the client
  backs off automatically, but expect slow runs on high `--limit` values.
- Emails aren't guaranteed — Apollo often returns `email_status: unverified`
  or no email at all on free tier. LinkedIn URLs usually come through.
- Claude is instructed not to invent case studies or statistics, but always
  read drafts before sending.
- "Not a PANW customer" is inferred from tech-stack signals, not ground truth.
  Double-check against your CRM before a real outreach.

## File layout

```
src/
  apollo_client.py        Apollo.io API wrapper + tech-stack filters
  strategy_generator.py   Claude Opus 4.7 call + Pydantic schema
  doc_writer.py           python-docx renderer
  main.py                 Orchestrator / CLI
output/                   Generated .docx files (gitignored)
```
