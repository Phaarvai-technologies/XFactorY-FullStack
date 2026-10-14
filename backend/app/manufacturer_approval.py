"""Admin approval of submitted manufacturer company details (staging -> main tables).

Flow
  1. The manufacturer submits the basic company details (account form). They are stored in
     `manufacturer_submissions` (status 'pending'), linked to the user, their own organization
     (workspace) and, for a selected existing company, that company's id. Nothing in the main
     company tables changes. One open submission per user: retries / corrections update it.
  2. The submission appears in the existing admin review (queue + manufacturer detail). The
     manufacturer keeps completing the profile meanwhile; completion never approves anything.
  3. The admin approves (REVIEWED), requests corrections (NEEDS_CORRECTION) or rejects
     (REJECTED) through the existing review-status control. Reviewer, time and feedback are
     recorded on the submission.
  4. Approval applies the submission to the main tables in the caller's transaction, exactly
     once (`applied_at`, row lock), re-checking ownership and duplicates at that moment:
       new_company - the details are written to the submitter's own organization;
       update      - an owner's change to their (approved) company, written over its values;
       claim       - an unclaimed existing company: its saved values are kept, only missing
                     ones are filled; the submitter becomes its owner; the profile they built
                     in their workspace while waiting is merged in where the company has no
                     data of its own; the workspace is retired. Existing ids are preserved.
     The company's approval status becomes 'approved'. Visibility to Visionaries additionally
     needs a 100% complete profile (app/core/eligibility.py).
"""
from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

OPEN = ("pending", "changes_requested")
OWNER_ROLES = "('owner', 'admin')"
SUBMISSION_COLUMNS = """
    s.id, s.organization_id, s.target_organization_id, s.selected_company_id, s.submitted_by_user_id,
    s.kind, s.payload, s.status, s.reviewed_by_user_id, s.reviewed_at, s.review_feedback, s.applied_at,
    s.created_at, s.updated_at
"""


def _payload(row) -> dict:
    value = row["payload"]
    return json.loads(value) if isinstance(value, (str, bytes)) else dict(value or {})


# ------------------------------------------------------------------ reads
async def open_submission_for_user(db: AsyncSession, user_id: UUID) -> dict | None:
    row = (await db.execute(text(f"""
        SELECT {SUBMISSION_COLUMNS} FROM manufacturer_submissions s
        WHERE s.submitted_by_user_id = :u AND s.status IN ('pending', 'changes_requested')
    """), {"u": user_id})).mappings().first()
    return {**row, "payload": _payload(row)} if row else None


async def latest_submission_for_user(db: AsyncSession, user_id: UUID) -> dict | None:
    row = (await db.execute(text(f"""
        SELECT {SUBMISSION_COLUMNS} FROM manufacturer_submissions s
        WHERE s.submitted_by_user_id = :u ORDER BY s.updated_at DESC, s.created_at DESC LIMIT 1
    """), {"u": user_id})).mappings().first()
    return {**row, "payload": _payload(row)} if row else None


async def open_submission_for_target(db: AsyncSession, org_id: str | UUID, lock: bool = False) -> dict | None:
    row = (await db.execute(text(f"""
        SELECT {SUBMISSION_COLUMNS} FROM manufacturer_submissions s
        WHERE s.target_organization_id = CAST(:o AS uuid) AND s.status IN ('pending', 'changes_requested')
        ORDER BY (s.status = 'pending') DESC, s.updated_at DESC LIMIT 1
        {"FOR UPDATE" if lock else ""}
    """), {"o": str(org_id)})).mappings().first()
    return {**row, "payload": _payload(row)} if row else None


async def submissions_for_target(db: AsyncSession, org_id: str | UUID) -> list[dict]:
    rows = (await db.execute(text(f"""
        SELECT {SUBMISSION_COLUMNS} FROM manufacturer_submissions s
        WHERE s.target_organization_id = CAST(:o AS uuid) ORDER BY s.created_at
    """), {"o": str(org_id)})).mappings().all()
    return [{**r, "payload": _payload(r)} for r in rows]


async def approval_status(db: AsyncSession, org_id: UUID) -> str | None:
    return await db.scalar(text("SELECT status FROM manufacturer_onboarding WHERE organization_id = :o"),
                           {"o": org_id})


