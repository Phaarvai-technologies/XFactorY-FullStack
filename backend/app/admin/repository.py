"""SQL for the admin dashboard. Every list reads `admin_manufacturer_overview`
(migration 008). All filter values are bound parameters; column names used in
ORDER BY come from fixed whitelists only."""
import json
from datetime import date
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Admin review statuses (doc) <-> manufacturer_onboarding.status (schema).
REVIEW_TO_DB = {
    "NOT_STARTED": "draft",
    "IN_PROGRESS": "in_progress",
    "SUBMITTED": "submitted",
    "NEEDS_CORRECTION": "changes_requested",
    "REVIEWED": "approved",
    "REJECTED": "rejected",
}
REVIEW_STATUSES = tuple(REVIEW_TO_DB)
RECORD_TYPES = ("REAL", "DEMO", "TEST")
ENTRY_SOURCES = ("MANUFACTURER", "ADMIN_ASSISTED", "IMPORTED")
# Users / Visionaries "Data" filter. A user is demo data when the person is marked DEMO or TEST
# (users.record_type, migration 023, e.g. a demo Visionary) or the manufacturer company shown for
# them is (organizations.record_type); everyone else is real. Both set by an admin. real + demo = all.
DATA_SCOPES = ("real", "demo", "all")
USER_DATA_SQL = {"real": "coalesce(mf.record_type, 'REAL') = 'REAL' AND u.record_type = 'REAL'",
                 "demo": "(mf.record_type IN ('DEMO', 'TEST') OR u.record_type IN ('DEMO', 'TEST'))"}
ACCOUNT_STATUSES = ("active", "suspended", "deactivated")

# (column in the view, label, onboarding section) - the 13 required items, in form order.
# Date of birth is optional (migration 025): it is not a required item.
REQUIRED_FIELDS = [
    ("r_first_name", "First name", "Personal info"),
    ("r_last_name", "Last name", "Personal info"),
    ("r_contact", "Email or phone", "Personal info"),
    ("r_company_name", "Company name", "Company info"),
    ("r_industry", "Company category", "Company info"),
    ("r_account_country", "Country", "Company info"),
    ("r_about", "About the company", "Company details"),
    ("r_address", "Facility address", "Location"),
    ("r_city", "City", "Location"),
    ("r_location_country", "Facility country", "Location"),
    ("r_certification", "At least one certification", "Certifications"),
    ("r_infrastructure", "Infrastructure details", "Infrastructure"),
    ("r_faq", "At least one FAQ", "FAQ"),
]
SECTIONS = ["Personal info", "Company info", "Company details", "Location",
            "Certifications", "Infrastructure", "FAQ"]

LIST_COLUMNS = """
    organization_id, company_name, first_name, last_name, user_id, user_email, user_phone,
    contact_email, contact_phone, industry, country, city, major_process, listing_count,
    completeness, required_done, required_total, review_status, record_type, entry_source,
    referral_source, assigned_admin_user_id, is_archived, archived_at, registered_at,
    last_updated, last_seen_at, current_step, submitted_at,
    r_first_name, r_last_name, r_contact, r_dob, r_company_name, r_industry, r_account_country,
    r_about, r_address, r_city, r_location_country, r_certification, r_infrastructure, r_faq,
    (SELECT count(DISTINCT lm.user_id) FROM memberships lm
      WHERE lm.organization_id = admin_manufacturer_overview.organization_id AND lm.status = 'active') AS linked_users,
    (SELECT so.onboarding_source FROM organizations so
      WHERE so.id = admin_manufacturer_overview.organization_id) AS onboarding_source,
    (SELECT bl.evidence->>'why' FROM onboarding_source_backfill_log bl
      WHERE bl.record_type = 'company' AND bl.record_id = admin_manufacturer_overview.organization_id
        AND bl.field = 'onboarding_source' AND bl.outcome <> 'applied') AS onboarding_source_note,
    -- a new company not approved yet: its source is still on the staged submission
    (SELECT json_build_object('source', ss.source, 'status', ss.status) FROM manufacturer_submissions ss
       WHERE ss.target_organization_id = admin_manufacturer_overview.organization_id AND ss.organization_id = ss.target_organization_id
         AND ss.kind = 'new_company' ORDER BY ss.updated_at DESC LIMIT 1) AS staged_source
"""
# Open requests awaiting a decision on a company (one review area for all of them): the newest
# one's type, requester and date, plus how many are open. Joined to admin_manufacturer_overview.
OPEN_REQUEST_JOIN = """
    LEFT JOIN LATERAL (
      SELECT s.kind AS request_kind, s.updated_at AS request_submitted_at,
             coalesce(nullif(btrim(concat_ws(' ', ru.first_name, ru.last_name)), ''), ru.email::text) AS requested_by,
             count(*) OVER () AS open_requests
      FROM manufacturer_submissions s JOIN users ru ON ru.id = s.submitted_by_user_id
      WHERE s.target_organization_id = admin_manufacturer_overview.organization_id
        AND s.status IN ('pending', 'changes_requested')
      ORDER BY (s.status = 'pending') DESC, s.updated_at DESC LIMIT 1
    ) req ON true
"""
# Marketplace roles admins filter users by (Visionaries record the demand_requester persona).
USER_ROLE_FILTERS = {"manufacturer": "manufacturer", "visionary": "demand_requester"}
MACHINE_STATUS_SQL = """CASE WHEN m.status = 'archived' THEN 'Archived'
                             WHEN m.publication_status = 'published' THEN 'Published'
                             WHEN m.publication_status = 'draft' THEN 'Draft' ELSE 'Unpublished' END"""
MACHINE_STATUSES = ("Published", "Draft", "Unpublished", "Archived")
# Company name as the admin lists show it (a new company awaiting approval: its submitted name).
COMPANY_NAME_SQL = """COALESCE((SELECT s.payload->>'companyName' FROM manufacturer_submissions s
                         WHERE s.target_organization_id = o.id AND s.kind = 'new_company'
                           AND s.status IN ('pending', 'changes_requested')
                         ORDER BY s.updated_at DESC LIMIT 1), o.display_name)"""
SORTS = {
    "updated": "last_updated DESC NULLS LAST, company_name",
    "name": "lower(company_name), registered_at DESC",
    "completeness": "completeness ASC, last_updated DESC NULLS LAST",
    "registered": "registered_at DESC",
}


