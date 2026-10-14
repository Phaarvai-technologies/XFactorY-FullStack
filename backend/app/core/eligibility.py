"""Manufacturer eligibility for Visionaries: one place for the rules.

Two separate facts about a manufacturer company (organization):

* APPROVAL  - an X!Y admin approved its submitted company details
              (manufacturer_onboarding.status = 'approved').
* COMPLETE  - its profile meets every required item of the existing completeness check
              (admin_manufacturer_overview.completeness, the 14 required fields, computed by the
              database from saved data; a percentage sent by a client is never used).

Each capability below says which facts it needs. To change a rule later (e.g. let approved
but incomplete manufacturers be found), edit RULES only: the SQL used by Visionary search,
recommendations, profile pages and booking, and the status shown to manufacturers and admins,
are all generated from it.

Onboarding company lookup (manufacturer side, app.repositories.manufacturer.LISTED_COMPANY_SQL)
is deliberately NOT governed by these rules: seeded companies stay selectable there without
becoming visible to Visionaries.
"""
from __future__ import annotations

COMPLETE_PERCENT = 100

# capability -> facts required (all must hold)
RULES: dict[str, tuple[str, ...]] = {
    "visionary_visible": ("approved", "complete"),   # search, recommendations, profile page
    "booking": ("approved", "complete"),             # new booking requests (subject to existing rules)
}

_FACT_SQL = {
    "approved": "elig.onboarding_raw_status = 'approved'",
    "complete": f"elig.completeness >= {COMPLETE_PERCENT}",
}


def sql_condition(capability: str, org_alias: str = "o") -> str:
    """SQL boolean for `capability`, for an organizations row aliased `org_alias`."""
    facts = " AND ".join(_FACT_SQL[f] for f in RULES[capability])
    return (f"EXISTS (SELECT 1 FROM admin_manufacturer_overview elig "
            f"WHERE elig.organization_id = {org_alias}.id AND {facts})")


def evaluate(approval_status: str | None, completeness: int | None) -> dict:
    """The same rules in Python, for status displays (never for access decisions)."""
    facts = {"approved": approval_status == "approved",
             "complete": (completeness or 0) >= COMPLETE_PERCENT}
    return {
        "approved": facts["approved"],
        "complete": facts["complete"],
        "completeness": int(completeness or 0),
        "visibleToVisionaries": all(facts[f] for f in RULES["visionary_visible"]),
        "bookingAvailable": all(facts[f] for f in RULES["booking"]),
    }
