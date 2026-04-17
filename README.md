# PANW Prospect Scraper

A Google Sheet + Apps Script that finds prospective Palo Alto Networks customers in Ontario, enriches them with contact data, and writes one Google Doc per prospect with a full account strategy plan and draft outreach emails for CIO / CISO / VP of Security / Director of IT / IT Manager.

No install. No terminal. Runs inside a Google Sheet.

## What it does

1. Queries Apollo.io for Ontario companies with ≤ 1,500 employees that are running a competitor security stack (Fortinet, Check Point, Cisco, Zscaler, CrowdStrike, SentinelOne, Netskope, Cloudflare, Arctic Wolf, Sophos).
2. Skips anyone whose stack already shows PANW / Prisma / Cortex — they're likely existing customers.
3. Pulls contact details for CIO / CISO / VP of Security / Director of IT / IT Manager.
4. Asks Claude Opus 4.7 to produce a per-account strategy: pain hypotheses, PANW product fit, recommended entry point, and a tailored outreach email for each persona.
5. Creates one Google Doc per prospect and logs the link back to a "Results" sheet.

## Getting started

See **[SETUP.md](SETUP.md)** for the step-by-step setup. It's about 5 minutes of copy-paste in your browser — no software to install.

## Files

| File | What it is |
|---|---|
| `apps_script/Code.gs` | The main script you paste into Apps Script |
| `apps_script/appsscript.json` | Permissions manifest |
| `SETUP.md` | Step-by-step setup guide |

## Customizing

All the filters and messaging are inside `Code.gs`:

- **Competitor tech to flag** — `COMPETITOR_TECH_UIDS` near the top.
- **PANW tech to exclude** — `PANW_TECH_UIDS`.
- **Personas to target** — `TARGET_TITLES`.
- **PANW product knowledge / messaging** — the `SYSTEM_PROMPT` constant. Edit this to change tone, talking points, or what Claude emphasizes.

After editing, save the file in Apps Script. Changes take effect on the next Run.

## Caveats to read before real outreach

- Apollo's free tier is stingy: limited monthly credits, no guaranteed verified emails. Expect to get LinkedIn URLs more often than emails.
- "Not a PANW customer" is inferred from tech-stack signals, not ground truth. Cross-check against your CRM before you send anything.
- Claude is instructed not to invent customer names, stats, or case studies. Still — always read drafts before hitting send.
- Each click of **Run** is capped at 6 minutes by Google Apps Script. Keep `Max Prospects Per Run` at 3–5 and run multiple times if you want more.
