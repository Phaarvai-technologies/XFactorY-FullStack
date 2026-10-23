"""Claiming an imported company record.

Flow
  1. A signed-in user searches imported, unclaimed companies by name (public details only).
  2. "Claim this company" creates a claim. Ownership is then established by ONE of:
       contact_email    - a Clerk-VERIFIED email of the user equals an email published for this
                          company in the imported data (and for no other imported company);
       business_domain  - a Clerk-verified email on the company's own domain (its imported website or
                          imported contact email domain); free-mail / ISP domains and domains linked to
                          more than one imported company do not count;
       admin_review     - otherwise the claim waits for an administrator.
     A name match only finds candidates. Contact details the claimant types in are never evidence.
  3. Approval links the user (owner membership) and, when present, the Clerk organization to the
     existing company record. The empty workspace the sign-up created is closed, so the dashboard
     and onboarding continue on the claimed record - no duplicate company is created.

Concurrency: every decision locks the company row (and the user's claims) inside one transaction;
partial unique indexes allow one pending claim per user and one approved claim per company.
"""
from __future__ import annotations

import logging
import re
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import notifications
from app.core.auth import Actor
from app.core.clerk import ClerkManagement
from app.core.config import Settings
from app.imports.normalize import FREE_MAIL_DOMAINS, email_domain, normalize_company_name

log = logging.getLogger("xy.claims")

APPROVER_ROLES = ("platform_administrator", "platform_operator", "verification_analyst")
SEARCH_LIMIT = 20
# Workspace content that means "this user already built a company profile": such a workspace is
# never closed automatically when a claim is approved (an administrator decides).
CONTENT_TABLES = (("machines", "organization_id"), ("organization_certifications", "organization_id"),
                  ("manufacturer_faq_answers", "organization_id"), ("manufacturer_infrastructure", "organization_id"),
                  ("files", "organization_id"), ("manufacturer_booking_requests", "manufacturer_organization_id"))


def _mask(email: str) -> str:
    local, _, domain = email.partition("@")
    return f"{local[:1]}***@{domain}" if domain else "***"


