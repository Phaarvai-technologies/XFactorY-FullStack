"""Admin Entry: an admin adds a manufacturer company from the admin dashboard.

* Who: administrators and operators only (checked here, on the backend). Support and
  verification roles can see companies but not add them.
* Source: onboarding_source = 'admin_entry', set once (never changed later, migration 020
  trigger). The admin, time and reason are recorded as a 'created' history event and in the
  company's change history.
* Like an imported company it has no owner and is NOT approved: it is selectable in onboarding
  company search, and becomes visible to Visionaries only after admin approval AND a 100%
  complete profile (app/core/eligibility.py). A website user may later claim it; the source stays
  admin_entry and the claim is recorded as a web_dashboard submission.
* Duplicates: the importer's matching rules (registration id, name + website, name + country +
  city; never the name alone) - an existing match is refused with its id.
* Retries: an Idempotency-Key header makes a repeated request return the company it created.
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import onboarding_source
from app.import_manufacturers import EXISTING_SQL, match, website_domain
from app.manufacturer_approval import record_event
from app.repositories.manufacturer import COUNTRY_CODES, normalize_company_name

SOURCE = "admin_entry"
CREATE_ROLES = ("platform_administrator", "platform_operator")


class CreateError(Exception):
    def __init__(self, message: str, status: int, code: str, existing_id: str | None = None):
        super().__init__(message)
        self.message, self.status, self.code, self.existing_id = message, status, code, existing_id


async def create_company(db: AsyncSession, *, admin_id: UUID, roles: tuple[str, ...], data: dict,
                         idempotency_key: str | None) -> tuple[str, bool]:
    """Returns (organization id, created). Caller commits."""
    if not set(roles) & set(CREATE_ROLES):
        raise CreateError("Only administrators and operators can add companies.", 403, "forbidden")
    onboarding_source.require(SOURCE)
    key = f"admin_entry:{admin_id}:{idempotency_key.strip()[:200]}" if idempotency_key and idempotency_key.strip() else None
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended('xy-import-manufacturers', 0))"))
    if key:
        done = await db.scalar(text("SELECT organization_id FROM manufacturer_submission_events WHERE idempotency_key = :k"),
                               {"k": key})
        if done:
            return str(done), False
    row = {"name": data["name"], "registration_id": data.get("registration_id", ""), "website": data.get("website", ""),
           "country": data.get("country", ""), "city": data.get("city", "")}
    record_type = data.get("record_type") or "REAL"
    candidates = (await db.execute(text(EXISTING_SQL), {
        "norm": normalize_company_name(row["name"]), "reg": row["registration_id"].lower()})).all()
    # Same rules as the importer: a match of the same type is a duplicate; a match of the other
    # type only (real vs demo) is a classification conflict. The existing record is never converted.
    verdict, found = match(row, [c for c in candidates if c.record_type == record_type])
    if verdict == "new":
        other, twin = match(row, [c for c in candidates if c.record_type != record_type])
        if other == "present":
            raise CreateError(f"This company already exists as {twin.record_type.lower()} data: "
                              f"{twin.display_name}. Change that record's type instead of adding it again.",
                              409, "classification_conflict", str(twin.id))
        verdict = other if other == "ambiguous" else verdict
    if verdict == "present":
        raise CreateError(f"This company already exists: {found.display_name}. Open it instead of adding it again.",
                          409, "duplicate_company", str(found.id))
    if verdict == "ambiguous":
        raise CreateError("A company with this name already exists. Add its country and city, website or "
                          "registration id so it can be told apart.", 409, "ambiguous_company")
    code = COUNTRY_CODES.get(data.get("country", "").lower())
    if code and not await db.scalar(text("SELECT 1 FROM countries WHERE code=:c"), {"c": code}):
        code = None
    org_id = await db.scalar(text("""
        INSERT INTO organizations (display_name, legal_name, organization_type, status, website_domain,
                                   entry_source, record_type, onboarding_source)
        VALUES (:name, :name, 'manufacturer', 'claim_pending', NULLIF(:web, ''), 'ADMIN_ASSISTED', :rt, :src)
        RETURNING id
    """), {"name": data["name"], "web": website_domain(data.get("website", "")), "src": SOURCE, "rt": record_type})
    await db.execute(text("""
        INSERT INTO organization_profiles (organization_id, registration_id, contact_email, contact_phone,
                                           address_line1, country_code, country_name, company_category,
                                           production_capacity_label)
        VALUES (:org, NULLIF(:reg, ''), NULLIF(:email, ''), NULLIF(:phone, ''), NULLIF(:address, ''),
                :code, NULLIF(:country, ''), NULLIF(:category, ''), NULLIF(:capacity, ''))
    """), {"org": org_id, "reg": data.get("registration_id", ""), "email": data.get("email", ""),
            "phone": data.get("phone", ""), "address": data.get("address", ""), "code": code,
            "country": data.get("country", ""), "category": data.get("category", ""),
            "capacity": data.get("capacity", "")})
    if any(data.get(k) for k in ("city", "state", "address", "country")):
        await db.execute(text("""
            INSERT INTO facilities (organization_id, name, facility_type, is_headquarters, status, visibility,
                                    address, city, state_province, country_name, country_code)
            VALUES (:org, :fname, 'factory', true, 'draft', 'private', NULLIF(:address, ''), NULLIF(:city, ''),
                    NULLIF(:state, ''), NULLIF(:country, ''), :code)
        """), {"org": org_id, "fname": f"{data['name']} Headquarters", "address": data.get("address", ""),
                "city": data.get("city", ""), "state": data.get("state", ""), "country": data.get("country", ""),
                "code": code})
    await record_event(db, event="created", role="admin", source=SOURCE, organization_id=org_id, actor=admin_id,
                       details={"reason": data.get("reason") or None, "record_type": record_type}, key=key)
    await db.execute(text("""
        INSERT INTO admin_change_history (manufacturer_id, field_changed, old_value, new_value, changed_by, reason)
        VALUES (:o, 'Company created', NULL, :n, :a, NULLIF(:r, ''))
    """), {"o": org_id, "n": data["name"], "a": admin_id, "r": data.get("reason", "")})
    return str(org_id), True
