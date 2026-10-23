"use client";

import { BadgeCheck, Factory, FlaskConical, UserRound } from "lucide-react";
import { useToast } from "@/components/admin/AdminShell";
import { Fragment, useCallback, useState, type ReactNode } from "react";
import {
  AccountBadge,
  ActionsMenu,
  DataScopeFilter,
  DetailsRow,
  DetailsToggle,
  ErrorBox,
  Loading,
  PageHeader,
  Pagination,
  RecordBadge,
  SearchInput,
  Truncate,
  type DataScope,
} from "@/components/admin/ui";
import { jsonBody, toQuery, useAdminApi, useAdminHost, useResource, useUrlFilters } from "@/lib/admin/api";
import { DURATION_LABELS, TIMELINE_LABELS, fmtAgo, fmtDate, fmtDateTime, fmtMoney } from "@/lib/admin/format";
import type { RecordType, VisionaryDetailData, VisionaryList, VisionaryRow } from "@/lib/admin/types";

/** Mark a Visionary as demo / real data (PATCH /admin/visionaries/{id}/record-type). */
function useSetRecordType(onDone: () => void) {
  const call = useAdminApi();
  const toast = useToast();
  return async (v: VisionaryRow, type: RecordType) => {
    try {
      await call(`/visionaries/${v.id}/record-type`, jsonBody("PATCH", { record_type: type }));
      toast(`${v.name || v.email} marked as ${type === "REAL" ? "real" : "demo"} data`);
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update");
    }
  };
}

function recordAction(v: VisionaryRow, set: (v: VisionaryRow, t: RecordType) => void) {
  return (v.recordType ?? "REAL") === "REAL"
    ? { label: "Mark as demo", icon: <FlaskConical size={15} />, onSelect: () => set(v, "DEMO"), group: true }
    : { label: "Mark as real", icon: <BadgeCheck size={15} />, onSelect: () => set(v, "REAL"), group: true };
}

function requestTone(status: string): string {
  if (["accepted", "confirmed", "completed"].includes(status)) return "badge-verified";
  if (["declined", "cancelled", "returned", "expired"].includes(status)) return "badge-rejected";
  if (status === "new") return "badge-info";
  return "badge-pending";
}
const statusText = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

function ProfileBadge({ saved }: { saved: boolean }) {
  return saved ? <span className="badge badge-verified">Saved</span> : <span className="badge badge-neutral">Not saved yet</span>;
}