class ClaimService:
    def __init__(self, session: AsyncSession, settings: Settings):
        self.db = session
        self.settings = settings
        self.clerk = ClerkManagement(settings)

    # ------------------------------------------------------------------ helpers
    async def _user(self, actor: Actor) -> dict:
        row = (await self.db.execute(text("""
            SELECT id, email, status FROM users WHERE clerk_user_id = :c
        """), {"c": actor.clerk_user_id})).mappings().first()
        if not row:
            raise HTTPException(409, "Finish signing in first, then search for your company.")
        if row["status"] != "active":
            raise HTTPException(403, "This account has been suspended. Please contact XfactorY support.")
        return dict(row)

    async def _verified_emails(self, actor: Actor) -> list[str]:
        try:
            return [e.strip().lower() for e in await self.clerk.verified_emails(actor.clerk_user_id)]
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("Clerk email lookup failed: %s", exc)
            raise HTTPException(502, "Could not confirm your email address with the sign-in service") from exc

    # Emails published for imported, unclaimed companies: the import contacts table and the
    # contact email of the imported profile (the plain SQL seed only fills the latter). Nobody
    # owns these records, so the values come from the import / XfactorY, never from a claimant.
    PUBLISHED = """
        SELECT c.organization_id, lower(c.email::text) AS email
        FROM organization_contacts c JOIN organizations o ON o.id = c.organization_id AND o.entry_source = 'IMPORTED'
        WHERE c.source = 'import' AND c.email IS NOT NULL
        UNION
        SELECT op.organization_id, lower(op.contact_email::text)
        FROM organization_profiles op
        JOIN organizations o ON o.id = op.organization_id AND o.entry_source = 'IMPORTED' AND o.status = 'claim_pending'
        WHERE op.contact_email IS NOT NULL
    """

    async def _evidence(self, org_id: str, emails: list[str]) -> tuple[str, dict]:
        """How this user can prove control of the company: (method, safe detail for the record)."""
        if not emails:
            return "admin_review", {"reason": "no verified email on the account"}
        rows = (await self.db.execute(text(f"""
            WITH pub AS ({self.PUBLISHED})
            SELECT p.email, (SELECT count(DISTINCT p2.organization_id) FROM pub p2 WHERE p2.email = p.email) AS companies
            FROM pub p WHERE p.organization_id = CAST(:o AS uuid)
        """), {"o": org_id})).mappings().all()
        published = {r["email"]: r["companies"] for r in rows}
        for email in emails:
            if email in published:
                if published[email] == 1:
                    return "contact_email", {"matched": "imported contact email", "email": _mask(email)}
                return "admin_review", {"reason": "verified email is published for several companies",
                                        "email": _mask(email)}
        org = (await self.db.execute(text("SELECT lower(website_domain) AS d FROM organizations WHERE id = CAST(:o AS uuid)"),
                                     {"o": org_id})).mappings().first()
        company_domains = {d for d in [org and org["d"]] if d} | {email_domain(e) for e in published if email_domain(e)}
        company_domains -= FREE_MAIL_DOMAINS
        for email in emails:
            domain = email_domain(email)
            if not domain or domain in FREE_MAIL_DOMAINS or domain not in company_domains:
                continue
            others = await self.db.scalar(text(f"""
                WITH pub AS ({self.PUBLISHED})
                SELECT count(DISTINCT o.id) FROM organizations o
                WHERE o.entry_source = 'IMPORTED' AND o.id <> CAST(:o AS uuid)
                  AND (lower(o.website_domain) = :d
                       OR EXISTS (SELECT 1 FROM pub WHERE pub.organization_id = o.id AND split_part(pub.email, '@', 2) = :d))
            """), {"o": org_id, "d": domain})
            if others:
                return "admin_review", {"reason": "email domain is linked to several imported companies",
                                        "domain": domain}
            return "business_domain", {"matched": "verified email on the company domain", "domain": domain}
        return "admin_review", {"reason": "no verified email matches the company's published contacts or domain"}

    async def _claimable(self, org_id: str, lock: bool = False) -> dict:
        row = (await self.db.execute(text(f"""
            SELECT o.id, o.display_name, o.status, o.entry_source, o.is_archived, o.clerk_organization_id
            FROM organizations o WHERE o.id = CAST(:o AS uuid) AND o.organization_type = 'manufacturer'
            {"FOR UPDATE" if lock else ""}
        """), {"o": org_id})).mappings().first()
        if not row or row["entry_source"] != "IMPORTED" or row["is_archived"]:
            raise HTTPException(404, "Company not found")
        taken = await self.db.scalar(text("""
            SELECT EXISTS (SELECT 1 FROM organization_claims WHERE organization_id = CAST(:o AS uuid) AND status = 'approved')
                OR EXISTS (SELECT 1 FROM memberships WHERE organization_id = CAST(:o AS uuid) AND status = 'active')
        """), {"o": org_id})
        if taken or row["status"] != "claim_pending":
            raise HTTPException(409, "This company has already been claimed. Contact XfactorY support if this is your company.")
        return dict(row)

    # ------------------------------------------------------------------ search
    async def search(self, actor: Actor, q: str, limit: int = SEARCH_LIMIT) -> dict:
        await self._user(actor)
        from app.services.company_search import CompanySearchService
        return await CompanySearchService(self.db).search(q, limit)

    async def company(self, actor: Actor, org_id: str) -> dict:
        await self._user(actor)
        from app.services.company_search import CompanySearchService
        return await CompanySearchService(self.db).company(org_id)

    async def _claims_supported(self) -> bool:
        return bool(await self.db.scalar(text("SELECT to_regclass('organization_claims') IS NOT NULL")))

    # ------------------------------------------------------------------ claimant actions
    async def my_claims(self, actor: Actor) -> dict:
        user = await self._user(actor)
        if not await self._claims_supported():
            return {"claims": [], "supported": False}
        rows = (await self.db.execute(text("""
            SELECT c.id, c.status, c.verification_method, c.decision_reason, c.created_at, c.decided_at,
                   o.id AS organization_id, o.display_name, f.city, f.state_province AS state
            FROM organization_claims c JOIN organizations o ON o.id = c.organization_id
            LEFT JOIN facilities f ON f.organization_id = o.id AND f.is_headquarters
            WHERE c.claimant_user_id = :u ORDER BY c.created_at DESC LIMIT 20
        """), {"u": user["id"]})).mappings().all()
        return {"claims": [self._claim_view(r) for r in rows]}

    @staticmethod
    def _claim_view(r) -> dict:
        return {"id": str(r["id"]), "status": r["status"], "method": r["verification_method"],
                "reason": r["decision_reason"], "createdAt": r["created_at"], "decidedAt": r["decided_at"],
                "company": {"id": str(r["organization_id"]), "name": r["display_name"],
                            "city": r["city"], "state": r["state"]}}

    async def create(self, actor: Actor, org_id: str, note: str | None) -> dict:
        user = await self._user(actor)
        if not await self._claims_supported():
            raise HTTPException(503, "The existing company claim workflow is not configured. Company selection does not grant ownership.")
        emails = await self._verified_emails(actor)          # outside the transaction (network call)
        try:
            await self.db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"),
                                  {"k": f"xy-claim-user:{user['id']}"})
            await self._claimable(org_id, lock=True)
            owned = await self.db.scalar(text("""
                SELECT EXISTS (SELECT 1 FROM organization_claims WHERE claimant_user_id = :u AND status = 'approved')
            """), {"u": user["id"]})
            if owned:
                raise HTTPException(409, "Your account is already linked to a claimed company.")
            pending = (await self.db.execute(text("""
                SELECT id, organization_id FROM organization_claims WHERE claimant_user_id = :u AND status = 'pending'
            """), {"u": user["id"]})).mappings().first()
            if pending and str(pending["organization_id"]) != str(org_id):
                raise HTTPException(409, "You already have a claim waiting for review. Cancel it to claim another company.")
            method, detail = await self._evidence(org_id, emails)
            if pending:
                claim_id = pending["id"]
                await self.db.execute(text("""
                    UPDATE organization_claims SET verification_method = :m, verification_detail = CAST(:d AS jsonb),
                      claimant_note = COALESCE(:note, claimant_note) WHERE id = :id
                """), {"m": method, "d": _json(detail), "note": note, "id": claim_id})
            else:
                claim_id = await self.db.scalar(text("""
                    INSERT INTO organization_claims (organization_id, claimant_user_id, clerk_organization_id,
                      status, verification_method, verification_detail, claimant_note)
                    VALUES (CAST(:o AS uuid), :u, :clerk_org, 'pending', :m, CAST(:d AS jsonb), :note) RETURNING id
                """), {"o": org_id, "u": user["id"], "clerk_org": actor.clerk_org_id, "m": method,
                       "d": _json(detail), "note": note})
            if method != "admin_review":
                outcome = await self._approve(claim_id, decided_by=None, reason=f"Verified automatically: {detail['matched']}")
                if outcome == "needs_review":
                    await self.db.execute(text("""
                        UPDATE organization_claims SET verification_method = 'admin_review',
                          verification_detail = verification_detail || CAST(:d AS jsonb) WHERE id = :id
                    """), {"id": claim_id, "d": _json({"auto_verified_by": method,
                                                      "reason": "account already has a company profile with data"})})
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            raise HTTPException(409, "This company was claimed at the same time by another request. Refresh and try again.") from exc
        except BaseException:
            await self.db.rollback()
            raise
        return await self._claim(claim_id)

    async def cancel(self, actor: Actor, claim_id: str) -> dict:
        user = await self._user(actor)
        updated = (await self.db.execute(text("""
            UPDATE organization_claims SET status = 'cancelled', decided_at = now(), decision_reason = 'Cancelled by the claimant'
            WHERE id = CAST(:id AS uuid) AND claimant_user_id = :u AND status = 'pending' RETURNING id
        """), {"id": claim_id, "u": user["id"]})).first()
        if not updated:
            raise HTTPException(404, "No pending claim to cancel")
        await self.db.commit()
        return await self._claim(claim_id)

    async def _claim(self, claim_id) -> dict:
        row = (await self.db.execute(text("""
            SELECT c.id, c.status, c.verification_method, c.decision_reason, c.created_at, c.decided_at,
                   o.id AS organization_id, o.display_name, f.city, f.state_province AS state
            FROM organization_claims c JOIN organizations o ON o.id = c.organization_id
            LEFT JOIN facilities f ON f.organization_id = o.id AND f.is_headquarters
            WHERE c.id = CAST(:id AS uuid)
        """), {"id": str(claim_id)})).mappings().first()
        return self._claim_view(row)

    # ------------------------------------------------------------------ approval (shared)
    async def _approve(self, claim_id, decided_by: UUID | None, reason: str | None) -> str:
        """Links the claimant to the company. Caller holds the transaction and commits.
        Returns 'approved', or 'needs_review' when the claimant's own workspace already has content."""
        claim = (await self.db.execute(text("""
            SELECT id, organization_id, claimant_user_id, clerk_organization_id, status
            FROM organization_claims WHERE id = CAST(:id AS uuid) FOR UPDATE
        """), {"id": str(claim_id)})).mappings().first()
        if not claim:
            raise HTTPException(404, "Claim not found")
        if claim["status"] != "pending":
            raise HTTPException(409, f"This claim is already {claim['status']}.")
        org_id, user_id = str(claim["organization_id"]), claim["claimant_user_id"]
        await self._claimable(org_id, lock=True)

        # The empty workspace created at sign-up (never an imported record).
        shells = (await self.db.execute(text("""
            SELECT o.id FROM organizations o JOIN memberships m ON m.organization_id = o.id
            WHERE m.user_id = :u AND m.status = 'active' AND o.organization_type = 'manufacturer'
              AND o.status <> 'closed' AND o.id <> CAST(:o AS uuid)
            FOR UPDATE OF o
        """), {"u": user_id, "o": org_id})).scalars().all()
        content_sql = "SELECT " + " OR ".join(
            f"EXISTS (SELECT 1 FROM {t} WHERE {col} = CAST(:s AS uuid))" for t, col in CONTENT_TABLES)
        for shell in shells:
            has_content = await self.db.scalar(text(content_sql), {"s": str(shell)})
            if has_content:
                if decided_by is None:
                    return "needs_review"
                raise HTTPException(409, "The claimant's account already has its own company profile with listings "
                                         "or documents. Resolve that profile before approving this claim.")
        for shell in shells:
            # Carry over what the claimant entered on the account form, where the claimed record has nothing.
            await self.db.execute(text("""
                UPDATE organization_profiles t SET
                  company_category = COALESCE(t.company_category, s.company_category),
                  stated_production_capacity = COALESCE(t.stated_production_capacity, s.stated_production_capacity),
                  production_capacity_label = COALESCE(t.production_capacity_label, s.production_capacity_label),
                  updated_at = now()
                FROM organization_profiles s
                WHERE t.organization_id = CAST(:o AS uuid) AND s.organization_id = CAST(:s AS uuid)
            """), {"o": org_id, "s": str(shell)})
            await self.db.execute(text("""
                INSERT INTO manufacturer_onboarding (organization_id, current_step, personal_information_completed,
                                                     completion_percentage, status)
                SELECT CAST(:o AS uuid), 'company_information', true, 15, 'in_progress'
                FROM manufacturer_onboarding s
                WHERE s.organization_id = CAST(:s AS uuid) AND s.personal_information_completed
                ON CONFLICT (organization_id) DO UPDATE SET personal_information_completed = true
            """), {"o": org_id, "s": str(shell)})
            await self.db.execute(text("UPDATE memberships SET status = 'removed' WHERE organization_id = CAST(:s AS uuid) AND user_id = :u"),
                                  {"s": str(shell), "u": user_id})
            # The Clerk organization (if any) moves to the claimed record below, so it is released here.
            await self.db.execute(text("""
                UPDATE organizations SET status = 'closed', clerk_organization_id = NULL, updated_at = now()
                WHERE id = CAST(:s AS uuid)
            """), {"s": str(shell)})

        clerk_org = claim["clerk_organization_id"]
        if clerk_org:
            in_use = await self.db.scalar(text("SELECT EXISTS (SELECT 1 FROM organizations WHERE clerk_organization_id = :c)"),
                                          {"c": clerk_org})
            if in_use:
                clerk_org = None   # that Clerk organization already belongs to another company record
        await self.db.execute(text("""
            UPDATE organizations SET status = 'active', created_by_user_id = COALESCE(created_by_user_id, :u),
              clerk_organization_id = COALESCE(clerk_organization_id, :c), updated_at = now(), version = version + 1
            WHERE id = CAST(:o AS uuid)
        """), {"o": org_id, "u": user_id, "c": clerk_org})
        await self.db.execute(text("""
            INSERT INTO memberships (user_id, organization_id, membership_role, status, accepted_at)
            VALUES (:u, CAST(:o AS uuid), 'owner', 'active', now())
            ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'active', membership_role = 'owner'
        """), {"u": user_id, "o": org_id})
        await self.db.execute(text("""
            UPDATE organization_claims SET status = 'approved', decided_at = now(), decided_by_user_id = :by,
              decision_reason = :reason WHERE id = CAST(:id AS uuid)
        """), {"id": str(claim_id), "by": decided_by, "reason": reason})
        await self.db.execute(text("""
            UPDATE organization_claims SET status = 'rejected', decided_at = now(), decided_by_user_id = :by,
              decision_reason = 'The company was claimed by another account'
            WHERE organization_id = CAST(:o AS uuid) AND status = 'pending' AND id <> CAST(:id AS uuid)
        """), {"o": org_id, "id": str(claim_id), "by": decided_by})
        await notifications.notify_company(
            self.db, org_id, "admin_note", "Your company claim was approved",
            "Your account is now linked to this company record. Review the imported details and complete your profile.",
            decided_by)
        return "approved"

    # ------------------------------------------------------------------ administrators
    async def admin_list(self, status: str | None) -> dict:
        rows = (await self.db.execute(text("""
            SELECT c.id, c.status, c.verification_method, c.verification_detail, c.claimant_note, c.decision_reason,
                   c.created_at, c.decided_at, o.id AS organization_id, o.display_name, o.website_domain,
                   f.city, f.state_province AS state, r.source_key, r.imported->>'primary_source_url' AS source_url,
                   u.id AS user_id, u.email AS user_email, u.first_name, u.last_name,
                   (SELECT json_agg(json_build_object('name', oc.contact_name, 'role', oc.contact_role,
                                                      'email', oc.email, 'phone', oc.phone) ORDER BY oc.is_primary DESC)
                    FROM organization_contacts oc WHERE oc.organization_id = o.id) AS contacts
            FROM organization_claims c
            JOIN organizations o ON o.id = c.organization_id
            JOIN users u ON u.id = c.claimant_user_id
            LEFT JOIN manufacturer_import_records r ON r.organization_id = o.id
            LEFT JOIN facilities f ON f.organization_id = o.id AND f.is_headquarters
            WHERE (CAST(:s AS text) IS NULL OR c.status = :s)
            ORDER BY (c.status = 'pending') DESC, c.created_at DESC LIMIT 200
        """), {"s": status})).mappings().all()
        return {"claims": [{
            "id": str(r["id"]), "status": r["status"], "method": r["verification_method"],
            "detail": r["verification_detail"], "note": r["claimant_note"], "reason": r["decision_reason"],
            "createdAt": r["created_at"], "decidedAt": r["decided_at"],
            "company": {"id": str(r["organization_id"]), "name": r["display_name"], "website": r["website_domain"],
                        "city": r["city"], "state": r["state"], "sourceId": r["source_key"],
                        "sourceUrl": r["source_url"], "contacts": r["contacts"] or []},
            "claimant": {"id": str(r["user_id"]), "email": r["user_email"],
                         "name": " ".join(x for x in (r["first_name"], r["last_name"]) if x)},
        } for r in rows]}

    async def admin_decide(self, admin, claim_id: str, approve: bool, reason: str | None) -> dict:
        if not set(admin.roles) & set(APPROVER_ROLES):
            raise HTTPException(403, "Your admin role cannot decide company claims.")
        try:
            if approve:
                await self._approve(claim_id, decided_by=admin.user_id, reason=reason or "Approved by an administrator")
            else:
                if not (reason or "").strip():
                    raise HTTPException(422, "Give a reason for the rejection.")
                updated = (await self.db.execute(text("""
                    UPDATE organization_claims SET status = 'rejected', decided_at = now(), decided_by_user_id = :by,
                      decision_reason = :reason WHERE id = CAST(:id AS uuid) AND status = 'pending' RETURNING id
                """), {"id": claim_id, "by": admin.user_id, "reason": reason.strip()})).first()
                if not updated:
                    raise HTTPException(409, "Only a pending claim can be rejected.")
                # Tell the claimant (in their own workspace's notification bell).
                workspaces = (await self.db.execute(text("""
                    SELECT m.organization_id FROM organization_claims c
                    JOIN memberships m ON m.user_id = c.claimant_user_id AND m.status = 'active'
                    JOIN organizations o ON o.id = m.organization_id AND o.status <> 'closed'
                    WHERE c.id = CAST(:id AS uuid)
                """), {"id": claim_id})).scalars().all()
                for workspace in workspaces:
                    await notifications.notify_company(
                        self.db, workspace, "admin_note", "Your company claim was not approved",
                        f"Reason: {reason.strip()}", admin.user_id)
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            raise HTTPException(409, "Another approval for this company was saved first. Refresh the list.") from exc
        except BaseException:
            await self.db.rollback()
            raise
        return await self._claim(claim_id)


def _like(value: str) -> str:
    """Text for LIKE with the wildcard characters escaped (backslash is the escape)."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _regex(value: str) -> str:
    return re.sub(r"([\\^$.|?*+()\[\]{}])", r"\\\1", value)


def _json(value: dict) -> str:
    import json

    return json.dumps(value)