async def completeness(db: AsyncSession, org_id: UUID) -> int:
    return int(await db.scalar(text(
        "SELECT completeness FROM admin_manufacturer_overview WHERE organization_id = :o"), {"o": org_id}) or 0)


# ------------------------------------------------------------------ submit
async def stage(db: AsyncSession, *, user_id: UUID, workspace_id: UUID, target_id: UUID,
                selected_id: UUID | None, kind: str, payload: dict) -> UUID:
    """Create or refresh the user's open submission (status back to 'pending')."""
    return await db.scalar(text("""
        INSERT INTO manufacturer_submissions
          (organization_id, target_organization_id, selected_company_id, submitted_by_user_id, kind, payload)
        VALUES (:w, :t, :sel, :u, :k, CAST(:p AS jsonb))
        ON CONFLICT (submitted_by_user_id) WHERE status IN ('pending', 'changes_requested')
        DO UPDATE SET organization_id = EXCLUDED.organization_id,
                      target_organization_id = EXCLUDED.target_organization_id,
                      selected_company_id = EXCLUDED.selected_company_id, kind = EXCLUDED.kind,
                      payload = EXCLUDED.payload, status = 'pending', updated_at = now()
        RETURNING id
    """), {"w": workspace_id, "t": target_id, "sel": selected_id, "u": user_id, "k": kind,
           "p": json.dumps(payload)})


async def stage_name_change(db: AsyncSession, *, user_id: UUID, workspace_id: UUID, name: str) -> bool:
    """Profile wizard company-name edit: it requires review, so it goes to the user's open
    submission (or a new 'update' submission for an approved company). Returns True if staged."""
    open_sub = await open_submission_for_user(db, user_id)
    if open_sub:
        payload = {**open_sub["payload"], "companyName": name}
        await db.execute(text("""
            UPDATE manufacturer_submissions SET payload = CAST(:p AS jsonb), status = 'pending', updated_at = now()
            WHERE id = :id
        """), {"id": open_sub["id"], "p": json.dumps(payload)})
        return True
    if await approval_status(db, workspace_id) != "approved":
        return False  # never submitted (older accounts): unchanged behaviour
    current = (await db.execute(text("""
        SELECT o.display_name, op.company_category, op.country_name, op.country_code,
               op.production_capacity_label, op.stated_production_capacity, op.contact_email, op.contact_phone
        FROM organizations o LEFT JOIN organization_profiles op ON op.organization_id = o.id WHERE o.id = :o
    """), {"o": workspace_id})).mappings().one()
    payload = {"companyName": name, "companyType": current["company_category"] or "",
               "country": current["country_name"] or "", "countryCode": current["country_code"],
               "capacity": current["production_capacity_label"] or "",
               "capacityNumber": current["stated_production_capacity"],
               "contactEmail": current["contact_email"], "contactPhone": current["contact_phone"]}
    await stage(db, user_id=user_id, workspace_id=workspace_id, target_id=workspace_id, selected_id=None,
                kind="update", payload=payload)
    return True


# ------------------------------------------------------------------ decide
class DecisionError(Exception):
    """Raised when a decision cannot be applied (message is shown to the admin)."""


async def decide(db: AsyncSession, org_id: str, decision: str, admin_id: UUID, feedback: str | None) -> dict | None:
    """Apply an admin decision to the open submission for `org_id`. Returns the submission
    (as it was) or None when the company has no open submission. Caller commits."""
    sub = await open_submission_for_target(db, org_id, lock=True)
    if sub is None:
        return None
    feedback = (feedback or "").strip() or None
    if decision == "approved":
        await _apply(db, sub)  # pending, or the admin decides corrections are not needed after all
        new_status = "approved"
    elif decision == "changes_requested":
        new_status = "changes_requested"
    elif decision == "rejected":
        new_status = "rejected"
    else:
        raise DecisionError("Unsupported decision")
    updated = (await db.execute(text("""
        UPDATE manufacturer_submissions
        SET status = :s, reviewed_by_user_id = :a, reviewed_at = now(), review_feedback = :f,
            applied_at = CASE WHEN :s = 'approved' THEN now() ELSE applied_at END, updated_at = now()
        WHERE id = :id AND status IN ('pending', 'changes_requested') AND applied_at IS NULL
        RETURNING id
    """), {"s": new_status, "a": admin_id, "f": feedback, "id": sub["id"]})).first()
    if updated is None:  # processed concurrently
        raise DecisionError("This submission was already processed.")
    # The company's own approval status follows the decision for a NEW company. A claim or an
    # update concerns an existing company: rejecting / correcting it leaves that company as is.
    if sub["kind"] == "new_company" or new_status == "approved":
        await _set_company_status(db, sub["target_organization_id"], new_status, admin_id, feedback)
    return sub


