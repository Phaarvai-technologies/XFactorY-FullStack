"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

/** A message from the X!Y team (GET /manufacturer/notifications). */
export type ManufacturerNotification = {
  id: string;
  kind: "needs_correction" | "profile_edit" | "admin_note";
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
};

export type NotificationState = {
  items: ManufacturerNotification[];
  unread: number;
  /** Something arrived since the last visit: show the popup once. */
  popup: { count: number; needsCorrection: boolean } | null;
  /** Open correction request: the admin's reason and the notes they shared. */
  correction: { reason: string | null; requestedAt: string | null; notes: { id: string; note: string; createdAt: string }[] } | null;
};

const EMPTY: NotificationState = { items: [], unread: 0, popup: null, correction: null };
const REFRESH_MS = 60_000;

function valid(data: unknown): data is NotificationState {
  return !!data && Array.isArray((data as NotificationState).items);
}

/** Loads the manufacturer's notifications, refreshes every minute and when the tab gets focus. */
export function useManufacturerNotifications() {
  const { getToken, isSignedIn } = useAuth();
  const [state, setState] = useState<NotificationState>(EMPTY);
  const alive = useRef(true);
  // Keep the latest getToken without re-running the effects below when its identity changes.
  const tokenRef = useRef(getToken);
  useEffect(() => {
    tokenRef.current = getToken;
  }, [getToken]);

  const send = useCallback(async (path: string, init?: RequestInit) => {
    const token = await tokenRef.current();
    if (!token) return;
    const data = await api<NotificationState>(`/manufacturer/notifications${path}`, token, init);
    if (alive.current && valid(data)) setState(data);
  }, []);

  const refresh = useCallback(() => send("").catch(() => undefined), [send]);

  useEffect(() => {
    alive.current = true;
    if (!isSignedIn) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [isSignedIn, refresh]);

  const markRead = useCallback(
    (ids?: string[]) => {
      // Show it as read right away; the server answer replaces it.
      setState((s) => ({
        ...s,
        popup: null,
        items: s.items.map((i) => (!ids || ids.includes(i.id) ? { ...i, read: true } : i)),
        unread: ids ? s.items.filter((i) => !i.read && !ids.includes(i.id)).length : 0,
      }));
      return send("/read", { method: "POST", body: JSON.stringify(ids ? { ids } : {}) }).catch(() => undefined);
    },
    [send],
  );

  const popupSeen = useCallback(() => {
    setState((s) => ({ ...s, popup: null }));
    return send("/popup-seen", { method: "POST" }).catch(() => undefined);
  }, [send]);

  return { ...state, refresh, markRead, popupSeen };
}