def sections_status(row: dict) -> dict:
    """Per onboarding section: complete or not; missing items; where onboarding stopped."""
    missing = [label for col, label, _ in REQUIRED_FIELDS if not row.get(col)]
    done = {s: all(row.get(c) for c, _, sec in REQUIRED_FIELDS if sec == s) for s in SECTIONS}
    stopped_at = next((s for s in SECTIONS if not done[s]), None)
    last_completed = None
    for s in SECTIONS:
        if not done[s]:
            break
        last_completed = s
    return {"missingFields": missing, "sections": [{"name": s, "complete": done[s]} for s in SECTIONS],
            "stoppedAt": stopped_at, "lastCompletedSection": last_completed}


def to_text(value: Any) -> str | None:
    """Readable text for the change history."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


class AdminRepository:
    def __init__(self, session: AsyncSession):
        self.db = session

    async def rows(self, sql: str, params: dict | None = None) -> list[dict]:
        return [dict(r._mapping) for r in await self.db.execute(text(sql), params or {})]

    async def row(self, sql: str, params: dict | None = None) -> dict | None:
        r = (await self.db.execute(text(sql), params or {})).first()
        return dict(r._mapping) if r else None

    # ------------------------------------------------------------------ admins
    async def admins(self) -> list[dict]:
        return await self.rows("""
            SELECT DISTINCT u.id, coalesce(nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''),
                   u.display_name) AS name, u.email::text AS email
            FROM platform_role_assignments p JOIN users u ON u.id=p.user_id
            WHERE p.status='active' AND p.revoked_at IS NULL ORDER BY 2
        """)

    async def is_admin(self, user_id: str) -> bool:
        return bool(await self.db.scalar(text("""
            SELECT EXISTS (SELECT 1 FROM platform_role_assignments
                           WHERE user_id=CAST(:u AS uuid) AND status='active' AND revoked_at IS NULL)
        """), {"u": user_id}))

    # ------------------------------------------------------------------ overview (XY-ADMIN-02)
    async def overview(self) -> dict:
        cards = await self.row("""
            SELECT
              (SELECT count(*) FROM users u WHERE u.status<>'deactivated' AND u.clerk_user_id NOT LIKE 'local-admin:%'
                 AND NOT EXISTS (SELECT 1 FROM platform_role_assignments pa WHERE pa.user_id=u.id
                                 AND pa.status='active' AND pa.revoked_at IS NULL)) AS total_users,
              count(*) FILTER (WHERE record_type='REAL') AS total_manufacturers,
              count(*) FILTER (WHERE record_type='REAL' AND completeness=100) AS completed,
              count(*) FILTER (WHERE record_type='REAL' AND completeness<100) AS incomplete,
              count(*) FILTER (WHERE record_type='REAL' AND review_status='SUBMITTED') AS awaiting_review,
              count(*) FILTER (WHERE record_type IN ('DEMO','TEST')) AS test_demo,
              (SELECT count(DISTINCT clerk_user_id) FROM user_activity_events
                WHERE kind='error' AND created_at > now() - interval '7 days') AS open_support_issues
            FROM admin_manufacturer_overview WHERE NOT is_archived
        """)
        recent = await self.rows(f"""
            SELECT {LIST_COLUMNS} FROM admin_manufacturer_overview
            WHERE NOT is_archived AND record_type='REAL' ORDER BY registered_at DESC LIMIT 6
        """)
        updated = await self.rows(f"""
            SELECT {LIST_COLUMNS} FROM admin_manufacturer_overview
            WHERE NOT is_archived AND record_type='REAL' ORDER BY last_updated DESC NULLS LAST LIMIT 6
        """)
        attention = await self.rows(f"""
            SELECT {LIST_COLUMNS},
              CASE
                WHEN review_status='SUBMITTED' AND assigned_admin_user_id IS NULL THEN 'Submitted - no reviewer assigned'
                WHEN review_status='SUBMITTED' THEN 'Submitted - awaiting review'
                WHEN review_status='NEEDS_CORRECTION' THEN 'Waiting for the manufacturer''s corrections'
                WHEN review_status='IN_PROGRESS' THEN 'Onboarding stalled for over 7 days'
                ELSE 'Registered but onboarding not started'
              END AS attention_reason
            FROM admin_manufacturer_overview
            WHERE NOT is_archived AND record_type='REAL' AND (
              review_status IN ('SUBMITTED','NEEDS_CORRECTION')
              OR (review_status='IN_PROGRESS' AND coalesce(last_updated, registered_at) < now() - interval '7 days')
              OR (review_status='NOT_STARTED' AND registered_at < now() - interval '3 days'))
            ORDER BY (review_status='SUBMITTED') DESC, coalesce(last_updated, registered_at) ASC LIMIT 10
        """)
        return {"cards": cards, "recent": recent, "updated": updated, "attention": attention}

    # ------------------------------------------------------------------ manufacturers (XY-ADMIN-04)
    def _filters(self, f: dict) -> tuple[list[str], dict]:
        where, p = [], {}
        archived = f.get("archived") or "active"
        if archived == "active":
            where.append("NOT is_archived")
        elif archived == "archived":
            where.append("is_archived")
        if f.get("q"):
            where.append("(company_name ILIKE :q OR concat_ws(' ', first_name, last_name) ILIKE :q "
                         "OR user_email::text ILIKE :q OR contact_email::text ILIKE :q)")
            p["q"] = f"%{f['q'].strip()}%"
        if f.get("industry"):
            where.append("industry = :industry")
            p["industry"] = f["industry"]
        if f.get("process"):
            where.append("""EXISTS (SELECT 1 FROM machines mm WHERE mm.organization_id=admin_manufacturer_overview.organization_id
                            AND mm.status<>'archived' AND mm.name ILIKE :process)""")
            p["process"] = f"%{f['process'].strip()}%"
        if f.get("location"):
            where.append("(country ILIKE :loc OR city ILIKE :loc)")
            p["loc"] = f"%{f['location'].strip()}%"
        if f.get("completeness") == "complete":
            where.append("completeness = 100")
        elif f.get("completeness") == "incomplete":
            where.append("completeness < 100")
        for key, column, allowed in (("review_status", "review_status", REVIEW_STATUSES),
                                     ("record_type", "record_type", RECORD_TYPES),
                                     ("entry_source", "entry_source", ENTRY_SOURCES)):
            values = [v for v in (f.get(key) or []) if v in allowed]
            if values:
                where.append(f"{column} = ANY(:{key})")
                p[key] = values
        if f.get("assigned") == "unassigned":
            where.append("assigned_admin_user_id IS NULL")
        elif f.get("assigned_to"):
            where.append("assigned_admin_user_id = CAST(:assigned_to AS uuid)")
            p["assigned_to"] = f["assigned_to"]
        return where, p

    def _list_where(self, f: dict) -> tuple[str, dict]:
        where, p = self._filters(f)
        # Manufacturers tab: only approved companies and companies an admin brought in (import /
        # Add company). A company a user submitted appears once an admin approves it; until then it
        # is in Onboarding & review (listing=awaiting shows those, listing=all shows both).
        listing = f.get("listing") or "listed"
        if listing in ("listed", "awaiting"):
            from app.repositories.manufacturer import AWAITING_APPROVAL_SQL
            awaiting = (f"EXISTS (SELECT 1 FROM organizations o WHERE o.id = admin_manufacturer_overview.organization_id "
                        f"AND {AWAITING_APPROVAL_SQL})")
            where.append(awaiting if listing == "awaiting" else f"NOT {awaiting}")
        return (("WHERE " + " AND ".join(where)) if where else ""), p

    async def manufacturers(self, f: dict, page: int, page_size: int, sort: str) -> dict:
        clause, p = self._list_where(f)
        total = await self.db.scalar(text(f"SELECT count(*) FROM admin_manufacturer_overview {clause}"), p)
        # All / Real / Demo tabs: counts for every type with the other filters applied (the tab
        # itself, i.e. the record_type filter, is ignored so each tab shows its own number).
        count_clause, count_p = self._list_where({**f, "record_type": None})
        by_type = await self.rows(f"""SELECT record_type, count(*) AS n FROM admin_manufacturer_overview
                                      {count_clause} GROUP BY record_type""", count_p)
        record_type_counts = {t: 0 for t in RECORD_TYPES}
        record_type_counts.update({r["record_type"]: r["n"] for r in by_type if r["record_type"] in record_type_counts})
        rows = await self.rows(f"""
            SELECT {LIST_COLUMNS} FROM admin_manufacturer_overview {clause}
            ORDER BY {SORTS.get(sort, SORTS['updated'])} LIMIT :limit OFFSET :offset
        """, {**p, "limit": page_size, "offset": (page - 1) * page_size})
        facets = await self.row("""
            SELECT array_remove(array_agg(DISTINCT industry ORDER BY industry), NULL) AS industries,
                   array_remove(array_agg(DISTINCT country ORDER BY country), NULL) AS countries
            FROM admin_manufacturer_overview
        """)
        return {"total": total, "rows": rows, "facets": facets, "recordTypeCounts": record_type_counts}

    async def overview_row(self, org_id: str) -> dict | None:
        return await self.row(f"""
            SELECT {LIST_COLUMNS}, onboarding_started_at, reviewed_at, user_status, onboarding_raw_status
            FROM admin_manufacturer_overview WHERE organization_id=CAST(:o AS uuid)
        """, {"o": org_id})

    async def review_queue(self, f: dict) -> list[dict]:
        where, p = self._filters({**f, "archived": "active"})
        statuses = [s for s in (f.get("review_status") or []) if s in REVIEW_STATUSES]
        if not statuses:
            where.append("review_status <> 'REVIEWED'")
        clause = "WHERE " + " AND ".join(where)
        return await self.rows(f"""
            SELECT {LIST_COLUMNS}, req.request_kind, req.request_submitted_at, req.requested_by,
                   coalesce(req.open_requests, 0) AS open_requests
            FROM admin_manufacturer_overview {OPEN_REQUEST_JOIN} {clause}
            ORDER BY (record_type = 'REAL'),   -- "all": the few demo rows first, never cut off by the limit
                     array_position(ARRAY['SUBMITTED','NEEDS_CORRECTION','IN_PROGRESS','NOT_STARTED','REVIEWED'],
                                    review_status),
                     coalesce(last_updated, registered_at) DESC
            LIMIT 500
        """, p)

    # ------------------------------------------------------------------ manufacturer detail (XY-ADMIN-05)
    async def linked_users(self, org_id: str) -> list[dict]:
        return await self.rows("""
            SELECT u.id, u.first_name, u.last_name, u.email::text AS email, u.phone, u.status,
                   m.membership_role, u.created_at, u.last_seen_at
            FROM memberships m JOIN users u ON u.id=m.user_id
            WHERE m.organization_id=CAST(:o AS uuid) AND m.status='active'
            ORDER BY (m.membership_role='owner') DESC, m.created_at
        """, {"o": org_id})

    async def members(self, org_id: str) -> list[dict]:
        """Every user linked to exactly this company through a membership (any status), with
        their membership role / status and marketplace roles. Never matched by name or email."""
        return await self.rows("""
            SELECT u.id, u.first_name, u.last_name, u.display_name, u.email::text AS email, u.status AS account_status,
                   u.personal_email::text AS personal_email,
                   m.membership_role, m.status AS membership_status, m.created_at AS linked_at,
                   m.accepted_at, u.registration_completed_at, u.created_at AS user_created_at, u.last_seen_at,
                   -- this user's latest manufacturer application for exactly this company
                   (SELECT s.status FROM manufacturer_submissions s
                    WHERE s.submitted_by_user_id = u.id AND s.target_organization_id = m.organization_id
                      AND s.kind IN ('new_company', 'claim', 'update_request')
                    ORDER BY s.updated_at DESC LIMIT 1) AS application_status,
                   coalesce((SELECT array_agg(r.role_selected ORDER BY r.selected_at) FROM marketplace_role_selections r
                             WHERE r.user_id = u.id AND r.status = 'active'), '{}') AS roles
            FROM memberships m JOIN users u ON u.id = m.user_id
            WHERE m.organization_id = CAST(:o AS uuid)
            ORDER BY (m.status = 'active') DESC, (m.membership_role = 'owner') DESC, m.created_at
        """, {"o": org_id})

    async def company_requests(self, org_id: str) -> list[dict]:
        """Every onboarding / change request submitted for exactly this company (by database id),
        with the requester's user record and whether they are a confirmed (active) member now.
        A request never creates a membership; it is listed, not counted as a member."""
        return await self.rows("""
            SELECT s.id, s.kind, s.status, s.source, s.submitted_at, s.created_at, s.updated_at, s.reviewed_at,
                   s.review_feedback, s.applied_at,
                   u.id AS user_id, u.first_name, u.last_name, u.display_name, u.email::text AS email,
                   u.personal_email::text AS personal_email, u.status AS account_status,
                   EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = s.target_organization_id
                           AND m.user_id = s.submitted_by_user_id AND m.status = 'active') AS is_member,
                   coalesce(nullif(btrim(concat_ws(' ', r.first_name, r.last_name)), ''), r.display_name) AS reviewer
            FROM manufacturer_submissions s
            LEFT JOIN users u ON u.id = s.submitted_by_user_id
            LEFT JOIN users r ON r.id = s.reviewed_by_user_id
            WHERE s.target_organization_id = CAST(:o AS uuid) AND s.status <> 'draft'
            ORDER BY (s.status IN ('pending', 'changes_requested')) DESC, s.submitted_at DESC, s.id
            LIMIT 100
        """, {"o": org_id})

    async def history(self, org_id: str) -> list[dict]:
        return await self.rows("""
            SELECT h.id, h.field_changed, h.old_value, h.new_value, h.reason, h.created_at,
                   coalesce(nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.display_name) AS changed_by
            FROM admin_change_history h LEFT JOIN users u ON u.id=h.changed_by
            WHERE h.manufacturer_id=CAST(:o AS uuid) ORDER BY h.created_at DESC LIMIT 200
        """, {"o": org_id})

    async def notes(self, org_id: str) -> list[dict]:
        return await self.rows("""
            SELECT n.id, n.note, n.created_at, n.shared_with_manufacturer AS shared,
                   coalesce(nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.display_name) AS admin_name
            FROM admin_internal_notes n LEFT JOIN users u ON u.id=n.admin_id
            WHERE n.manufacturer_id=CAST(:o AS uuid) ORDER BY n.created_at DESC
        """, {"o": org_id})

    async def add_history(self, org_id: str, field: str, old: Any, new: Any, admin_id: UUID,
                          reason: str | None) -> None:
        await self.db.execute(text("""
            INSERT INTO admin_change_history (manufacturer_id, field_changed, old_value, new_value, changed_by, reason)
            VALUES (CAST(:o AS uuid), :f, :old, :new, :by, :reason)
        """), {"o": org_id, "f": field, "old": to_text(old), "new": to_text(new), "by": admin_id,
                "reason": (reason or "").strip() or None})

    async def add_note(self, org_id: str, admin_id: UUID, note: str, shared: bool = False) -> None:
        await self.db.execute(text("""
            INSERT INTO admin_internal_notes (manufacturer_id, admin_id, note, shared_with_manufacturer)
            VALUES (CAST(:o AS uuid), :a, :n, :s)
        """), {"o": org_id, "a": admin_id, "n": note.strip(), "s": shared})

    # ------------------------------------------------------------------ admin-owned fields (XY-ADMIN-07/08)
    async def org_meta(self, org_id: str) -> dict | None:
        return await self.row("""
            SELECT o.id, o.record_type, o.entry_source, o.referral_source, o.assigned_admin_user_id,
                   o.is_archived, mo.status AS onboarding_raw_status
            FROM organizations o LEFT JOIN manufacturer_onboarding mo ON mo.organization_id=o.id
            WHERE o.id=CAST(:o AS uuid) AND o.organization_type='manufacturer'
            FOR UPDATE OF o
        """, {"o": org_id})

    async def set_org_field(self, org_id: str, column: str, value: Any) -> None:
        assert column in {"record_type", "entry_source", "referral_source", "assigned_admin_user_id"}
        await self.db.execute(text(f"UPDATE organizations SET {column}=:v, updated_at=now() WHERE id=CAST(:o AS uuid)"),
                              {"o": org_id, "v": value})

    async def set_review_status(self, org_id: str, status: str, admin_id: UUID, reason: str | None) -> None:
        db_status = REVIEW_TO_DB[status]
        await self.db.execute(text("""
            INSERT INTO manufacturer_onboarding (organization_id, status, reviewed_at, reviewed_by_user_id,
                                                 rejection_reason, submitted_at)
            VALUES (CAST(:o AS uuid), :s, CASE WHEN :s='approved' THEN now() END,
                    CASE WHEN :s='approved' THEN CAST(:a AS uuid) END,
                    CASE WHEN :s='changes_requested' THEN :reason END,
                    CASE WHEN :s='submitted' THEN now() END)
            ON CONFLICT (organization_id) DO UPDATE SET status=EXCLUDED.status,
              reviewed_at=CASE WHEN :s IN ('approved','changes_requested') THEN now()
                               ELSE manufacturer_onboarding.reviewed_at END,
              reviewed_by_user_id=CASE WHEN :s IN ('approved','changes_requested') THEN CAST(:a AS uuid)
                                       ELSE manufacturer_onboarding.reviewed_by_user_id END,
              rejection_reason=CASE WHEN :s='changes_requested' THEN :reason
                                    ELSE manufacturer_onboarding.rejection_reason END,
              submitted_at=CASE WHEN :s='submitted' THEN coalesce(manufacturer_onboarding.submitted_at, now())
                                ELSE manufacturer_onboarding.submitted_at END,
              version=manufacturer_onboarding.version+1
        """), {"o": org_id, "s": db_status, "a": str(admin_id), "reason": (reason or "").strip() or None})

    async def set_archived(self, org_ids: list[str], archived: bool) -> list[str]:
        rows = await self.db.execute(text("""
            UPDATE organizations SET is_archived=:a, archived_at=CASE WHEN :a THEN now() END, updated_at=now()
            WHERE id = ANY(CAST(:ids AS uuid[])) AND organization_type='manufacturer' AND is_archived <> :a
            RETURNING id
        """), {"ids": org_ids, "a": archived})
        return [str(r[0]) for r in rows]

    async def record_types(self, org_ids: list[str]) -> dict[str, str]:
        rows = await self.db.execute(text("""
            SELECT id, record_type FROM organizations
            WHERE id = ANY(CAST(:ids AS uuid[])) AND organization_type='manufacturer'
        """), {"ids": org_ids})
        return {str(r[0]): r[1] for r in rows}

    # ------------------------------------------------------------------ account fields edited by admins
    async def update_account_field(self, ctx: dict, key: str, value: Any, country_code: str | None) -> None:
        column_values = {
            "account.companyType": {"company_category": value or None},
            "account.country": {"country_name": value or None, "country_code": country_code},
            "account.capacity": {"production_capacity_label": value or None},
            "contact.email": {"contact_email": value or None},
            "contact.phone": {"contact_phone": value or None},
        }[key]
        if key == "account.capacity":
            from app.repositories.manufacturer import capacity_number
            column_values["stated_production_capacity"] = capacity_number(value)
        cols = list(column_values)
        await self.db.execute(text(
            f"INSERT INTO organization_profiles (organization_id, {', '.join(cols)}) "
            f"VALUES (:organization_id, {', '.join(':' + c for c in cols)}) "
            f"ON CONFLICT (organization_id) DO UPDATE SET "
            f"{', '.join(f'{c}=EXCLUDED.{c}' for c in cols)}, updated_at=now()"),
            {"organization_id": ctx["organization_id"], **column_values})

    # ------------------------------------------------------------------ users (XY-ADMIN-03)
    USER_SELECT = """
        WITH mf AS (
          SELECT DISTINCT ON (user_id) user_id, organization_id, company_name, review_status, completeness,
                 record_type, is_archived, entry_source
          FROM admin_manufacturer_overview WHERE user_id IS NOT NULL
          ORDER BY user_id, is_archived, registered_at
        )
        SELECT u.id, u.clerk_user_id, u.first_name, u.last_name, u.display_name, u.email::text AS email, u.phone,
               u.status AS account_status, u.created_at, u.last_seen_at, u.record_type AS user_record_type,
               u.registration_channel, u.registration_method, u.registration_completed_at,
               coalesce((SELECT array_agg(role_selected ORDER BY selected_at) FROM marketplace_role_selections r
                         WHERE r.user_id=u.id AND r.status='active'), '{}') AS roles,
               EXISTS (SELECT 1 FROM platform_role_assignments p WHERE p.user_id=u.id
                       AND p.status='active' AND p.revoked_at IS NULL) AS is_admin,
               mf.organization_id, mf.company_name, mf.completeness, mf.record_type, mf.entry_source,
               coalesce(mf.review_status, 'NO_PROFILE') AS onboarding_status,
               -- every manufacturer company the user is an active member of, each with its own
               -- onboarding source (NULL = unknown) and, separately, its approval status
               coalesce((SELECT json_agg(json_build_object(
                           'id', lc.organization_id, 'name', lc.company_name, 'source', lo.onboarding_source,
                           'stagedSource', (SELECT json_build_object('source', ss.source, 'status', ss.status) FROM manufacturer_submissions ss
                                  WHERE ss.target_organization_id = lo.id AND ss.organization_id = ss.target_organization_id
                                    AND ss.kind = 'new_company' ORDER BY ss.updated_at DESC LIMIT 1),
                           'sourceNote', (SELECT bl.evidence->>'why' FROM onboarding_source_backfill_log bl
                                          WHERE bl.record_type = 'company' AND bl.record_id = lo.id
                                            AND bl.field = 'onboarding_source' AND bl.outcome <> 'applied'),
                           'reviewStatus', lc.review_status, 'recordType', lc.record_type,
                           'membershipRole', lmm.membership_role,
                           'isArchived', lc.is_archived)
                         ORDER BY lc.is_archived, lc.registered_at)
                         FROM memberships lmm
                         JOIN admin_manufacturer_overview lc ON lc.organization_id = lmm.organization_id
                         JOIN organizations lo ON lo.id = lmm.organization_id
                         WHERE lmm.user_id = u.id AND lmm.status = 'active'), '[]'::json) AS companies,
               aa.last_login_at AS password_last_login, aa.status AS password_account_status
        FROM users u LEFT JOIN mf ON mf.user_id=u.id LEFT JOIN admin_accounts aa ON aa.user_id=u.id
    """

    # Admins (an active admin role, or a staff-only admin account) are listed in the Admins tab,
    # not among registered users.
    NOT_ADMIN = """(u.clerk_user_id NOT LIKE 'local-admin:%' AND NOT EXISTS (
        SELECT 1 FROM platform_role_assignments pa WHERE pa.user_id=u.id
          AND pa.status='active' AND pa.revoked_at IS NULL))"""

    async def users(self, f: dict, page: int, page_size: int) -> dict:
        where, p = [self.NOT_ADMIN], {}
        if f.get("q"):
            where.append("(concat_ws(' ', u.first_name, u.last_name) ILIKE :q OR u.display_name ILIKE :q "
                         "OR u.email::text ILIKE :q OR mf.company_name ILIKE :q)")
            p["q"] = f"%{f['q'].strip()}%"
        if f.get("role") in USER_ROLE_FILTERS:
            where.append("""EXISTS (SELECT 1 FROM marketplace_role_selections rs WHERE rs.user_id = u.id
                            AND rs.status = 'active' AND rs.role_selected = :role)""")
            p["role"] = USER_ROLE_FILTERS[f["role"]]
        if f.get("account_status") in ACCOUNT_STATUSES:
            where.append("u.status = :account_status")
            p["account_status"] = f["account_status"]
        if f.get("onboarding_status") == "NO_PROFILE":
            where.append("mf.organization_id IS NULL")
        elif f.get("onboarding_status") in REVIEW_STATUSES:
            where.append("mf.review_status = :onb")
            p["onb"] = f["onboarding_status"]
        # Real / demo counts under the other filters, so the Data filter can show both numbers.
        base = ("WHERE " + " AND ".join(where)) if where else ""
        counts = (await self.db.execute(text(f"""
            SELECT count(*) FILTER (WHERE coalesce(t.record_type, 'REAL') = 'REAL'
                                      AND t.user_record_type = 'REAL') AS n_real,
                   count(*) FILTER (WHERE t.record_type IN ('DEMO', 'TEST')
                                       OR t.user_record_type IN ('DEMO', 'TEST')) AS n_demo,
                   count(*) AS n_all
            FROM ({self.USER_SELECT} {base}) t"""), p)).mappings().one()
        counts = {k: int(counts[f"n_{k}"]) for k in DATA_SCOPES}
        data = f.get("data") if f.get("data") in DATA_SCOPES else "all"
        if data in USER_DATA_SQL:
            where.append(USER_DATA_SQL[data])
        clause = "WHERE " + " AND ".join(where)
        rows = await self.rows(f"{self.USER_SELECT} {clause} ORDER BY u.created_at DESC LIMIT :limit OFFSET :offset",
                               {**p, "limit": page_size, "offset": (page - 1) * page_size})
        return {"total": counts[data], "rows": rows, "data_counts": counts}

    async def user(self, user_id: str) -> dict | None:
        return await self.row(f"{self.USER_SELECT} WHERE u.id=CAST(:u AS uuid)", {"u": user_id})

    async def user_manufacturers(self, user_id: str) -> list[dict]:
        return await self.rows("""
            SELECT v.organization_id, v.company_name, v.review_status, v.completeness, v.record_type,
                   v.is_archived, m.membership_role, m.status AS membership_status, v.entry_source,
                   (SELECT o.onboarding_source FROM organizations o WHERE o.id = v.organization_id) AS onboarding_source,
                   (SELECT json_build_object('source', ss.source, 'status', ss.status) FROM manufacturer_submissions ss
                     WHERE ss.target_organization_id = v.organization_id AND ss.organization_id = ss.target_organization_id
                       AND ss.kind = 'new_company' ORDER BY ss.updated_at DESC LIMIT 1) AS staged_source,
                   (SELECT count(*) FROM machines mc WHERE mc.organization_id = v.organization_id
                      AND mc.status <> 'archived') AS machinery_count
            FROM memberships m JOIN admin_manufacturer_overview v ON v.organization_id=m.organization_id
            WHERE m.user_id=CAST(:u AS uuid) AND m.status='active' ORDER BY v.registered_at
        """, {"u": user_id})

    # ------------------------------------------------------------------ onboarding source + history
    async def onboarding_info(self, org_id: str) -> dict:
        org = await self.row("""
            SELECT o.onboarding_source, b.id AS batch_id, b.source_reference, b.imported_by, b.created_at AS imported_at,
                   bl.outcome AS backfill_outcome, bl.rule AS backfill_rule, bl.evidence AS backfill_evidence,
                   bl.created_at AS backfill_at,
                   (SELECT json_build_object('source', ss.source, 'status', ss.status) FROM manufacturer_submissions ss
       WHERE ss.target_organization_id = o.id AND ss.organization_id = ss.target_organization_id
         AND ss.kind = 'new_company' ORDER BY ss.updated_at DESC LIMIT 1) AS staged_source
            FROM organizations o LEFT JOIN import_batches b ON b.id = o.import_batch_id
            LEFT JOIN onboarding_source_backfill_log bl ON bl.record_type = 'company' AND bl.record_id = o.id
                 AND bl.field = 'onboarding_source'
            WHERE o.id = CAST(:o AS uuid)
        """, {"o": org_id}) or {}
        events = await self.rows("""
            SELECT e.id, e.event, e.source, e.actor_role, e.details, e.created_at, e.submission_id,
                   s.kind AS submission_kind,
                   coalesce(nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.display_name,
                            u.email::text) AS actor
            FROM manufacturer_submission_events e
            LEFT JOIN manufacturer_submissions s ON s.id = e.submission_id
            LEFT JOIN users u ON u.id = e.actor_user_id
            WHERE e.organization_id = CAST(:o AS uuid)
            ORDER BY e.created_at DESC LIMIT 50
        """, {"o": org_id})
        return {"org": org, "events": events}

    # ------------------------------------------------------------------ visionaries (demand side)
    # A Visionary = a non-admin user who chose the Visionary role (marketplace_role_selections
    # 'demand_requester', active) or saved a Visionary profile. One row per user.
    VISIONARY_WHERE = f"""{NOT_ADMIN} AND (
        EXISTS (SELECT 1 FROM marketplace_role_selections rs WHERE rs.user_id = u.id
                AND rs.role_selected = 'demand_requester' AND rs.status = 'active')
        OR EXISTS (SELECT 1 FROM visionary_profiles vp0 WHERE vp0.user_id = u.id))"""
    VISIONARY_SELECT = """
        SELECT u.id, u.first_name, u.last_name, u.display_name, u.email::text AS email, u.phone,
               u.status AS account_status, u.created_at, u.last_seen_at, u.record_type,
               vp.full_name, vp.role_title, vp.organization_name, vp.location, vp.introduction,
               vp.organization_id AS buyer_organization_id, vp.created_at AS profile_created_at,
               vp.updated_at AS profile_updated_at,
               (SELECT count(*) FROM visionary_projects pj WHERE pj.user_id = u.id) AS project_count,
               (SELECT count(*) FROM manufacturer_booking_requests br
                  JOIN visionary_request_details d ON d.booking_request_id = br.id
                 WHERE br.requested_by_user_id = u.id) AS request_count,
               (SELECT max(x) FROM (VALUES (vp.updated_at),
                  ((SELECT max(pj.updated_at) FROM visionary_projects pj WHERE pj.user_id = u.id)),
                  ((SELECT max(br.created_at) FROM manufacturer_booking_requests br
                     WHERE br.requested_by_user_id = u.id))) AS t(x)) AS last_saved_at
        FROM users u LEFT JOIN visionary_profiles vp ON vp.user_id = u.id
    """

    async def visionaries(self, f: dict, page: int, page_size: int) -> dict:
        where, p = [self.VISIONARY_WHERE], {}
        if f.get("q"):
            where.append("""(concat_ws(' ', u.first_name, u.last_name) ILIKE :q OR u.display_name ILIKE :q
                             OR u.email::text ILIKE :q OR vp.full_name ILIKE :q OR vp.organization_name ILIKE :q
                             OR vp.location ILIKE :q)""")
            p["q"] = f"%{f['q'].strip()}%"
        if f.get("account_status") in ACCOUNT_STATUSES:
            where.append("u.status = :account_status")
            p["account_status"] = f["account_status"]
        if f.get("profile") == "saved":
            where.append("vp.user_id IS NOT NULL")
        elif f.get("profile") == "missing":
            where.append("vp.user_id IS NULL")
        base = "WHERE " + " AND ".join(where)
        counts = (await self.db.execute(text(f"""
            SELECT count(*) FILTER (WHERE u.record_type = 'REAL') AS n_real,
                   count(*) FILTER (WHERE u.record_type IN ('DEMO', 'TEST')) AS n_demo, count(*) AS n_all
            FROM users u LEFT JOIN visionary_profiles vp ON vp.user_id = u.id {base}"""), p)).mappings().one()
        counts = {k: int(counts[f"n_{k}"]) for k in DATA_SCOPES}
        data = f.get("data") if f.get("data") in DATA_SCOPES else "all"
        if data == "real":
            where.append("u.record_type = 'REAL'")
        elif data == "demo":
            where.append("u.record_type IN ('DEMO', 'TEST')")
        clause = "WHERE " + " AND ".join(where)
        rows = await self.rows(f"{self.VISIONARY_SELECT} {clause} ORDER BY u.created_at DESC, u.id "
                               "LIMIT :limit OFFSET :offset", {**p, "limit": page_size, "offset": (page - 1) * page_size})
        return {"total": counts[data], "rows": rows, "data_counts": counts}

    async def set_user_record_type(self, user_id: str, record_type: str, admin_id, reason: str | None) -> str | None:
        """Marks a person as REAL / DEMO / TEST. Returns the previous value (None = not found)."""
        old = await self.db.scalar(text("SELECT record_type FROM users WHERE id = CAST(:u AS uuid) FOR UPDATE"),
                                   {"u": user_id})
        if old is None or old == record_type:
            return old
        await self.db.execute(text("UPDATE users SET record_type = :t, updated_at = now() WHERE id = CAST(:u AS uuid)"),
                              {"u": user_id, "t": record_type})
        await self.db.execute(text("""
            INSERT INTO user_activity_events (user_id, clerk_user_id, kind, detail, actor_user_id)
            SELECT id, clerk_user_id, 'account_status', :d, :a FROM users WHERE id = CAST(:u AS uuid)
        """), {"u": user_id, "a": admin_id,
               "d": f"Data type changed from {old} to {record_type}" + (f": {reason.strip()}" if reason and reason.strip() else "")})
        return old

    async def visionary(self, user_id: str) -> dict | None:
        return await self.row(f"{self.VISIONARY_SELECT} WHERE u.id = CAST(:u AS uuid) AND {self.VISIONARY_WHERE}",
                              {"u": user_id})

    async def visionary_projects(self, user_id: str) -> list[dict]:
        return await self.rows("""
            SELECT pj.id, op.title AS project_name, op.narrative AS idea_description, op.status AS opportunity_status,
                   pj.product, pj.industry, pj.project_stage, pj.manufacturing_location, pj.quantity, pj.quantity_unit,
                   pj.budget_amount, pj.budget_currency, pj.timeline, pj.additional_requirements,
                   pj.idea_saved_at, pj.stage_saved_at, pj.requirements_saved_at, pj.created_at, pj.updated_at,
                   (SELECT count(*) FROM visionary_request_details d WHERE d.project_id = pj.id) AS request_count
            FROM visionary_projects pj JOIN opportunities op ON op.id = pj.opportunity_id
            WHERE pj.user_id = CAST(:u AS uuid)
            ORDER BY pj.created_at DESC, pj.id
        """, {"u": user_id})

    async def visionary_requests(self, user_id: str) -> list[dict]:
        return await self.rows("""
            SELECT br.id, br.request_number, br.status, br.requested_capacity, br.unit_code, br.created_at,
                   br.responded_at, br.manufacturer_organization_id, mo.display_name AS manufacturer_name,
                   d.project_id, d.project_name, d.machine_name, d.required_duration, d.manufacturing_location,
                   d.budget_amount, d.budget_currency, d.timeline, d.additional_requirements
            FROM manufacturer_booking_requests br
            JOIN visionary_request_details d ON d.booking_request_id = br.id
            JOIN organizations mo ON mo.id = br.manufacturer_organization_id
            WHERE br.requested_by_user_id = CAST(:u AS uuid)
            ORDER BY br.created_at DESC, br.id
        """, {"u": user_id})

    async def visionary_draft_count(self, user_id: str) -> int:
        return int(await self.db.scalar(text(
            "SELECT count(*) FROM visionary_request_drafts WHERE user_id = CAST(:u AS uuid)"), {"u": user_id}) or 0)

    # ------------------------------------------------------------------ machinery (company assets)
    async def machinery(self, f: dict, page: int, page_size: int) -> dict:
        """Machinery records of manufacturer companies (not archived companies), newest first."""
        where = ["o.organization_type = 'manufacturer'", "NOT o.is_archived"]
        p: dict = {}
        if f.get("q"):
            where.append(f"(m.name ILIKE :q OR {COMPANY_NAME_SQL} ILIKE :q OR m.manufacturer ILIKE :q OR m.model ILIKE :q)")
            p["q"] = f"%{f['q'].strip()}%"
        if f.get("status") in MACHINE_STATUSES:
            where.append(f"({MACHINE_STATUS_SQL}) = :status")
            p["status"] = f["status"]
        if f.get("org"):
            where.append("m.organization_id = CAST(:org AS uuid)")
            p["org"] = f["org"]
        clause = "WHERE " + " AND ".join(where)
        base = f"FROM machines m JOIN organizations o ON o.id = m.organization_id {clause}"
        total = await self.db.scalar(text(f"SELECT count(*) {base}"), p)
        rows = await self.rows(f"""
            SELECT m.id, m.name, m.manufacturer AS maker, m.model, m.year, m.created_at,
                   {MACHINE_STATUS_SQL} AS listing_status,
                   o.id AS organization_id, {COMPANY_NAME_SQL} AS company_name, o.record_type,
                   (SELECT ms.value_text FROM machine_specs ms WHERE ms.machine_id = m.id
                      AND ms.spec_code = 'industry' LIMIT 1) AS industry,
                   (SELECT ms.value_text FROM machine_specs ms WHERE ms.machine_id = m.id
                      AND ms.spec_code = 'capacity' LIMIT 1) AS capacity,
                   (SELECT count(*) FROM machine_images mi WHERE mi.machine_id = m.id) AS image_count,
                   ap.capacity AS plan, ap.recurring AS hours
            {base.replace("WHERE", "LEFT JOIN manufacturer_availability_preferences ap ON ap.organization_id = o.id WHERE", 1)}
            ORDER BY m.created_at DESC, m.id LIMIT :limit OFFSET :offset
        """, {**p, "limit": page_size, "offset": (page - 1) * page_size})
        company = None
        if f.get("org"):
            company = await self.db.scalar(text(f"SELECT {COMPANY_NAME_SQL} FROM organizations o WHERE o.id = CAST(:o AS uuid)"),
                                           {"o": f["org"]})
        return {"total": total, "rows": rows, "company": company}

    async def set_user_status(self, user_id: str, status: str, admin_id: UUID, reason: str) -> None:
        await self.db.execute(text("UPDATE users SET status=:s, updated_at=now() WHERE id=CAST(:u AS uuid)"),
                              {"u": user_id, "s": status})
        await self.db.execute(text("""
            INSERT INTO user_activity_events (user_id, clerk_user_id, kind, detail, actor_user_id)
            SELECT id, clerk_user_id, 'account_status', :d, :a FROM users WHERE id=CAST(:u AS uuid)
        """), {"u": user_id, "a": admin_id,
                "d": f"{'Suspended' if status == 'suspended' else 'Reactivated'} by admin: {reason.strip()}"})

    # ------------------------------------------------------------------ troubleshooting (XY-ADMIN-10)
    async def troubleshooting(self, user_id: str) -> dict:
        activity = await self.row("""
            SELECT
              (SELECT max(p.updated_at) FROM manufacturer_form_progress p
                 JOIN memberships m ON m.organization_id=p.organization_id
                WHERE m.user_id=CAST(:u AS uuid) AND m.status='active') AS last_step_save,
              (SELECT max(op.updated_at) FROM organization_profiles op
                 JOIN memberships m ON m.organization_id=op.organization_id
                WHERE m.user_id=CAST(:u AS uuid) AND m.status='active') AS last_profile_save,
              (SELECT p.current_step || '/' || p.total_steps FROM manufacturer_form_progress p
                 JOIN memberships m ON m.organization_id=p.organization_id
                WHERE m.user_id=CAST(:u AS uuid) AND m.status='active' AND p.form_key='company_profile'
                ORDER BY p.updated_at DESC LIMIT 1) AS profile_wizard_step
        """, {"u": user_id})
        events = await self.rows("""
            SELECT e.kind, e.method, e.path, e.status_code, e.detail, e.request_id, e.created_at,
                   coalesce(nullif(btrim(concat_ws(' ', a.first_name, a.last_name)), ''), a.display_name) AS actor
            FROM user_activity_events e
            JOIN users u ON u.clerk_user_id=e.clerk_user_id OR u.id=e.user_id
            LEFT JOIN users a ON a.id=e.actor_user_id
            WHERE u.id=CAST(:u AS uuid) ORDER BY e.created_at DESC LIMIT 20
        """, {"u": user_id})
        return {"activity": activity, "events": events}

    async def user_emails(self, user_id: str, limit: int = 10) -> list[dict]:
        return await self.rows("""
            SELECT id, to_email::text AS to_email, template, subject, status, error, created_at
            FROM email_deliveries WHERE user_id=CAST(:u AS uuid) ORDER BY created_at DESC LIMIT :n
        """, {"u": user_id, "n": limit})

    async def recent_emails(self, limit: int = 25) -> list[dict]:
        return await self.rows("""
            SELECT id, to_email::text AS to_email, template, subject, status, error, created_at
            FROM email_deliveries ORDER BY created_at DESC LIMIT :n
        """, {"n": limit})

    async def recent_errors(self, limit: int = 25) -> list[dict]:
        return await self.rows("""
            SELECT e.method, e.path, e.status_code, e.detail, e.request_id, e.created_at,
                   u.id AS user_id, u.email::text AS email,
                   coalesce(nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.display_name) AS name
            FROM user_activity_events e LEFT JOIN users u ON u.clerk_user_id=e.clerk_user_id
            WHERE e.kind='error' ORDER BY e.created_at DESC LIMIT :n
        """, {"n": limit})

    # ------------------------------------------------------------------ analytics (XY-ADMIN-09)
    async def analytics(self, date_from: date | None, date_to: date | None, include_test: bool) -> dict:
        p = {"from": date_from, "to": date_to}
        rng = ("(CAST(:from AS date) IS NULL OR registered_at >= CAST(:from AS date)) AND "
               "(CAST(:to AS date) IS NULL OR registered_at < CAST(:to AS date) + 1)")
        types = "" if include_test else "AND record_type='REAL'"
        scope = f"NOT is_archived {types} AND {rng}"
        totals = await self.row(f"""
            SELECT count(*) AS manufacturers,
                   count(*) FILTER (WHERE completeness=100) AS completed,
                   count(*) FILTER (WHERE completeness<100) AS incomplete,
                   (SELECT count(*) FROM users u WHERE u.status<>'deactivated' AND {self.NOT_ADMIN}
                      AND (CAST(:from AS date) IS NULL OR u.created_at >= CAST(:from AS date))
                      AND (CAST(:to AS date) IS NULL OR u.created_at < CAST(:to AS date) + 1)) AS users,
                   (SELECT count(*) FROM users u WHERE u.status<>'deactivated' AND {self.NOT_ADMIN}
                      AND (CAST(:from AS date) IS NULL OR u.created_at >= CAST(:from AS date))
                      AND (CAST(:to AS date) IS NULL OR u.created_at < CAST(:to AS date) + 1)
                      AND NOT EXISTS (SELECT 1 FROM memberships m JOIN organizations o ON o.id=m.organization_id
                                      WHERE m.user_id=u.id AND o.organization_type='manufacturer')) AS users_without_profile
            FROM admin_manufacturer_overview WHERE {scope}
        """, p)
        incomplete = await self.rows(f"""
            SELECT {', '.join(c for c, _, _ in REQUIRED_FIELDS)} FROM admin_manufacturer_overview
            WHERE {scope} AND completeness < 100
        """, p)
        by = {}
        for key, expr, empty in (("industry", "industry", "Not specified"),
                                 ("location", "country", "Not specified"),
                                 ("process", "major_process", "No listings yet"),
                                 ("referral", "referral_source", "Not recorded"),
                                 ("reviewStatus", "review_status", "-")):
            by[key] = await self.rows(f"""
                SELECT coalesce(nullif(btrim({expr}), ''), :empty) AS label, count(*) AS count
                FROM admin_manufacturer_overview WHERE {scope}
                GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 12
            """, {**p, "empty": empty})
        entry = await self.rows(f"""
            SELECT entry_source AS label, count(*) AS count,
                   count(*) FILTER (WHERE completeness=100) AS completed
            FROM admin_manufacturer_overview WHERE {scope} GROUP BY 1 ORDER BY 2 DESC
        """, p)
        missing = await self.row(f"""
            SELECT {', '.join(f'count(*) FILTER (WHERE NOT {c}) AS {c}' for c, _, _ in REQUIRED_FIELDS)}
            FROM admin_manufacturer_overview WHERE {scope}
        """, p)
        excluded = await self.db.scalar(text(f"""
            SELECT count(*) FROM admin_manufacturer_overview
            WHERE NOT is_archived AND record_type IN ('DEMO','TEST') AND {rng}
        """), p)
        return {"totals": totals, "incomplete": incomplete, "by": by, "entry": entry, "missing": missing,
                "excluded": excluded}
