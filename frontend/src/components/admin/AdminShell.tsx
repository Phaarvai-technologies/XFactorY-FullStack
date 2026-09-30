"use client";

import {
  BarChart3,
  ClipboardCheck,
  Factory,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  ShieldAlert,
  Users,
  X,
} from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { FactoryMark } from "@/components/layout/Logo";
import { Analytics } from "@/components/admin/Analytics";
import { ManufacturerDetail } from "@/components/admin/ManufacturerDetail";
import { Manufacturers } from "@/components/admin/Manufacturers";
import { Overview } from "@/components/admin/Overview";
import { ReviewQueue } from "@/components/admin/ReviewQueue";
import { Support } from "@/components/admin/Support";
import { UserDetailView, Users as UsersScreen } from "@/components/admin/Users";
import { ErrorBox, Loading } from "@/components/admin/ui";
import { useAdminHost, useResource } from "@/lib/admin/api";
import { initials } from "@/lib/admin/format";
import type { AdminMe } from "@/lib/admin/types";
import { ApiError } from "@/lib/api";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/manufacturers", label: "Manufacturers", icon: Factory },
  { href: "/admin/review", label: "Onboarding & review", icon: ClipboardCheck },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/support", label: "Support", icon: LifeBuoy },
];

type Toast = (message: string) => void;
const ToastContext = createContext<Toast>(() => undefined);
export const useToast = () => useContext(ToastContext);

const AdminMeContext = createContext<AdminMe | null>(null);
export const useAdminMe = () => useContext(AdminMeContext);

function route(path: string): { screen: string; id?: string } {
  const parts = path.replace(/\/+$/, "").split("/").filter(Boolean); // ["admin", ...]
  const [, section, id] = parts;
  if (!section) return { screen: "overview" };
  if (section === "manufacturers") return id ? { screen: "manufacturer", id } : { screen: "manufacturers" };
  if (section === "users") return id ? { screen: "user", id } : { screen: "users" };
  if (["review", "analytics", "support"].includes(section)) return { screen: section };
  return { screen: "notfound" };
}

export function AdminShell() {
  const host = useAdminHost();
  const meRes = useResource<AdminMe>("/me");
  const me = meRes.data ?? null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const err = meRes.error;
  const denied = err instanceof ApiError && (err.status === 403 || err.status === 401);
  const state = me ? "ok" : meRes.loading ? "loading" : denied ? "denied" : "error";
  const error = err?.message ?? "";
  const load = meRes.reload;

  const showToast = useCallback<Toast>((message) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const { screen, id } = route(host.path);
  const active = NAV.slice()
    .reverse()
    .find((n) => (n.href === "/admin" ? host.path === "/admin" || host.path === "/admin/" : host.path.startsWith(n.href)));

  if (state === "loading") {
    return (
      <div className="mfg-root adm-root adm-center">
        <Loading label="Checking admin access…" />
      </div>
    );
  }

  if (state === "denied" || state === "error") {
    return (
      <div className="mfg-root adm-root adm-center">
        <div className="card adm-denied">
          <div className="adm-denied-icon">
            <ShieldAlert size={26} />
          </div>
          <h2>{state === "denied" ? "Admin access only" : "Something went wrong"}</h2>
          <p>{state === "denied" ? error || "This area is restricted to X!Y administrators." : error}</p>
          <div className="adm-denied-actions">
            {state === "error" && (
              <button type="button" className="btn-primary" onClick={load}>
                Try again
              </button>
            )}
            <button type="button" className="btn-ghost" onClick={() => host.go("/")}>
              Go to X!Y home
            </button>
            <button type="button" className="btn-ghost" onClick={host.signOut}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  let content;
  switch (screen) {
    case "overview":
      content = <Overview />;
      break;
    case "manufacturers":
      content = <Manufacturers />;
      break;
    case "manufacturer":
      content = <ManufacturerDetail id={id!} />;
      break;
    case "review":
      content = <ReviewQueue />;
      break;
    case "users":
      content = <UsersScreen />;
      break;
    case "user":
      content = <UserDetailView id={id!} />;
      break;
    case "analytics":
      content = <Analytics />;
      break;
    case "support":
      content = <Support />;
      break;
    default:
      content = <ErrorBox message="This admin page does not exist." />;
  }

  return (
    <AdminMeContext.Provider value={me}>
      <ToastContext.Provider value={showToast}>
        <div className="mfg-root adm-root">
          <aside className={`adm-sidebar${menuOpen ? " open" : ""}`}>
            <div className="adm-brand">
              <FactoryMark className="topbar-factory-mark" />
              <span>X!Y</span>
              <span className="topbar-crumb">Admin</span>
              <button type="button" className="adm-menu-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">
                <X size={18} />
              </button>
            </div>
            <nav className="adm-nav" aria-label="Admin">
              {NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    className={`adm-nav-item${active?.href === item.href ? " active" : ""}`}
                    onClick={(e) => {
                      e.preventDefault();
                      setMenuOpen(false);
                      host.go(item.href);
                    }}
                  >
                    <Icon size={18} />
                    {item.label}
                  </a>
                );
              })}
            </nav>
            <div className="adm-sidebar-foot">
              <div className="adm-me">
                <span className="avatar-circle">{initials(me?.name, me?.email)}</span>
                <div>
                  <b>{me?.name || "Admin"}</b>
                  <span>{me?.email}</span>
                </div>
              </div>
              <button type="button" className="adm-logout" onClick={host.signOut}>
                <LogOut size={16} /> Log out
              </button>
            </div>
          </aside>
          {menuOpen && <div className="adm-scrim" onClick={() => setMenuOpen(false)} />}

          <div className="adm-main-col">
            <div className="topbar adm-topbar">
              <div className="adm-topbar-inner">
                <button type="button" className="icon-btn adm-menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
                  <Menu size={18} />
                </button>
                <div className="topbar-logo adm-topbar-title">
                  <FactoryMark className="topbar-factory-mark adm-mobile-only" />
                  <span className="adm-mobile-only">X!Y</span>
                  <span className="topbar-crumb">Admin Dashboard{active ? ` · ${active.label}` : ""}</span>
                </div>
                <div className="topbar-actions">
                  <span className="badge badge-info adm-hide-sm">{me?.roles.includes("platform_administrator") ? "Administrator" : "Admin"}</span>
                  <div className="avatar-chip" style={{ cursor: "default" }}>
                    <span className="avatar-circle">{initials(me?.name, me?.email)}</span>
                    <span className="adm-hide-sm">{me?.name || me?.email}</span>
                  </div>
                </div>
              </div>
            </div>
            <main className="adm-main">{content}</main>
          </div>
          <div className={`toast${toast ? " show" : ""}`} role="status" aria-live="polite">
            {toast}
          </div>
        </div>
      </ToastContext.Provider>
    </AdminMeContext.Provider>
  );
}
