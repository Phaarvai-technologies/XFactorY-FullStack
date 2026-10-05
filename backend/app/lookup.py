"""Find test data quickly. Read-only: this command never changes the database.

    PYTHONPATH=. python -m app.lookup user  you@example.com     # everything stored for one person
    PYTHONPATH=. python -m app.lookup user  meera                # part of an email: lists the matches
    PYTHONPATH=. python -m app.lookup recent 15                  # newest sign-ups and what each one has
    PYTHONPATH=. python -m app.lookup company "Sri Lakshmi"      # manufacturers / buyers by company name
    PYTHONPATH=. python -m app.lookup request REQ-20261003-AB12CD   # one manufacturing request, both sides
    PYTHONPATH=. python -m app.lookup errors 20                  # latest failed API calls, with the user

It uses DATABASE_URL from backend/.env, so it shows whichever database the backend uses
(local Postgres or Supabase). Passwords, password hashes and session tokens are never printed.
Long values are cut at 60 characters; put --wide first to see them in full:
    PYTHONPATH=. python -m app.lookup --wide user you@example.com
"""
import argparse
import asyncio
import datetime as dt
import decimal
import json
import sys
import uuid

from sqlalchemy import text

from app.core.database import SessionFactory

WIDE = False
LIMIT = 60


# ---------------------------------------------------------------- output helpers
def _fmt(v) -> str:
    if v is None:
        return "-"
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, dt.datetime):
        return v.strftime("%Y-%m-%d %H:%M")
    if isinstance(v, (dt.date, uuid.UUID, decimal.Decimal)):
        return str(v)
    if isinstance(v, (dict, list)):
        v = json.dumps(v, ensure_ascii=True, default=str)
    s = " ".join(str(v).split())
    return s if WIDE or len(s) <= LIMIT else s[: LIMIT - 3] + "..."


def heading(title: str) -> None:
    print(f"\n=== {title} " + "=" * max(3, 70 - len(title)))


def sub(title: str, rows: list, empty: str = "none") -> None:
    print(f"\n-- {title} ({len(rows)})" if rows else f"\n-- {title}: {empty}")
    if rows:
        table(rows)


def table(rows: list) -> None:
    cols = list(rows[0].keys())
    cells = [[_fmt(r[c]) for c in cols] for r in rows]
    widths = [max(len(c), *(len(row[i]) for row in cells)) for i, c in enumerate(cols)]
    print("  " + "  ".join(c.ljust(w) for c, w in zip(cols, widths)))
    print("  " + "  ".join("-" * w for w in widths))
    for row in cells:
        print("  " + "  ".join(v.ljust(w) for v, w in zip(row, widths)))


def record(title: str, row) -> None:
    print(f"\n-- {title}" + ("" if row else ": none"))
    if row:
        width = max(len(k) for k in row.keys())
        for k, v in row.items():
            print(f"  {k.ljust(width)}  {_fmt(v)}")


class Db:
    def __init__(self, session):
        self.s = session

    async def all(self, sql: str, **p) -> list:
        return [dict(r) for r in (await self.s.execute(text(sql), p)).mappings().all()]

    async def one(self, sql: str, **p):
        r = (await self.s.execute(text(sql), p)).mappings().first()
        return dict(r) if r else None


async def _session():
    s = SessionFactory()
    await s.execute(text("SET TRANSACTION READ ONLY"))
    return s


# ---------------------------------------------------------------- user
async def user(query: str) -> int:
    s = await _session()
    try:
        db = Db(s)
        q = query.strip()
        matches = await db.all("""
            SELECT id, email, display_name, status, created_at FROM users
            WHERE email = CAST(:q AS citext) OR email ILIKE '%' || :q || '%' OR id::text = :q OR clerk_user_id = :q
            ORDER BY (email = CAST(:q AS citext)) DESC, created_at DESC LIMIT 20""", q=q)
        if not matches:
            print(f"No user found for '{q}'. Try part of the email, or: python -m app.lookup recent")
            return 1
        exact = [m for m in matches if (m["email"] or "").lower() == q.lower() or str(m["id"]) == q]
        if len(matches) > 1 and not exact:
            print(f"{len(matches)} users match '{q}'. Run again with the full email:")
            table(matches)
            return 0
        await _user_report(db, (exact or matches)[0]["id"])
        return 0
    finally:
        await s.close()


