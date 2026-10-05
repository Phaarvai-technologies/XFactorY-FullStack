"""In-app notifications from the admin portal to a manufacturer.

Admin actions that create one (one row per active member of the company):
  - needs_correction : review status set to Needs correction, with the admin's note
  - profile_edit     : an admin changed a field of the company's profile or machinery
  - admin_note       : an admin note marked "Show to manufacturer"

The manufacturer dashboard reads them (bell + popup) through /manufacturer/notifications.
Admin notes that are not shared never leave the admin portal.
"""
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

KINDS = ("needs_correction", "profile_edit", "admin_note")
MAX_BODY = 2000


async def notify_company(db: AsyncSession, org_id: str | UUID, kind: str, title: str, body: str,
                         by_user_id: UUID | None) -> int:
    """Adds a notification for every active member of the company. Caller commits."""
    assert kind in KINDS
    result = await db.execute(text("""
        INSERT INTO notifications (user_id, notification_type, channel, related_type, related_id, status,
                                   organization_id, title, body, created_by_user_id)
        SELECT m.user_id, :k, 'in_app', 'organization', o.id, 'delivered', o.id, :t, :b, :by
        FROM memberships m JOIN organizations o ON o.id = m.organization_id
        WHERE m.organization_id = CAST(:o AS uuid) AND m.status = 'active'
    """), {"o": str(org_id), "k": kind, "t": title[:200], "b": (body or "")[:MAX_BODY], "by": by_user_id})
    return result.rowcount or 0


async def for_user(db: AsyncSession, user_id: UUID, org_id: UUID, limit: int = 50) -> dict:
    rows = (await db.execute(text("""
        SELECT n.id, n.notification_type AS kind, n.title, n.body, n.created_at, n.read_at, n.popup_shown_at
        FROM notifications n
        WHERE n.user_id = :u AND n.organization_id = :o AND n.channel = 'in_app' AND n.status <> 'dismissed'
        ORDER BY n.created_at DESC LIMIT :n
    """), {"u": user_id, "o": org_id, "n": limit})).mappings().all()
    review = (await db.execute(text("""
        SELECT status, rejection_reason, reviewed_at FROM manufacturer_onboarding WHERE organization_id = :o
    """), {"o": org_id})).mappings().first()
    shared = (await db.execute(text("""
        SELECT id, note, created_at FROM admin_internal_notes
        WHERE manufacturer_id = :o AND shared_with_manufacturer
          AND note NOT LIKE 'Correction requested: %'   -- already shown as the reason
        ORDER BY created_at DESC LIMIT 20
    """), {"o": org_id})).mappings().all()
    items = [{"id": str(r["id"]), "kind": r["kind"], "title": r["title"], "body": r["body"],
              "createdAt": r["created_at"], "read": r["read_at"] is not None} for r in rows]
    unread = [r for r in rows if r["read_at"] is None]
    fresh = [r for r in unread if r["popup_shown_at"] is None]
    needs_correction = bool(review and review["status"] in ("changes_requested", "rejected"))
    return {
        "items": items,
        "unread": len(unread),
        # The popup shows once for anything new; "Later" or opening the panel hides it.
        "popup": {"count": len(fresh), "needsCorrection": any(r["kind"] == "needs_correction" for r in fresh)}
        if fresh else None,
        "correction": {"reason": review["rejection_reason"], "requestedAt": review["reviewed_at"],
                       "notes": [{"id": str(n["id"]), "note": n["note"], "createdAt": n["created_at"]}
                                 for n in shared]}
        if needs_correction else None,
    }


async def mark_read(db: AsyncSession, user_id: UUID, ids: list[str] | None) -> None:
    """ids=None marks every notification of this user as read."""
    await db.execute(text(f"""
        UPDATE notifications SET read_at = now(), status = 'read', popup_shown_at = coalesce(popup_shown_at, now())
        WHERE user_id = :u AND read_at IS NULL {"" if ids is None else "AND id = ANY(CAST(:ids AS uuid[]))"}
    """), {"u": user_id, **({} if ids is None else {"ids": ids})})
    await db.commit()


async def popup_seen(db: AsyncSession, user_id: UUID) -> None:
    await db.execute(text("""
        UPDATE notifications SET popup_shown_at = now() WHERE user_id = :u AND popup_shown_at IS NULL
    """), {"u": user_id})
    await db.commit()
