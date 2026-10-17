"use client";

import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { jsonBody, useAdminApi, useAdminHost, useResource } from "@/lib/admin/api";
import { fmtAgo } from "@/lib/admin/format";

export type AdminNotification = {
  id: string;
  kind: "application_submitted" | "application_resubmitted";
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  companyId: string | null;
  applicationId: string | null;
};
type Feed = { items: AdminNotification[]; unread: number };

const POLL_MS = 60_000;

/**
 * Header bell: new manufacturer applications and corrected applications (sent to every admin
 * who may decide them). Opening one goes to that company's Onboarding & review tab.
 */
export function AdminNotifications() {
  const { go } = useAdminHost();
  const call = useAdminApi();
  const { data, reload, setData } = useResource<Feed>("/notifications", { refreshOnFocus: true });
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [reload]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  async function markRead(ids: string[] | null) {
    try {
      setData(await call<Feed>("/notifications/read", jsonBody("POST", { ids })));
    } catch {
      // the list refreshes on the next poll
    }
  }

  const unread = data?.unread ?? 0;
  const items = data?.items ?? [];
  return (
    <div className="adm-notif" ref={root}>
      <button
        type="button"
        className="icon-btn adm-notif-btn"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={17} />
        {unread > 0 ? <span className="adm-notif-count">{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      {open ? (
        <div className="adm-notif-panel" role="dialog" aria-label="Notifications">
          <div className="adm-notif-head">
            <b>Applications</b>
            {unread > 0 ? (
              <button type="button" className="btn-text" onClick={() => void markRead(null)}>Mark all read</button>
            ) : null}
          </div>
          {items.length === 0 ? (
            <p className="adm-muted adm-notif-empty">No new applications.</p>
          ) : (
            <ul>
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={`adm-notif-item${n.read ? "" : " unread"}`}
                    onClick={() => {
                      if (!n.read) void markRead([n.id]);
                      setOpen(false);
                      if (n.companyId) go(`/admin/manufacturers/${n.companyId}?tab=onboarding`);
                    }}
                  >
                    <b>{n.title}</b>
                    <span>{n.body}</span>
                    <small>{fmtAgo(n.createdAt)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
