"use client";

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Factory,
  FlaskConical,
  LifeBuoy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Completeness, Empty, ErrorBox, Loading, ReviewBadge } from "@/components/admin/ui";
import { useAdminHost, useResource } from "@/lib/admin/api";
import { fmtAgo, fmtDate, pct } from "@/lib/admin/format";
import type { ManufacturerRow, OverviewData } from "@/lib/admin/types";
import { useAdminMe } from "@/components/admin/AdminShell";

type Card = {
  key: keyof OverviewData["cards"];
  label: string;
  hint: string;
  href: string;
  icon: LucideIcon;
  tone?: string;
};

// XY-ADMIN-02: every card opens the matching filtered list.
const CARDS: Card[] = [
  { key: "totalUsers", label: "Total users", hint: "Registered accounts", href: "/admin/users", icon: Users },
  {
    key: "totalManufacturers",
    label: "Total manufacturers",
    hint: "Real records only",
    href: "/admin/manufacturers?record_type=REAL",
    icon: Factory,
  },
  {
    key: "completed",
    label: "Completed profiles",
    hint: "All required fields done",
    href: "/admin/manufacturers?record_type=REAL&completeness=complete",
    icon: CheckCircle2,
    tone: "green",
  },
  {
    key: "incomplete",
    label: "Incomplete profiles",
    hint: "Missing required fields",
    href: "/admin/manufacturers?record_type=REAL&completeness=incomplete&sort=completeness",
    icon: Clock,
    tone: "amber",
  },
  {
    key: "awaitingReview",
    label: "Awaiting review",
    hint: "Submitted, not yet reviewed",
    href: "/admin/review?review_status=SUBMITTED",
    icon: AlertCircle,
    tone: "blue",
  },
  {
    key: "testDemo",
    label: "Test / demo records",
    hint: "Excluded from totals",
    href: "/admin/manufacturers?record_type=DEMO&record_type=TEST",
    icon: FlaskConical,
    tone: "purple",
  },
  {
    key: "openSupportIssues",
    label: "Open support issues",
    hint: "Users with failed actions, last 7 days",
    href: "/admin/support",
    icon: LifeBuoy,
    tone: "red",
  },
];

function MiniList({
  title,
  rows,
  moreHref,
  mode,
}: {
  title: string;
  rows: ManufacturerRow[];
  moreHref: string;
  mode: "registered" | "updated" | "attention";
}) {
  const { go } = useAdminHost();
  return (
    <div className="card adm-mini">
      <div className="adm-mini-head">
        <h3>{title}</h3>
        <button type="button" className="btn-text" onClick={() => go(moreHref)}>
          View all
        </button>
      </div>
      {rows.length === 0 ? (
        <Empty text="Nothing here right now." />
      ) : (
        <ul className="adm-mini-list">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => go(`/admin/manufacturers/${r.id}`)}>
                <div className="adm-mini-main">
                  <b>{r.companyName || "Unnamed company"}</b>
                  <span>
                    {mode === "attention"
                      ? r.attentionReason
                      : mode === "registered"
                        ? `${r.contactName || r.contactEmail || "—"} · ${fmtDate(r.registeredAt)}`
                        : `Updated ${fmtAgo(r.lastUpdated)}`}
                  </span>
                </div>
                <div className="adm-mini-side">
                  {mode === "attention" ? <ReviewBadge status={r.reviewStatus} /> : <Completeness value={r.completeness} />}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Overview() {
  const { go } = useAdminHost();
  const me = useAdminMe();
  const { data, error, loading, reload } = useResource<OverviewData>("/overview");

  if (!data) return loading ? <Loading /> : <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const c = data.cards;
  const firstName = (me?.name || "").split(" ")[0];

  return (
    <>
      <div className="welcome-card adm-welcome">
        <div className="welcome-row">
          <div>
            <h1 className="welcome-title">{firstName ? `Welcome back, ${firstName}` : "Admin overview"}</h1>
            <p className="welcome-sub">
              Platform health at a glance. Totals count real records only — demo and test records are shown separately.
            </p>
          </div>
          <div className="welcome-pct-wrap">
            <div className="welcome-pct">{pct(c.completed, c.totalManufacturers)}</div>
            <div className="welcome-pct-label">onboarding completion</div>
          </div>
        </div>
        <div className="welcome-progress-track">
          <div
            className="welcome-progress-fill"
            style={{ width: c.totalManufacturers ? `${(c.completed * 100) / c.totalManufacturers}%` : "0%" }}
          />
        </div>
        <div className="welcome-next-row">
          <div className="welcome-next-text">
            <b>{c.awaitingReview}</b> profile{c.awaitingReview === 1 ? "" : "s"} waiting for review
          </div>
          <button type="button" className="btn-primary" onClick={() => go("/admin/review?review_status=SUBMITTED")}>
            Open review queue
          </button>
        </div>
      </div>

      <p className="section-label">Key numbers</p>
      <div className="adm-stat-grid">
        {CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <button key={card.key} type="button" className="nav-card adm-stat" onClick={() => go(card.href)}>
              <div className={`nav-card-icon adm-tone-${card.tone ?? "blue"}`}>
                <Icon size={19} />
              </div>
              <b className="adm-stat-value">{c[card.key].toLocaleString()}</b>
              <h3>{card.label}</h3>
              <p>{card.hint}</p>
              <span className="nav-card-meta">
                Open list <ArrowRight size={13} />
              </span>
            </button>
          );
        })}
      </div>

      <div className="adm-overview-lists">
        <MiniList
          title="Needs attention"
          rows={data.needsAttention}
          moreHref="/admin/review"
          mode="attention"
        />
        <MiniList
          title="Recent registrations"
          rows={data.recentRegistrations}
          moreHref="/admin/manufacturers?record_type=REAL&sort=registered"
          mode="registered"
        />
        <MiniList
          title="Recently updated"
          rows={data.recentlyUpdated}
          moreHref="/admin/manufacturers?record_type=REAL&sort=updated"
          mode="updated"
        />
      </div>
    </>
  );
}
