"use client";

import { useEffect, useRef, useState } from "react";
import { BellIcon } from "@/components/manufacturer/icons";
import { useManufacturerNotifications } from "@/lib/manufacturer/notifications";

function when(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/**
 * Dashboard bell: messages from the X!Y team (needs correction with the admin's note, profile
 * edits made by an admin, notes the admin shared). Anything new opens a popup once.
 */
export function NotificationBell({ onOpenProfile }: { onOpenProfile?: () => void }) {
  const n = useManufacturerNotifications();
  const [open, setOpen] = useState(false);
  const [fresh, setFresh] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function openPanel() {
    const unreadIds = n.items.filter((i) => !i.read).map((i) => i.id);
    setFresh(unreadIds);
    setOpen(true);
    if (unreadIds.length || n.popup) void n.markRead();
  }

  return (
    <div className="notif-root" ref={rootRef}>
      <button
        className="icon-btn"
        type="button"
        title="Notifications"
        aria-label={n.unread ? `Notifications, ${n.unread} unread` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPanel())}
      >
        <BellIcon size={17} />
        {n.unread > 0 ? <span className="dot" /> : null}
      </button>

      {open ? (
        <div className="notif-menu" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <b>Notifications</b>
            <span>Messages from the X!Y team</span>
          </div>

          {n.correction ? (
            <div className="notif-correction">
              <span className="notif-tag">Needs correction</span>
              {n.correction.reason ? <p className="notif-reason">{n.correction.reason}</p> : null}
              {n.correction.notes.length ? (
                <>
                  <span className="notif-sub">Notes from the X!Y team</span>
                  <ul>
                    {n.correction.notes.map((note) => (
                      <li key={note.id}>
                        <p>{note.note}</p>
                        <time>{when(note.createdAt)}</time>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {onOpenProfile ? (
                <button
                  type="button"
                  className="btn-primary notif-cta"
                  onClick={() => {
                    setOpen(false);
                    onOpenProfile();
                  }}
                >
                  Update my profile
                </button>
              ) : null}
            </div>
          ) : null}

          {n.items.length ? (
            <ul className="notif-list">
              {n.items.map((item) => (
                <li key={item.id} className={`notif-item kind-${item.kind}${fresh.includes(item.id) ? " is-new" : ""}`}>
                  <div className="notif-item-top">
                    <b>{item.title}</b>
                    {fresh.includes(item.id) ? <span className="notif-new">New</span> : null}
                  </div>
                  {item.body ? <p>{item.body}</p> : null}
                  <time>{when(item.createdAt)}</time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="notif-empty">No messages from the X!Y team yet.</p>
          )}
        </div>
      ) : null}

      {n.popup && !open ? (
        <div className="modal-backdrop show" role="presentation">
          <div className="modal-card notif-popup" role="alertdialog" aria-modal="true" aria-labelledby="notif-popup-title">
            <div className={`notif-popup-icon${n.popup.needsCorrection ? " warn" : ""}`} aria-hidden="true">
              <BellIcon size={20} />
            </div>
            <h3 id="notif-popup-title">
              {n.popup.needsCorrection ? "Your profile needs a few corrections" : "New message from the X!Y team"}
            </h3>
            <p className="notif-popup-text">
              {n.popup.needsCorrection
                ? "The X!Y team reviewed your profile and left a note on what to change. Open your notifications to read it."
                : n.popup.count === 1
                  ? "You have 1 new notification. Open your notifications to read it."
                  : `You have ${n.popup.count} new notifications. Open your notifications to read them.`}
            </p>
            <div className="modal-actions">
              <button type="button" className="btn-secondary-full" onClick={() => void n.popupSeen()}>
                Later
              </button>
              <button type="button" className="btn-primary" autoFocus onClick={openPanel}>
                Open notifications
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