async def _set_company_status(db, org_id: UUID, status: str, admin_id: UUID, feedback: str | None) -> None:
    await db.execute(text("""
        INSERT INTO manufacturer_onboarding (organization_id, status, reviewed_at, reviewed_by_user_id,
                                             rejection_reason, personal_information_completed)
        VALUES (:o, :s, now(), :a, CASE WHEN :s <> 'approved' THEN :f END, true)
        ON CONFLICT (organization_id) DO UPDATE SET status = EXCLUDED.status, reviewed_at = now(),
          reviewed_by_user_id = EXCLUDED.reviewed_by_user_id,
          rejection_reason = CASE WHEN :s <> 'approved' THEN :f ELSE manufacturer_onboarding.rejection_reason END,
          personal_information_completed = true, version = manufacturer_onboarding.version + 1
    """), {"o": org_id, "s": status, "a": admin_id, "f": feedback})


async def _apply(db: AsyncSession, sub: dict) -> None:
    p, target, user_id = sub["payload"], sub["target_organization_id"], sub["submitted_by_user_id"]
    await db.execute(text("SELECT 1 FROM organizations WHERE id = :t FOR UPDATE"), {"t": target})
    owners = (await db.execute(text(f"""
        SELECT user_id FROM memberships WHERE organization_id = :t AND status = 'active'
          AND membership_role IN {OWNER_ROLES}
    """), {"t": target})).scalars().all()
    if sub["kind"] == "claim":
        if owners and user_id not in owners:
            raise DecisionError("This company was claimed by someone else in the meantime. Reject this claim.")
    elif user_id not in owners:
        raise DecisionError("The submitter no longer manages this company.")
    if sub["kind"] in ("new_company", "update"):
        name = (p.get("companyName") or "").strip()
        clash = await db.scalar(text("""
            SELECT o.id FROM organizations o
            LEFT JOIN organization_profiles op ON op.organization_id = o.id
            JOIN manufacturer_onboarding mo ON mo.organization_id = o.id AND mo.status = 'approved'
            WHERE o.organization_type = 'manufacturer' AND NOT o.is_archived AND o.id <> :t
              AND lower(regexp_replace(btrim(o.display_name), '\\s+', ' ', 'g'))
                  = lower(regexp_replace(btrim(:n), '\\s+', ' ', 'g'))
              AND lower(btrim(COALESCE(op.country_name, ''))) = lower(btrim(COALESCE(:c, '')))
            LIMIT 1
        """), {"t": target, "n": name, "c": p.get("country")})
        if clash:
            raise DecisionError("An approved company with this name already exists in this country. "
                                "Request corrections or reject this submission.")
        if name:
            await db.execute(text("""
                UPDATE organizations SET display_name = :n, legal_name = COALESCE(legal_name, :n),
                  updated_at = now(), version = version + 1
                WHERE id = :t AND display_name IS DISTINCT FROM CAST(:n AS text)
            """), {"t": target, "n": name})
        await _write_profile(db, target, p, keep_saved=False)
    else:  # claim
        await _write_profile(db, target, p, keep_saved=True)
        await db.execute(text("""
            INSERT INTO memberships (user_id, organization_id, membership_role, status, accepted_at)
            VALUES (:u, :t, 'owner', 'active', now())
            ON CONFLICT (organization_id, user_id) DO UPDATE SET membership_role = 'owner', status = 'active',
              accepted_at = COALESCE(memberships.accepted_at, now()), version = memberships.version + 1
        """), {"u": user_id, "t": target})
        workspace = sub["organization_id"]
        if workspace != target:
            await merge_workspace(db, workspace, target)
        # The claim is verified by this approval.
        await db.execute(text("UPDATE organizations SET status = 'active', updated_at = now() WHERE id = :t"),
                         {"t": target})


