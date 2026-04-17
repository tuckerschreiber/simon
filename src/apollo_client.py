"""Apollo.io API client for prospect and contact discovery.

Apollo API reference: https://docs.apollo.io/reference/

Free tier notes:
- Limited monthly credits (~50 exports).
- Some filters (e.g. currently_not_using_any_of_technology_uids) may require a
  paid plan. We post-filter in code as a fallback.
"""

from __future__ import annotations

import time
from typing import Any, Iterable

import requests

APOLLO_BASE = "https://api.apollo.io/api/v1"

# Apollo technology UIDs for the competitor signals we want to detect.
# These are the slugs Apollo uses in the `technologies` array returned on org
# records. If a name doesn't resolve, Apollo silently drops it — verify via a
# dry-run search before relying on it.
COMPETITOR_TECH_UIDS = [
    "fortinet",
    "check-point",
    "cisco",
    "zscaler",
    "crowdstrike",
    "sentinelone",
    "netskope",
    "cloudflare",
    "arctic-wolf",
    "sophos",
]

# If any of these appear in the org's tech stack, we assume they're already a
# PANW customer and skip them.
PANW_TECH_UIDS = [
    "palo-alto-networks",
    "prisma-cloud",
    "cortex-xdr",
    "cortex-xsiam",
]


class ApolloClient:
    def __init__(self, api_key: str, rate_limit_sec: float = 1.0):
        self.api_key = api_key
        self.rate_limit_sec = rate_limit_sec
        self._last_call = 0.0

    def _headers(self) -> dict[str, str]:
        return {
            "Cache-Control": "no-cache",
            "Content-Type": "application/json",
            "X-Api-Key": self.api_key,
        }

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_call
        if elapsed < self.rate_limit_sec:
            time.sleep(self.rate_limit_sec - elapsed)
        self._last_call = time.monotonic()

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._throttle()
        resp = requests.post(
            f"{APOLLO_BASE}{path}",
            json=payload,
            headers=self._headers(),
            timeout=30,
        )
        if resp.status_code == 429:
            retry = int(resp.headers.get("retry-after", "30"))
            time.sleep(retry)
            return self._post(path, payload)
        resp.raise_for_status()
        return resp.json()

    def search_companies(
        self,
        locations: Iterable[str],
        max_employees: int,
        competitor_tech_uids: Iterable[str] = COMPETITOR_TECH_UIDS,
        per_page: int = 25,
        max_pages: int = 4,
    ) -> list[dict[str, Any]]:
        """Search for companies matching our prospect criteria.

        Returns the raw Apollo org records so the caller can inspect
        `technologies`, `estimated_num_employees`, `industry`, etc.
        """
        results: list[dict[str, Any]] = []
        for page in range(1, max_pages + 1):
            payload = {
                "organization_locations": list(locations),
                "organization_num_employees_ranges": [f"1,{max_employees}"],
                "currently_using_any_of_technology_uids": list(competitor_tech_uids),
                "page": page,
                "per_page": per_page,
            }
            data = self._post("/mixed_companies/search", payload)
            orgs = data.get("organizations", []) or data.get("accounts", [])
            if not orgs:
                break
            results.extend(orgs)
            pagination = data.get("pagination", {})
            if page >= pagination.get("total_pages", page):
                break
        return results

    def search_people(
        self,
        organization_id: str,
        titles: Iterable[str],
        per_page: int = 10,
    ) -> list[dict[str, Any]]:
        """Find contacts at an org matching the target title list."""
        payload = {
            "organization_ids": [organization_id],
            "person_titles": list(titles),
            "page": 1,
            "per_page": per_page,
        }
        data = self._post("/mixed_people/search", payload)
        return data.get("people", []) or data.get("contacts", [])


def detect_competitor_signals(org: dict[str, Any]) -> list[str]:
    """Return competitor names found in the org's tech stack."""
    techs = [t.get("uid", "").lower() for t in org.get("technologies", [])]
    techs += [t.get("name", "").lower() for t in org.get("technologies", [])]
    found = []
    for uid in COMPETITOR_TECH_UIDS:
        if any(uid in t for t in techs):
            found.append(uid)
    return found


def is_likely_panw_customer(org: dict[str, Any]) -> bool:
    techs = [t.get("uid", "").lower() for t in org.get("technologies", [])]
    techs += [t.get("name", "").lower() for t in org.get("technologies", [])]
    return any(panw in t for panw in PANW_TECH_UIDS for t in techs)