/** Visionaries (demand side): users with the Visionary role or a saved Visionary profile. Read-only. */
export function Visionaries() {
  const { go } = useAdminHost();
  const f = useUrlFilters("/admin/visionaries");
  const params = {
    q: f.get("q"),
    profile: f.get("profile"),
    account_status: f.get("account_status"),
    data: (["real", "demo"].includes(f.get("data")) ? f.get("data") : "all") as DataScope,
    page: f.get("page") || "1",
    page_size: "25",
  };
  const { data, error, loading, reload } = useResource<VisionaryList>(
    `/visionaries${toQuery({ ...params, data: params.data === "all" ? null : params.data })}`,
  );
  const setRecordType = useSetRecordType(reload);
  const setFilters = f.set;
  const commitSearch = useCallback((q: string) => setFilters({ q }), [setFilters]);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Visionaries"
        subtitle="People who use XfactorY to get products made: their saved profile, projects and manufacturing requests."
      />
      <div className="card adm-toolbar">
        <div className="adm-toolbar-row">
          <SearchInput value={params.q} onCommit={commitSearch} placeholder="Search name, email, organization or location" />
          <select
            className="adm-select-sm"
            value={params.profile}
            onChange={(e) => f.set({ profile: e.target.value })}
            aria-label="Profile"
          >
            <option value="">All profiles</option>
            <option value="saved">Profile saved</option>
            <option value="missing">Profile not saved yet</option>
          </select>
          <select
            className="adm-select-sm"
            value={params.account_status}
            onChange={(e) => f.set({ account_status: e.target.value })}
            aria-label="Account status"
          >
            <option value="">All account statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="deactivated">Deleted</option>
          </select>
        </div>
        <div className="adm-toolbar-row">
          <DataScopeFilter value={params.data} counts={data?.dataCounts} onChange={(v) => f.set({ data: v === "all" ? null : v })} />
          <span className="adm-seg-hint">Demo = marked as demo or test data by an admin (Actions → Mark as demo).</span>
        </div>
      </div>

      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {!data ? (
        loading && <Loading />
      ) : (
        <div className={`card adm-table-card${loading ? " adm-stale" : ""}`}>
          <div className="adm-table-wrap">
            <table className="adm-table adm-table-fixed adm-table-wide">
              <colgroup>
                <col className="adm-w-expand" />
                <col className="adm-w-main" />
                <col className="adm-w-company" />
                <col className="adm-w-status" />
                <col className="adm-w-count" />
                <col className="adm-w-count" />
                <col className="adm-w-status" />
                <col className="adm-w-date" />
                <col className="adm-w-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th aria-label="Details" />
                  <th>Visionary</th>
                  <th>Organization</th>
                  <th>Profile</th>
                  <th>Projects</th>
                  <th>Requests</th>
                  <th>Account</th>
                  <th>Registered</th>
                  <th className="adm-th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="adm-empty-cell">
                      No Visionaries match these filters.
                    </td>
                  </tr>
                )}
                {data.rows.map((v) => {
                  const detailsId = `vis-${v.id}`;
                  const isOpen = open === v.id;
                  const label = v.name || v.email;
                  return (
                    <Fragment key={v.id}>
                      <tr>
                        <td>
                          <DetailsToggle open={isOpen} onToggle={() => setOpen(isOpen ? null : v.id)} controls={detailsId} label={label} />
                        </td>
                        <td>
                          <div className="adm-name-line">
                            <button type="button" className="adm-link adm-truncate" title={label} onClick={() => go(`/admin/visionaries/${v.id}`)}>
                              {label}
                            </button>
                            {v.recordType && <RecordBadge type={v.recordType} hideReal />}
                          </div>
                          <div className="adm-cell-sub">
                            <Truncate text={v.email} />
                          </div>
                        </td>
                        <td>
                          <div className="adm-cell-main">
                            <Truncate text={v.organizationName ?? "—"} />
                          </div>
                          <div className="adm-cell-sub">
                            <Truncate text={v.location} />
                          </div>
                        </td>
                        <td>
                          <ProfileBadge saved={v.profileSaved} />
                        </td>
                        <td className="adm-num">{v.projectCount}</td>
                        <td className="adm-num">{v.requestCount}</td>
                        <td>
                          <AccountBadge status={v.accountStatus} />
                        </td>
                        <td className="adm-nowrap">{fmtDate(v.registeredAt)}</td>
                        <td className="adm-td-actions">
                          <ActionsMenu
                            context={label}
                            items={[
                              { label: "Open Visionary details", icon: <UserRound size={15} />, onSelect: () => go(`/admin/visionaries/${v.id}`) },
                              { label: "Open user account", icon: <UserRound size={15} />, onSelect: () => go(`/admin/users/${v.id}`) },
                              recordAction(v, (row, t) => void setRecordType(row, t)),
                            ]}
                          />
                        </td>
                      </tr>
                      {isOpen && (
                        <DetailsRow
                          id={detailsId}
                          colSpan={9}
                          items={[
                            ["Role / title", v.roleTitle],
                            ["Account name", v.accountName],
                            ["Phone", v.phone],
                            ["Last saved", fmtDateTime(v.lastSavedAt)],
                            ["Last activity", fmtAgo(v.lastActivity)],
                          ]}
                        />
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => f.set({ page: String(p) }, true)} />
        </div>
      )}
    </>
  );
}

function Item({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="detail-item">
      <p className="detail-label">{label}</p>
      <div className="detail-value">{value === null || value === undefined || value === "" ? "—" : value}</div>
    </div>
  );
}

/** One Visionary: saved profile, projects (requirements) and the requests they sent. Read-only. */
export function VisionaryDetail({ id }: { id: string }) {
  const { go } = useAdminHost();
  const { data, error, loading, reload } = useResource<VisionaryDetailData>(`/visionaries/${id}`);
  const setRecordType = useSetRecordType(reload);
  if (!data) return loading ? <Loading /> : <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const v = data.visionary;
  const p = data.profile;

  return (
    <>
      <PageHeader
        onBack={() => go("/admin/visionaries")}
        title={v.name || v.email}
        subtitle={`${v.email}${v.phone ? ` · ${v.phone}` : ""} · Registered ${fmtDate(v.registeredAt)}`}
        actions={
          <>
            {(v.recordType ?? "REAL") === "REAL" ? (
              <button type="button" className="btn-ghost" onClick={() => void setRecordType(v, "DEMO")}>
                <FlaskConical size={15} /> Mark as demo
              </button>
            ) : (
              <button type="button" className="btn-ghost" onClick={() => void setRecordType(v, "REAL")}>
                <BadgeCheck size={15} /> Mark as real
              </button>
            )}
            <button type="button" className="btn-ghost" onClick={() => go(`/admin/users/${v.id}`)}>
              <UserRound size={15} /> User account
            </button>
          </>
        }
      />

      <div className="adm-two-col">
        <div className="adm-col">
          <section className="card adm-section">
            <div className="adm-section-head">
              <h3>Profile</h3>
              <ProfileBadge saved={!!p} />
            </div>
            {p ? (
              <div className="details-grid">
                <Item label="Full name" value={p.fullName} />
                <Item label="Role / title" value={p.roleTitle} />
                <Item label="Organization" value={p.organizationName} />
                <Item label="Location" value={p.location} />
                <Item label="Introduction" value={p.introduction} />
                <Item label="Last updated" value={fmtDateTime(p.updatedAt)} />
              </div>
            ) : (
              <p className="adm-muted">This Visionary has not saved the “Let’s start with you” profile yet.</p>
            )}
          </section>

          <section className="card adm-section">
            <div className="adm-section-head">
              <h3>Account</h3>
              <AccountBadge status={v.accountStatus} />
            </div>
            <div className="details-grid">
              <Item label="Account name" value={v.accountName} />
              <Item label="Email" value={v.email} />
              <Item label="Last activity" value={fmtAgo(v.lastActivity)} />
              <Item label="Saved request drafts" value={String(data.draftCount)} />
              <Item label="Data" value={<RecordBadge type={v.recordType ?? "REAL"} />} />
            </div>
          </section>
        </div>

        <div className="adm-col">
          <section className="card adm-section">
            <div className="adm-section-head">
              <h3>Projects & requirements</h3>
              <span className="adm-muted">{data.projects.length}</span>
            </div>
            {data.projects.length === 0 ? (
              <p className="adm-muted">No project saved yet.</p>
            ) : (
              <div className="adm-stack">
                {data.projects.map((pj) => (
                  <div key={pj.id} className="adm-subcard">
                    <div className="adm-section-head">
                      <b className="adm-truncate" title={pj.name}>
                        {pj.name}
                      </b>
                      <span className="badge badge-neutral">{statusText(pj.status)}</span>
                    </div>
                    {pj.idea && <p className="adm-section-hint adm-wrap">{pj.idea}</p>}
                    <div className="details-grid">
                      <Item label="Product" value={pj.product} />
                      <Item label="Industry" value={pj.industry} />
                      <Item label="Stage" value={pj.stage} />
                      <Item label="Manufacturing location" value={pj.location} />
                      <Item label="Quantity" value={pj.quantity === null ? null : `${pj.quantity.toLocaleString("en-IN")} ${pj.quantityUnit ?? ""}`} />
                      <Item label="Budget" value={pj.budget === null ? null : fmtMoney(pj.budget, pj.currency)} />
                      <Item label="Timeline" value={pj.timeline ? (TIMELINE_LABELS[pj.timeline] ?? pj.timeline) : null} />
                      <Item label="Additional requirements" value={pj.additionalRequirements} />
                      <Item label="Requests sent" value={String(pj.requestCount)} />
                      <Item label="Last saved" value={fmtDateTime(pj.updatedAt)} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <section className="card adm-section">
        <div className="adm-section-head">
          <h3>Manufacturing requests</h3>
          <span className="adm-muted">{data.requests.length}</span>
        </div>
        {data.requests.length === 0 ? (
          <p className="adm-muted">No requests sent yet.</p>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table adm-table-fixed">
              <colgroup>
                <col className="adm-w-main" />
                <col className="adm-w-company" />
                <col className="adm-w-request" />
                <col className="adm-w-status" />
                <col className="adm-w-date" />
              </colgroup>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Manufacturer</th>
                  <th>Machine · budget</th>
                  <th>Status</th>
                  <th>Sent</th>
                </tr>
              </thead>
              <tbody>
                {data.requests.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="adm-cell-main">
                        <Truncate text={r.projectName} />
                      </div>
                      <div className="adm-cell-sub">
                        <Truncate
                          text={`${r.number} · ${DURATION_LABELS[r.duration] ?? r.duration} · ${TIMELINE_LABELS[r.timeline] ?? r.timeline}`}
                        />
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="adm-link adm-truncate"
                        title={r.manufacturerName ?? ""}
                        onClick={() => go(`/admin/manufacturers/${r.manufacturerId}`)}
                      >
                        <Factory size={13} aria-hidden /> {r.manufacturerName || "Manufacturer"}
                      </button>
                      <div className="adm-cell-sub">
                        <Truncate text={r.location} />
                      </div>
                    </td>
                    <td>
                      <div className="adm-cell-main">
                        <Truncate text={r.machine} />
                      </div>
                      <div className="adm-cell-sub">
                        {fmtMoney(r.budget, r.currency)}
                        {r.quantity !== null ? ` · ${r.quantity.toLocaleString("en-IN")} ${r.unit ?? ""}` : ""}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${requestTone(r.status)}`}>{statusText(r.status)}</span>
                    </td>
                    <td className="adm-nowrap">{fmtDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