async def _write_profile(db, org_id: UUID, p: dict, keep_saved: bool) -> None:
    values = {"o": org_id, "email": p.get("contactEmail") or None, "phone": p.get("contactPhone") or None,
              "code": p.get("countryCode"), "country": p.get("country") or None,
              "category": p.get("companyType") or None, "cap": p.get("capacityNumber"),
              "cap_label": p.get("capacity") or None}
    if keep_saved:
        sets = """contact_email = COALESCE(organization_profiles.contact_email, EXCLUDED.contact_email),
                  contact_phone = COALESCE(organization_profiles.contact_phone, EXCLUDED.contact_phone),
                  country_code = COALESCE(organization_profiles.country_code, EXCLUDED.country_code),
                  country_name = COALESCE(NULLIF(organization_profiles.country_name, ''), EXCLUDED.country_name),
                  company_category = COALESCE(NULLIF(organization_profiles.company_category, ''), EXCLUDED.company_category),
                  stated_production_capacity = COALESCE(organization_profiles.stated_production_capacity,
                                                        EXCLUDED.stated_production_capacity),
                  production_capacity_label = COALESCE(NULLIF(organization_profiles.production_capacity_label, ''),
                                                       EXCLUDED.production_capacity_label)"""
    else:
        sets = """contact_email = EXCLUDED.contact_email, contact_phone = EXCLUDED.contact_phone,
                  country_code = EXCLUDED.country_code, country_name = EXCLUDED.country_name,
                  company_category = EXCLUDED.company_category,
                  stated_production_capacity = EXCLUDED.stated_production_capacity,
                  production_capacity_label = EXCLUDED.production_capacity_label"""
    await db.execute(text(f"""
        INSERT INTO organization_profiles (organization_id, contact_email, contact_phone, country_code, country_name,
                                           company_category, stated_production_capacity, production_capacity_label)
        VALUES (:o, :email, :phone, :code, :country, :category, :cap, :cap_label)
        ON CONFLICT (organization_id) DO UPDATE SET {sets}, updated_at = now()
    """), values)


# Single-value profile columns copied from the workspace only where the company has none.
_PROFILE_FILL = ("about_company", "vision", "mission", "establishment_year", "employee_count", "business_type",
                 "organization_size", "logo_file_id", "cover_file_id", "address_line1", "postal_code",
                 "service_area")
_FACILITY_FILL = ("address", "address_line1", "city", "state_province", "postal_code", "country_name",
                  "country_code", "map_pin", "sez_status", "location")


