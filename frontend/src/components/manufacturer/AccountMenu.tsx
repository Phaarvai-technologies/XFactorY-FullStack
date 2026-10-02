"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { LogOut, Settings } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Account menu for the dashboard's name button (same options and layout as the
 * account menu on the home page): signed-in user, "Manage account" (Clerk's account
 * settings) and "Sign out". The trigger button itself is unchanged.
 */
export function AccountMenu({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const clerk = useClerk();
  const [open, setOpen] = useState(false);
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

  const name = user?.fullName || user?.username || "";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const developmentMode = (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "").startsWith("pk_test_");

  return (
    <div className="account-menu-root" ref={rootRef}>
      <button
        className="avatar-chip"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {children}
      </button>
      {open ? (
        <div className="account-menu" role="menu" aria-label="Account">
          <div className="account-menu-user">
            {user?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="account-menu-avatar" src={user.imageUrl} alt="" />
            ) : (
              <span className="account-menu-avatar" aria-hidden="true" />
            )}
            <div className="account-menu-identity">
              {name ? <b>{name}</b> : null}
              {email ? <span>{email}</span> : null}
            </div>
          </div>
          <button
            className="account-menu-item"
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              clerk.openUserProfile();
            }}
          >
            <Settings size={16} aria-hidden="true" />
            Manage account
          </button>
          <button
            className="account-menu-item"
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void clerk.signOut({ redirectUrl: "/" });
            }}
          >
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </button>
          <div className="account-menu-footer">
            <span>
              Secured by <b>clerk</b>
            </span>
            {developmentMode ? <span className="account-menu-dev">Development mode</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
