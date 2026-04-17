"""Generate per-account strategy documents and outreach emails using Claude.

Uses claude-opus-4-7 with adaptive thinking and prompt caching. The large PANW
product-knowledge system prompt is cached so every account after the first is
~90% cheaper on input tokens.
"""

from __future__ import annotations

from typing import Any

import anthropic
from pydantic import BaseModel, Field

MODEL = "claude-opus-4-7"

SYSTEM_PROMPT = """You are a senior Palo Alto Networks account strategist. \
You build outbound prospect plans for a Territory Account Manager selling into \
mid-market companies (1,500 employees or fewer) in Ontario, Canada.

# Palo Alto Networks product portfolio (reference)

**Network Security**
- NGFW (PA-Series, VM-Series, CN-Series) — next-gen firewalls replacing Fortinet, \
  Check Point, Cisco ASA/Firepower, SonicWall.
- Prisma Access / Prisma SASE — SSE/SASE replacing Zscaler, Netskope, Cloudflare \
  One, Cisco Umbrella.
- Prisma SD-WAN (CloudGenix).

**Cloud Security**
- Prisma Cloud — CNAPP (CSPM + CWPP + CIEM + code security) replacing Wiz, \
  Orca, Lacework, Aqua.

**Security Operations (SecOps)**
- Cortex XDR — EDR/XDR replacing CrowdStrike Falcon, SentinelOne Singularity, \
  Microsoft Defender for Endpoint, Sophos Intercept X.
- Cortex XSIAM — next-gen SIEM + SOAR + XDR, replacing Splunk + Arctic Wolf + \
  legacy MSSP stacks.
- Cortex XSOAR — SOAR automation.
- Unit 42 — IR retainer and threat intel.

**Threat Intelligence**
- Unit 42 IR retainer, threat intel subscriptions.

# Competitor displacement talking points

- **Fortinet** → NGFW refresh fatigue, appliance sprawl, weak cloud posture. \
  Lead with Prisma SASE or PA-Series + WildFire/Advanced Threat Prevention.
- **Check Point** → aging UI, licensing complexity. Lead with NGFW + Panorama.
- **Cisco (ASA/Firepower/Umbrella)** → multi-vendor Cisco stack fatigue. Lead \
  with consolidation story (NGFW + SASE + XDR under one pane).
- **Zscaler / Netskope / Cloudflare** → SSE-only vendors lack full-stack \
  consolidation. Lead with Prisma SASE (network + security + SD-WAN + ZTNA).
- **CrowdStrike / SentinelOne** → EDR-only, weak SIEM/SOAR story. Lead with \
  Cortex XSIAM (XDR + SIEM + SOAR consolidated).
- **Sophos** → mid-market incumbent, weaker threat intel. Lead with Cortex XDR \
  + Unit 42 and NGFW refresh.
- **Arctic Wolf** → MDR-as-a-service with per-seat pricing that balloons. Lead \
  with XSIAM + Unit 42 MDR — own the platform instead of renting an MSSP.

# Persona-specific messaging

- **CIO** — business outcomes: cost consolidation, vendor reduction, staff \
  productivity, board reporting. Frame PANW as "one platform, fewer tools".
- **CISO** — risk outcomes: ransomware readiness, cloud posture, SOC efficacy, \
  IR time-to-contain. Reference Unit 42 threat intel.
- **VP/Director of Security** — operational: alert volume, tool sprawl, MTTD/MTTR. \
  XSIAM consolidation story.
- **Director of IT** — infrastructure: firewall refresh, SASE migration, remote \
  access modernization.
- **IT Manager** — tactical: day-to-day ops, deployment effort, support quality. \
  Keep it practical.

# Email guidance

Every draft email must:
1. Be 90–130 words — Ontario mid-market execs ignore longer.
2. Reference the specific competitor signal detected in their stack (earned trust).
3. Open with a relevant business or security trigger — NOT "I hope this email \
   finds you well".
4. Have a concrete CTA: 15-minute intro, Unit 42 threat briefing, or a specific \
   customer-story reference.
5. Subject line under 7 words, no clickbait, no ALL CAPS.
6. Sign-off: plain. No "Best regards from the Palo Alto Networks team".

Write in plain business English. Canadian spelling. Do not invent customer names, \
statistics, or case studies — if you don't know a verifiable reference, omit it."""


class DraftEmail(BaseModel):
    to_persona: str = Field(description="Persona role (e.g. 'CISO')")
    to_name: str = Field(description="Contact full name if known, else empty string")
    subject: str
    body: str
    rationale: str = Field(description="Why this angle works for this persona")


class AccountStrategy(BaseModel):
    account_summary: str = Field(description="2-3 sentences on the company")
    competitive_landscape: str = Field(
        description="Competitor tech detected and displacement angle"
    )
    pain_hypotheses: list[str] = Field(description="3-5 likely pain points")
    panw_product_fit: list[str] = Field(
        description="Which PANW products fit, with brief rationale each"
    )
    recommended_entry_point: str = Field(
        description="Which product/conversation to lead with"
    )
    strategic_rationale: str = Field(
        description="Why this account will buy — the 'why now' story"
    )
    next_steps: list[str] = Field(description="Concrete next actions for the AM")
    draft_emails: list[DraftEmail] = Field(
        description="One email per identified persona contact"
    )


def build_user_prompt(org: dict[str, Any], contacts: list[dict[str, Any]], competitors: list[str]) -> str:
    tech_names = [t.get("name") for t in org.get("technologies", []) if t.get("name")]
    contacts_summary = "\n".join(
        f"- {c.get('first_name', '')} {c.get('last_name', '')} — {c.get('title', '')} "
        f"(email: {c.get('email') or 'not available'}, "
        f"linkedin: {c.get('linkedin_url') or 'n/a'})"
        for c in contacts
    ) or "No contacts identified yet."

    return f"""Build an account strategy plan for the following prospect.

# Company
- Name: {org.get('name')}
- Website: {org.get('website_url') or org.get('primary_domain') or 'unknown'}
- Industry: {org.get('industry') or 'unknown'}
- Employees: {org.get('estimated_num_employees') or 'unknown'}
- Location: {org.get('city') or ''}, {org.get('state') or ''}, {org.get('country') or ''}
- Short description: {org.get('short_description') or org.get('description') or 'n/a'}

# Tech stack signals
- Full detected stack: {', '.join(tech_names) if tech_names else 'unknown'}
- Competitor security tools detected (basis for "not a PANW customer"): \
{', '.join(competitors) if competitors else 'none detected; infer from stack'}

# Target personas and contacts identified
{contacts_summary}

Produce a complete account strategy plan and a tailored outreach email for \
each named contact above. If a contact was not found for a persona, still \
produce a persona-level email with `to_name` left as an empty string."""


class StrategyGenerator:
    def __init__(self, api_key: str, model: str = MODEL):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = model

    def generate(
        self,
        org: dict[str, Any],
        contacts: list[dict[str, Any]],
        competitors: list[str],
    ) -> AccountStrategy:
        user_prompt = build_user_prompt(org, contacts, competitors)

        response = self.client.messages.parse(
            model=self.model,
            max_tokens=16000,
            thinking={"type": "adaptive"},
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": user_prompt}],
            output_format=AccountStrategy,
        )
        return response.parsed_output