async def _user_report(db: Db, uid) -> None:
    u = await db.one("""
        SELECT id, email, clerk_user_id, display_name, first_name, last_name, phone, date_of_birth,
               status, created_at, last_seen_at, welcome_email_sent_at
        FROM users WHERE id = :u""", u=uid)
    orgs = await db.all("""
        SELECT o.id AS org_id, o.display_name AS company, o.organization_type AS type, m.membership_role AS role,
               m.status AS membership, o.record_type, o.is_archived AS archived
        FROM memberships m JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = :u ORDER BY m.created_at""", u=uid)
    mfr = [o for o in orgs if o["type"] == "manufacturer"]
    project = await db.one("SELECT 1 AS x FROM visionary_projects WHERE user_id = :u LIMIT 1", u=uid)
    vprofile = await db.one("SELECT 1 AS x FROM visionary_profiles WHERE user_id = :u", u=uid)
    roles = await db.all("""
        SELECT platform_role FROM platform_role_assignments
        WHERE user_id = :u AND status = 'active' AND revoked_at IS NULL""", u=uid)
    errors = await db.one("""
        SELECT count(*) AS n FROM user_activity_events
        WHERE (user_id = :u OR clerk_user_id = :c) AND kind = 'error' AND created_at > now() - interval '7 days'""",
                          u=uid, c=u["clerk_user_id"])

    heading(f"{u['email']}  (user id {u['id']})")
    print(f"  Manufacturer account : {', '.join(o['company'] or '(no name)' for o in mfr) if mfr else 'no'}")
    print(f"  Visionary            : {'profile' if vprofile else 'no profile'}, {'has a project' if project else 'no project'}")
    print(f"  Admin                : {', '.join(r['platform_role'] for r in roles) if roles else 'no'}")
    print(f"  Failed calls (7 days): {errors['n']}")

    heading("Account  (users, user_auth_identities, marketplace_role_selections, memberships)")
    record("users", u)
    sub("user_auth_identities", await db.all("""
        SELECT provider, provider_subject, contact_verified_at, last_authenticated_at, created_at
        FROM user_auth_identities WHERE user_id = :u""", u=uid))
    sub("marketplace_role_selections (roles picked on /onboarding/roles)", await db.all("""
        SELECT role_selected, status, selected_at FROM marketplace_role_selections
        WHERE user_id = :u ORDER BY selected_at DESC LIMIT 12""", u=uid))
    sub("memberships -> organizations", orgs)

    for o in mfr:
        await _manufacturer(db, o["org_id"])
    await _visionary(db, uid)
    await _admin(db, uid)

    heading("Activity  (user_activity_events, email_deliveries)")
    sub("user_activity_events (latest 15)", await db.all("""
        SELECT created_at, kind, method, path, status_code, detail, request_id
        FROM user_activity_events WHERE user_id = :u OR clerk_user_id = :c
        ORDER BY created_at DESC LIMIT 15""", u=uid, c=u["clerk_user_id"]))
    sub("email_deliveries (latest 10)", await db.all("""
        SELECT created_at, template, to_email, status, error FROM email_deliveries
        WHERE user_id = :u OR to_email = CAST(:e AS citext) ORDER BY created_at DESC LIMIT 10""",
                                                      u=uid, e=u["email"]))


