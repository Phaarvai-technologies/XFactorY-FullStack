"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminHostContext, type AdminHost } from "@/lib/admin/api";

/** Connects the admin screens to the Next.js router and Clerk. */
export function AdminRoot() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const { signOut } = useClerk();

  const go = useCallback<AdminHost["go"]>(
    (href, options) => (options?.replace ? router.replace(href, { scroll: false }) : router.push(href)),
    [router],
  );
  const host = useMemo<AdminHost>(
    () => ({
      path: pathname,
      search: new URLSearchParams(searchParams.toString()),
      go,
      getToken: () => getToken(),
      signOut: () => void signOut({ redirectUrl: "/" }),
    }),
    [pathname, searchParams, go, getToken, signOut],
  );

  return (
    <AdminHostContext.Provider value={host}>
      <AdminShell />
    </AdminHostContext.Provider>
  );
}
