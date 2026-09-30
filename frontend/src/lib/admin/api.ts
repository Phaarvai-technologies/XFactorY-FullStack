"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * Everything the admin screens need from their host: navigation and a Clerk token.
 * The Next.js page supplies router-backed values (AdminRoot); keeping it as a
 * context lets the screens stay plain React components.
 */
export type AdminHost = {
  path: string; // e.g. "/admin/manufacturers/123"
  search: URLSearchParams;
  go: (href: string, options?: { replace?: boolean }) => void;
  getToken: () => Promise<string | null>;
  signOut: () => void;
};

export const AdminHostContext = createContext<AdminHost | null>(null);

export function useAdminHost(): AdminHost {
  const host = useContext(AdminHostContext);
  if (!host) throw new Error("AdminHostContext missing");
  return host;
}

/** Authenticated call to /api/v1/admin/... */
export function useAdminApi() {
  const { getToken } = useAdminHost();
  return useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const token = (await getToken()) ?? "";
      return api<T>(`/admin${path}`, token, init);
    },
    [getToken],
  );
}

export function jsonBody(method: "POST" | "PATCH", body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

/** Builds "?a=1&b=x&b=y" from a params object (arrays repeat the key, empties are dropped). */
export function toQuery(params: Record<string, string | string[] | number | boolean | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "" || value === false) continue;
    if (Array.isArray(value)) value.filter(Boolean).forEach((v) => q.append(key, v));
    else q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export type Resource<T> = {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  reload: () => void;
  setData: (data: T) => void;
};

/**
 * GET an admin resource and keep it in state. Changing `path` refetches; the previous
 * data stays visible while the next response loads (no flicker on filter changes).
 */
export function useResource<T>(path: string | null): Resource<T> {
  const call = useAdminApi();
  const [version, setVersion] = useState(0);
  const [res, setRes] = useState<{ key: string; data?: T; error: Error | null } | null>(null);
  const key = `${path}#${version}`;

  useEffect(() => {
    if (!path) return;
    let alive = true;
    call<T>(path).then(
      (data) => alive && setRes({ key, data, error: null }),
      (error: Error) => alive && setRes((prev) => ({ key, data: prev?.data, error })),
    );
    return () => {
      alive = false;
    };
  }, [call, path, key]);

  const loading = !!path && (!res || res.key !== key);
  return {
    data: res?.data,
    error: loading ? null : (res?.error ?? null),
    loading,
    reload: useCallback(() => setVersion((v) => v + 1), []),
    setData: useCallback((data: T) => setRes({ key, data, error: null }), [key]),
  };
}

/** Filters live in the URL so every filtered list is linkable (overview cards open them). */
export function useUrlFilters(basePath: string) {
  const { search, go } = useAdminHost();
  const get = (key: string) => search.get(key) ?? "";
  const getAll = (key: string) => search.getAll(key);
  const set = useCallback(
    (patch: Record<string, string | string[] | null>, keepPage = false) => {
      const next = new URLSearchParams(search.toString());
      for (const [key, value] of Object.entries(patch)) {
        next.delete(key);
        if (Array.isArray(value)) value.forEach((v) => next.append(key, v));
        else if (value) next.set(key, value);
      }
      if (!keepPage && !("page" in patch)) next.delete("page");
      const qs = next.toString();
      go(`${basePath}${qs ? `?${qs}` : ""}`, { replace: true });
    },
    [search, go, basePath],
  );
  return { get, getAll, set, search };
}