async def _manufacturer(db: Db, org) -> None:
    o = await db.one("""
        SELECT o.id, o.display_name, o.legal_name, o.status, o.verification_status, o.record_type, o.entry_source,
               o.referral_source, o.is_archived, a.email AS assigned_admin, o.created_at, o.updated_at
        FROM organizations o LEFT JOIN users a ON a.id = o.assigned_admin_user_id WHERE o.id = :o""", o=org)
    heading(f"Manufacturer: {o['display_name'] or '(no name)'}  (organization id {org})")
    record("organizations", o)
    record("organization_profiles", await db.one("""
        SELECT contact_email, contact_phone, country_name, company_category, business_type, organization_size,
               establishment_year, employee_count, about_company, vision, stated_production_capacity,
               production_capacity_label, logo_file_id, cover_file_id, updated_at
        FROM organization_profiles WHERE organization_id = :o""", o=org))
    record("manufacturer_onboarding", await db.one("""
        SELECT completion_percentage, status, current_step, personal_information_completed AS personal,
               company_information_completed AS company, location_completed AS location,
               certification_completed AS certification, infrastructure_completed AS infrastructure,
               faq_completed AS faq, submitted_at, reviewed_at, rejection_reason, updated_at
        FROM manufacturer_onboarding WHERE organization_id = :o""", o=org))
    sub("manufacturer_form_progress (wizard steps)", await db.all("""
        SELECT form_key, record_id, current_step, completed_steps, total_steps, status, updated_at
        FROM manufacturer_form_progress WHERE organization_id = :o ORDER BY updated_at DESC""", o=org))
    sub("facilities (address, serviceable areas)", await db.all("""
        SELECT name, is_headquarters AS hq, address_line1, city, state_province, country_name, postal_code,
               map_pin, serviceable_areas FROM facilities WHERE organization_id = :o""", o=org))
    sub("organization_certifications", await db.all("""
        SELECT ct.name AS certification, oc.status, oc.document_file_name, oc.created_at
        FROM organization_certifications oc JOIN certification_types ct ON ct.id = oc.certification_type_id
        WHERE oc.organization_id = :o ORDER BY oc.created_at""", o=org))
    sub("manufacturer_infrastructure", await db.all("""
        SELECT ii.name AS item, mi.boolean_value AS yes_no, mi.text_value, mi.numeric_value, mi.updated_at
        FROM manufacturer_infrastructure mi JOIN infrastructure_items ii ON ii.id = mi.infrastructure_item_id
        WHERE mi.organization_id = :o ORDER BY ii.display_order""", o=org))
    sub("manufacturer_faq_answers", await db.all("""
        SELECT q.question_text AS question, coalesce(a.text_value, a.boolean_value::text, a.numeric_value::text,
               a.option_values::text) AS answer, a.updated_at
        FROM manufacturer_faq_answers a JOIN manufacturer_faq_questions q ON q.id = a.question_id
        WHERE a.organization_id = :o ORDER BY a.display_order""", o=org))
    sub("machines (+ machine_specs, machine_images)", await db.all("""
        SELECT m.id, m.name, t.term AS type, m.status, m.publication_status AS published,
               (SELECT count(*) FROM machine_specs s WHERE s.machine_id = m.id) AS specs,
               (SELECT count(*) FROM machine_images i WHERE i.machine_id = m.id) AS images, m.created_at
        FROM machines m LEFT JOIN taxonomy_terms t ON t.id = m.machinery_term_id
        WHERE m.organization_id = :o ORDER BY m.created_at""", o=org))
    record("manufacturer_availability_preferences", await db.one("""
        SELECT (SELECT count(*) FROM jsonb_object_keys(CASE WHEN jsonb_typeof(calendar) = 'object'
                THEN calendar ELSE '{}'::jsonb END)) AS calendar_days, recurring, capacity, updated_at
        FROM manufacturer_availability_preferences WHERE organization_id = :o""", o=org))
    sub("manufacturer_booking_requests (received from visionaries)", await db.all("""
        SELECT br.request_number, br.status, ru.email AS requested_by, d.machine_name, br.requested_capacity AS qty,
               br.created_at, br.responded_at
        FROM manufacturer_booking_requests br LEFT JOIN users ru ON ru.id = br.requested_by_user_id
        LEFT JOIN visionary_request_details d ON d.booking_request_id = br.id
        WHERE br.manufacturer_organization_id = :o ORDER BY br.created_at DESC LIMIT 20""", o=org))
    sub("files (uploads: logo, cover, machine images)", await db.all("""
        SELECT purpose, filename, content_type, size_bytes, object_key, created_at
        FROM files WHERE organization_id = :o ORDER BY created_at DESC LIMIT 10""", o=org))
    sub("notifications (bell on the manufacturer dashboard)", await db.all("""
        SELECT n.created_at, u.email AS to_user, n.notification_type AS kind, n.title, n.body, n.read_at, n.popup_shown_at
        FROM notifications n LEFT JOIN users u ON u.id = n.user_id
        WHERE n.organization_id = :o ORDER BY n.created_at DESC LIMIT 15""", o=org))
    sub("admin_internal_notes", await db.all("""
        SELECT n.created_at, a.email AS admin, n.shared_with_manufacturer AS shared, n.note FROM admin_internal_notes n
        LEFT JOIN users a ON a.id = n.admin_id WHERE n.manufacturer_id = :o ORDER BY n.created_at DESC LIMIT 10""", o=org))
    sub("admin_change_history", await db.all("""
        SELECT h.created_at, a.email AS admin, h.field_changed, h.old_value, h.new_value, h.reason
        FROM admin_change_history h LEFT JOIN users a ON a.id = h.changed_by
        WHERE h.manufacturer_id = :o ORDER BY h.created_at DESC LIMIT 10""", o=org))