async def merge_workspace(db: AsyncSession, workspace: UUID, target: UUID) -> None:
    """Claim approved: bring the profile the claimant built in their workspace into the claimed
    company WITHOUT overwriting anything the company already has, then retire the workspace."""
    cols = {r[0] for r in (await db.execute(text(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'organization_profiles'"))).all()}
    fill = [c for c in _PROFILE_FILL if c in cols]
    if fill:
        await db.execute(text(f"""
            INSERT INTO organization_profiles (organization_id) VALUES (:t) ON CONFLICT (organization_id) DO NOTHING
        """), {"t": target})
        await db.execute(text(f"""
            UPDATE organization_profiles tp SET {", ".join(f"{c} = COALESCE(tp.{c}, wp.{c})" for c in fill)},
              updated_at = now()
            FROM organization_profiles wp WHERE tp.organization_id = :t AND wp.organization_id = :w
        """), {"t": target, "w": workspace})
    # files the workspace uploaded (logo / cover / machine images) now belong to the company
    await db.execute(text("UPDATE files SET organization_id = :t WHERE organization_id = :w"),
                     {"t": target, "w": workspace})

    def hq(org):
        return db.scalar(text("""SELECT id FROM facilities WHERE organization_id = :o AND is_headquarters
                                 AND status <> 'suspended' LIMIT 1"""), {"o": org})
    target_hq, work_hq = await hq(target), await hq(workspace)
    if work_hq and not target_hq:
        await db.execute(text("UPDATE facilities SET organization_id = :t WHERE id = :f"), {"t": target, "f": work_hq})
        target_hq = work_hq
    elif work_hq and target_hq:
        fcols = {r[0] for r in (await db.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'facilities'"))).all()}
        ffill = [c for c in _FACILITY_FILL if c in fcols]
        await db.execute(text(f"""
            UPDATE facilities tf SET {", ".join(f"{c} = COALESCE(tf.{c}, wf.{c})" for c in ffill)}
            FROM facilities wf WHERE tf.id = :tf AND wf.id = :wf
        """), {"tf": target_hq, "wf": work_hq})
        # serviceable areas: keep the company's unless it has none
        await db.execute(text("""
            UPDATE facilities tf SET serviceable_areas = wf.serviceable_areas FROM facilities wf
            WHERE tf.id = :tf AND wf.id = :wf AND cardinality(tf.serviceable_areas) = 0
        """), {"tf": target_hq, "wf": work_hq})

    # Collections: moved only when the company has none of its own (never mixed, never overwritten).
    for table in ("organization_certifications", "manufacturer_infrastructure", "manufacturer_faq_answers"):
        if not await db.scalar(text(f"SELECT EXISTS (SELECT 1 FROM {table} WHERE organization_id = :t)"), {"t": target}):
            await db.execute(text(f"""
                UPDATE {table} SET organization_id = :t,
                  facility_id = CASE WHEN facility_id IS NULL THEN NULL ELSE CAST(:hq AS uuid) END
                WHERE organization_id = :w
            """), {"t": target, "w": workspace, "hq": target_hq})
    # the claimant's own machinery listings and availability
    await db.execute(text("""
        UPDATE machines SET organization_id = :t,
          facility_id = CASE WHEN facility_id IS NULL THEN NULL ELSE CAST(:hq AS uuid) END
        WHERE organization_id = :w
    """), {"t": target, "w": workspace, "hq": target_hq})
    if not await db.scalar(text("SELECT EXISTS (SELECT 1 FROM manufacturer_availability_preferences WHERE organization_id = :t)"),
                           {"t": target}):
        await db.execute(text("UPDATE manufacturer_availability_preferences SET organization_id = :t WHERE organization_id = :w"),
                         {"t": target, "w": workspace})
    await db.execute(text("""
        UPDATE manufacturer_form_progress wp SET organization_id = :t
        WHERE wp.organization_id = :w AND NOT EXISTS (
          SELECT 1 FROM manufacturer_form_progress tp WHERE tp.organization_id = :t
            AND (tp.form_key, tp.record_id) = (wp.form_key, wp.record_id))
          AND (wp.client_key IS NULL OR NOT EXISTS (
          SELECT 1 FROM manufacturer_form_progress tp WHERE tp.organization_id = :t AND tp.client_key = wp.client_key))
    """), {"t": target, "w": workspace})
    # Onboarding step flags: the company keeps any it already has.
    await db.execute(text("""
        INSERT INTO manufacturer_onboarding (organization_id) VALUES (:t) ON CONFLICT (organization_id) DO NOTHING
    """), {"t": target})
    await db.execute(text("""
        UPDATE manufacturer_onboarding tm SET
          personal_information_completed = true,
          company_information_completed = tm.company_information_completed OR wm.company_information_completed,
          location_completed = tm.location_completed OR wm.location_completed,
          certification_completed = tm.certification_completed OR wm.certification_completed,
          infrastructure_completed = tm.infrastructure_completed OR wm.infrastructure_completed,
          faq_completed = tm.faq_completed OR wm.faq_completed,
          completion_percentage = GREATEST(tm.completion_percentage, wm.completion_percentage),
          current_step = CASE WHEN tm.current_step = 'personal_information' THEN wm.current_step ELSE tm.current_step END,
          version = tm.version + 1
        FROM manufacturer_onboarding wm WHERE tm.organization_id = :t AND wm.organization_id = :w
    """), {"t": target, "w": workspace})
    # Retire the workspace: membership removed, archived (kept, never deleted).
    await db.execute(text("UPDATE memberships SET status = 'removed', version = version + 1 WHERE organization_id = :w"),
                     {"w": workspace})
    await db.execute(text("UPDATE organizations SET is_archived = true, archived_at = now(), updated_at = now() WHERE id = :w"),
                     {"w": workspace})
