"""Company onboarding source: how a company first came onto X!Y. One place for the rules.

* The source is assigned by the backend only, from the channel that handled the request:
    database_import - app.import_manufacturers (linked to an import_batches row)
    web_dashboard   - an authenticated manufacturer dashboard submission (user from the
                      verified Clerk session)
    admin_entry     - "Add company" in the admin dashboard (administrator / operator roles,
                      checked on the backend; the admin is recorded on the history event)
  A client can never choose or override it: request bodies that carry a source field are
  rejected (reject_client_source).
* It is stored once on organizations.onboarding_source and never changed afterwards (database
  trigger, migration 020). Later changes are recorded on their own submission / history rows
  with their own channel; admin review actions are recorded as 'admin_review', which is never
  an onboarding source.
* NULL means unknown (historical rows without evidence).
* It has nothing to do with HOW a person signs in (Google or email/password).

Unavailable channels (reserved until a verified integration and role checks exist, and a
migration adds them to the database constraints): ai_voice_call, ground_sales.
See ONBOARDING_SOURCES.md.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Source:
    label: str
    available: bool
    note: str


SOURCES: dict[str, Source] = {
    "database_import": Source("Database Import", True, "CSV import job (app.import_manufacturers)"),
    "web_dashboard": Source("Web Dashboard", True, "authenticated manufacturer dashboard submission"),
    "admin_entry": Source("Admin Entry", True, "admin dashboard 'Add company' (administrator / operator)"),
    "ai_voice_call": Source("AI Voice Call", False, "reserved for a verified AI calling integration"),
    "ground_sales": Source("Ground Sales", False, "reserved for a role-protected sales workflow"),
}
# History rows: the channel of the action. 'admin_review' = an admin reviewed / decided.
ADMIN_REVIEW = "admin_review"
UNKNOWN_LABEL = "Unknown"
NOT_APPLICABLE_LABEL = "Not applicable"

# Body keys a client might use to pick a source (camelCase and snake_case).
CLIENT_SOURCE_KEYS = frozenset({
    "source", "onboardingSource", "onboarding_source", "submissionSource", "submission_source",
    "entrySource", "entry_source", "importBatchId", "import_batch_id", "sourceReferenceId",
    "source_reference_id",
})


class SourceUnavailable(Exception):
    """A channel that is unknown or not enabled was asked to create or stage company data."""


def require(source: str) -> str:
    """Return `source` if the channel is implemented, otherwise raise SourceUnavailable."""
    spec = SOURCES.get(source)
    if spec is None:
        raise SourceUnavailable(f"Unknown onboarding source: {source!r}")
    if not spec.available:
        raise SourceUnavailable(f"The {spec.label} channel is not available ({spec.note}).")
    return source


def label(source: str | None) -> str:
    if not source:
        return UNKNOWN_LABEL
    spec = SOURCES.get(source)
    return spec.label if spec else source


def reject_client_source(data):
    """Pydantic 'before' validator body: refuse a request that tries to set the source."""
    if isinstance(data, dict):
        sent = sorted(CLIENT_SOURCE_KEYS.intersection(data))
        if sent:
            raise ValueError("The onboarding source is assigned by X!Y and cannot be set by the client "
                             f"(remove: {', '.join(sent)}).")
    return data