async def _visionary(db: Db, uid) -> None:
    profile = await db.one("""
        SELECT full_name, role_title, organization_name, location, introduction, organization_id, updated_at
        FROM visionary_profiles WHERE user_id = :u""", u=uid)
    projects = await db.all("""
        SELECT p.id, o.title AS project, o.status AS opportunity_status, p.product, p.industry, p.project_stage AS stage,
               p.manufacturing_location AS location, p.quantity, p.budget_amount AS budget, p.timeline, p.updated_at
        FROM visionary_projects p LEFT JOIN opportunities o ON o.id = p.opportunity_id
        WHERE p.user_id = :u ORDER BY p.created_at DESC""", u=uid)
    drafts = await db.all("""
        SELECT org.display_name AS manufacturer, d.machine_name, d.quantity, d.budget_amount, d.updated_at
        FROM visionary_request_drafts d LEFT JOIN organizations org ON org.id = d.manufacturer_organization_id
        WHERE d.user_id = :u ORDER BY d.updated_at DESC""", u=uid)
    sent = await db.all("""
        SELECT br.request_number, org.display_name AS manufacturer, d.machine_name, br.requested_capacity AS qty,
               br.status, br.created_at, br.responded_at
        FROM manufacturer_booking_requests br LEFT JOIN organizations org ON org.id = br.manufacturer_organization_id
        LEFT JOIN visionary_request_details d ON d.booking_request_id = br.id
        WHERE br.requested_by_user_id = :u ORDER BY br.created_at DESC""", u=uid)
    if not (profile or projects or drafts or sent):
        return
    heading("Visionary  (visionary_profiles, visionary_projects, opportunities, requests)")
    record("visionary_profiles", profile)
    sub("visionary_projects + opportunities", projects)
    sub("visionary_request_drafts", drafts)
    sub("requests sent (manufacturer_booking_requests + visionary_request_details)", sent)


async def _admin(db: Db, uid) -> None:
    acct = await db.one("""
        SELECT email, status, must_change_password, failed_attempts, locked_until, last_login_at,
               password_changed_at, created_at FROM admin_accounts WHERE user_id = :u""", u=uid)
    roles = await db.all("""
        SELECT r.platform_role, r.status, g.email AS granted_by, r.granted_at, r.revoked_at
        FROM platform_role_assignments r LEFT JOIN users g ON g.id = r.granted_by_user_id
        WHERE r.user_id = :u ORDER BY r.granted_at DESC""", u=uid)
    if not (acct or roles):
        return
    heading("Admin  (admin_accounts, platform_role_assignments, admin_sessions)")
    record("admin_accounts (password hash not shown)", acct)
    sub("platform_role_assignments", roles)
    sub("admin_sessions (latest 5, tokens not shown)", await db.all("""
        SELECT s.created_at, s.last_used_at, s.expires_at, s.revoked_at, s.ip_address
        FROM admin_sessions s JOIN admin_accounts a ON a.id = s.account_id
        WHERE a.user_id = :u ORDER BY s.created_at DESC LIMIT 5""", u=uid))


# ---------------------------------------------------------------- other lookups
async def recent(n: int) -> int:
    s = await _session()
    try:
        rows = await Db(s).all("""
            SELECT u.email, u.created_at,
                   (SELECT string_agg(DISTINCT r.role_selected, ',') FROM marketplace_role_selections r
                     WHERE r.user_id = u.id AND r.status = 'active') AS roles,
                   (SELECT o.display_name || ' (' || coalesce(mo.completion_percentage, 0) || '%)'
                      FROM memberships m JOIN organizations o ON o.id = m.organization_id
                      LEFT JOIN manufacturer_onboarding mo ON mo.organization_id = o.id
                     WHERE m.user_id = u.id AND o.organization_type = 'manufacturer' LIMIT 1) AS manufacturer,
                   (SELECT op.title FROM visionary_projects p JOIN opportunities op ON op.id = p.opportunity_id
                     WHERE p.user_id = u.id ORDER BY p.created_at DESC LIMIT 1) AS visionary_project,
                   EXISTS (SELECT 1 FROM platform_role_assignments a WHERE a.user_id = u.id AND a.status = 'active'
                           AND a.revoked_at IS NULL) AS admin,
                   u.status, u.last_seen_at
            FROM users u ORDER BY u.created_at DESC LIMIT :n""", n=n)
        heading(f"Newest {len(rows)} users")
        table(rows) if rows else print("  No users yet.")
        return 0
    finally:
        await s.close()


