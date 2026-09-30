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
}
REVIEW_STATUSES = tuple(REVIEW_TO_DB)
RECORD_TYPES = ("REAL", "DEMO", "TEST")
ENTRY_SOURCES = ("MANUFACTURER", "ADMIN_ASSISTED", "IMPORTED")
ACCOUNT_STATUSES = ("active", "suspended", "deactivated")

# (column in the view, label, onboarding section) - the 14 required items, in form order.
REQUIRED_FIELDS = [
    ("r_first_name", "First name", "Personal info"),
    ("r_last_name", "Last name", "Personal info"),
    ("r_contact", "Email or phone", "Personal info"),
    ("r_dob", "Date of birth", "Personal info"),
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
    r_about, r_address, r_city, r_location_country, r_certification, r_infrastructure, r_faq
"""
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
              (SELECT count(*) FROM users WHERE status<>'deactivated' AND clerk_user_id NOT LIKE 'local-admin:%') AS total_users,
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

    async def manufacturers(self, f: dict, page: int, page_size: int, sort: str) -> dict:
        where, p = self._filters(f)
        clause = ("WHERE " + " AND ".join(where)) if where else ""
        total = await self.db.scalar(text(f"SELECT count(*) FROM admin_manufacturer_overview {clause}"), p)
        rows = await self.rows(f"""
            SELECT {LIST_COLUMNS} FROM admin_manufacturer_overview {clause}
            ORDER BY {SORTS.get(sort, SORTS['updated'])} LIMIT :limit OFFSET :offset
        """, {**p, "limit": page_size, "offset": (page - 1) * page_size})
        facets = await self.row("""
            SELECT array_remove(array_agg(DISTINCT industry ORDER BY industry), NULL) AS industries,
                   array_remove(array_agg(DISTINCT country ORDER BY country), NULL) AS countries
            FROM admin_manufacturer_overview
        """)
        return {"total": total, "rows": rows, "facets": facets}

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
            SELECT {LIST_COLUMNS} FROM admin_manufacturer_overview {clause}
            ORDER BY array_position(ARRAY['SUBMITTED','NEEDS_CORRECTION','IN_PROGRESS','NOT_STARTED','REVIEWED'],
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

    async def history(self, org_id: str) -> list[dict]:
        return await self.rows("""
            SELECT h.id, h.field_changed, h.old_value, h.new_value, h.reason, h.created_at,
                   coalesce(nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.display_name) AS changed_by
            FROM admin_change_history h LEFT JOIN users u ON u.id=h.changed_by
            WHERE h.manufacturer_id=CAST(:o AS uuid) ORDER BY h.created_at DESC LIMIT 200
        """, {"o": org_id})

    async def notes(self, org_id: str) -> list[dict]:
        return await self.rows("""
            SELECT n.id, n.note, n.created_at,
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

    async def add_note(self, org_id: str, admin_id: UUID, note: str) -> None:
        await self.db.execute(text("""
            INSERT INTO admin_internal_notes (manufacturer_id, admin_id, note) VALUES (CAST(:o AS uuid), :a, :n)
        """), {"o": org_id, "a": admin_id, "n": note.strip()})

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
                 record_type, is_archived
          FROM admin_manufacturer_overview WHERE user_id IS NOT NULL
          ORDER BY user_id, is_archived, registered_at
        )
        SELECT u.id, u.clerk_user_id, u.first_name, u.last_name, u.display_name, u.email::text AS email, u.phone,
               u.status AS account_status, u.created_at, u.last_seen_at,
               coalesce((SELECT array_agg(role_selected ORDER BY selected_at) FROM marketplace_role_selections r
                         WHERE r.user_id=u.id AND r.status='active'), '{}') AS roles,
               EXISTS (SELECT 1 FROM platform_role_assignments p WHERE p.user_id=u.id
                       AND p.status='active' AND p.revoked_at IS NULL) AS is_admin,
               mf.organization_id, mf.company_name, mf.completeness, mf.record_type,
               coalesce(mf.review_status, 'NO_PROFILE') AS onboarding_status,
               aa.last_login_at AS password_last_login, aa.status AS password_account_status
        FROM users u LEFT JOIN mf ON mf.user_id=u.id LEFT JOIN admin_accounts aa ON aa.user_id=u.id
    """

    async def users(self, f: dict, page: int, page_size: int) -> dict:
        where, p = [], {}
        if f.get("q"):
            where.append("(concat_ws(' ', u.first_name, u.last_name) ILIKE :q OR u.display_name ILIKE :q "
                         "OR u.email::text ILIKE :q OR mf.company_name ILIKE :q)")
            p["q"] = f"%{f['q'].strip()}%"
        if f.get("account_status") in ACCOUNT_STATUSES:
            where.append("u.status = :account_status")
            p["account_status"] = f["account_status"]
        if f.get("onboarding_status") == "NO_PROFILE":
            where.append("mf.organization_id IS NULL")
        elif f.get("onboarding_status") in REVIEW_STATUSES:
            where.append("mf.review_status = :onb")
            p["onb"] = f["onboarding_status"]
        clause = ("WHERE " + " AND ".join(where)) if where else ""
        total = await self.db.scalar(text(f"SELECT count(*) FROM ({self.USER_SELECT} {clause}) t"), p)
        rows = await self.rows(f"{self.USER_SELECT} {clause} ORDER BY u.created_at DESC LIMIT :limit OFFSET :offset",
                               {**p, "limit": page_size, "offset": (page - 1) * page_size})
        return {"total": total, "rows": rows}

    async def user(self, user_id: str) -> dict | None:
        return await self.row(f"{self.USER_SELECT} WHERE u.id=CAST(:u AS uuid)", {"u": user_id})

    async def user_manufacturers(self, user_id: str) -> list[dict]:
        return await self.rows("""
            SELECT v.organization_id, v.company_name, v.review_status, v.completeness, v.record_type,
                   v.is_archived, m.membership_role
            FROM memberships m JOIN admin_manufacturer_overview v ON v.organization_id=m.organization_id
            WHERE m.user_id=CAST(:u AS uuid) AND m.status='active' ORDER BY v.registered_at
        """, {"u": user_id})

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
                   (SELECT count(*) FROM users WHERE status<>'deactivated' AND clerk_user_id NOT LIKE 'local-admin:%'
                      AND (CAST(:from AS date) IS NULL OR created_at >= CAST(:from AS date))
                      AND (CAST(:to AS date) IS NULL OR created_at < CAST(:to AS date) + 1)) AS users,
                   (SELECT count(*) FROM users u WHERE u.status<>'deactivated' AND u.clerk_user_id NOT LIKE 'local-admin:%'
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