async def company(q: str) -> int:
    s = await _session()
    try:
        rows = await Db(s).all("""
            SELECT o.id, o.display_name AS company, o.organization_type AS type, o.record_type,
                   o.is_archived AS archived, mo.completion_percentage AS pct, mo.status AS onboarding,
                   (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
                     WHERE m.organization_id = o.id ORDER BY m.created_at LIMIT 1) AS owner_email, o.created_at
            FROM organizations o LEFT JOIN manufacturer_onboarding mo ON mo.organization_id = o.id
            WHERE o.display_name ILIKE '%' || :q || '%' OR o.legal_name ILIKE '%' || :q || '%' OR o.id::text = :q
            ORDER BY o.created_at DESC LIMIT 30""", q=q.strip())
        heading(f"Organizations matching '{q}'")
        table(rows) if rows else print("  None. Try a shorter part of the name.")
        if rows:
            print("\n  Full detail: python -m app.lookup user <owner_email>")
        return 0
    finally:
        await s.close()


async def request(q: str) -> int:
    s = await _session()
    try:
        db = Db(s)
        br = await db.one("""
            SELECT br.id, br.request_number, br.status, ru.email AS visionary_email, dem.display_name AS visionary_org,
                   mfr.display_name AS manufacturer, br.requested_capacity AS qty, br.requested_start_date,
                   br.requested_end_date, br.decline_reason, br.created_at, br.responded_at, br.engagement_id
            FROM manufacturer_booking_requests br
            LEFT JOIN users ru ON ru.id = br.requested_by_user_id
            LEFT JOIN organizations dem ON dem.id = br.demand_organization_id
            LEFT JOIN organizations mfr ON mfr.id = br.manufacturer_organization_id
            WHERE br.request_number = :q OR br.id::text = :q""", q=q.strip())
        if not br:
            print(f"No request '{q}'. Request numbers look like REQ-20261003-AB12CD.")
            return 1
        heading(f"Request {br['request_number']}")
        record("manufacturer_booking_requests", br)
        record("visionary_request_details", await db.one("""
            SELECT project_name, visionary_name, machine_name, required_duration, manufacturing_location,
                   budget_amount, budget_currency, timeline, additional_requirements
            FROM visionary_request_details WHERE booking_request_id = :b""", b=br["id"]))
        sub("manufacturer_booking_request_events (status history)", await db.all("""
            SELECT e.created_at, e.from_status, e.to_status, u.email AS by_user, e.reason
            FROM manufacturer_booking_request_events e LEFT JOIN users u ON u.id = e.actor_user_id
            WHERE e.booking_request_id = :b ORDER BY e.created_at""", b=br["id"]))
        sub("engagement_participants", await db.all("""
            SELECT p.role, o.display_name AS organization, u.email, p.status
            FROM engagement_participants p LEFT JOIN organizations o ON o.id = p.organization_id
            LEFT JOIN users u ON u.id = p.user_id WHERE p.engagement_id = :g""", g=br["engagement_id"]))
        return 0
    finally:
        await s.close()


async def errors(n: int) -> int:
    s = await _session()
    try:
        rows = await Db(s).all("""
            SELECT e.created_at, coalesce(u.email, e.clerk_user_id) AS who, e.method, e.path, e.status_code,
                   e.detail, e.request_id
            FROM user_activity_events e LEFT JOIN users u ON u.id = e.user_id
            WHERE e.kind = 'error' ORDER BY e.created_at DESC LIMIT :n""", n=n)
        heading(f"Latest {len(rows)} failed API calls")
        table(rows) if rows else print("  No failed calls recorded.")
        return 0
    finally:
        await s.close()


def main() -> int:
    global WIDE
    p = argparse.ArgumentParser(description="Find test data (read-only).")
    p.add_argument("--wide", action="store_true", help="show long values in full")
    cmd = p.add_subparsers(dest="cmd", required=True)
    cmd.add_parser("user", help="everything for one person").add_argument("email")
    cmd.add_parser("recent", help="newest users").add_argument("n", nargs="?", type=int, default=15)
    cmd.add_parser("company", help="organizations by name").add_argument("name")
    cmd.add_parser("request", help="one manufacturing request").add_argument("number")
    cmd.add_parser("errors", help="latest failed API calls").add_argument("n", nargs="?", type=int, default=20)
    a = p.parse_args()
    WIDE = a.wide
    try:  # Windows terminals: never crash on a character the console can't show
        sys.stdout.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass
    run = {"user": lambda: user(a.email), "recent": lambda: recent(a.n), "company": lambda: company(a.name),
           "request": lambda: request(a.number), "errors": lambda: errors(a.n)}[a.cmd]
    return asyncio.run(run())


if __name__ == "__main__":
    sys.exit(main())
