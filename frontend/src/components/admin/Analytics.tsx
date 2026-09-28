"use client";

import { ErrorBox, Loading, PageHeader } from "@/components/admin/ui";
import { toQuery, useResource, useUrlFilters } from "@/lib/admin/api";
import { ENTRY_LABELS, REVIEW_LABELS, pct } from "@/lib/admin/format";
import type { Analytics as Data, CountRow, EntrySource, ReviewStatus } from "@/lib/admin/types";

const PRESETS: { key: string; label: string; days: number | null }[] = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "all", label: "All time", days: null },
];

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Ranked horizontal bars: one series, one hue, count and % always shown as text
 * next to each bar, so the list doubles as the table view.
 */
function BarList({
  title,
  rows,
  base,
  baseLabel,
  empty = "No data for this period.",
  tone = "blue",
}: {
  title: string;
  rows: CountRow[];
  base: number;
  baseLabel: string;
  empty?: string;
  tone?: "blue" | "amber";
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const visible = rows.filter((r) => r.count > 0);
  return (
    <section className="card adm-chart">
      <div className="adm-section-head">
        <h3>{title}</h3>
        <span className="adm-muted">% of {baseLabel}</span>
      </div>
      {visible.length === 0 ? (
        <p className="adm-muted">{empty}</p>
      ) : (
        <ul className="adm-bars">
          {visible.map((r) => (
            <li key={r.label} title={`${r.label}: ${r.count} (${pct(r.count, base)})`}>
              <span className="adm-bar-label">{r.label}</span>
              <span className="adm-bar-track">
                <span className={`adm-bar-fill ${tone}`} style={{ width: `${(r.count / max) * 100}%` }} />
              </span>
              <span className="adm-bar-value">
                <b>{r.count}</b> <span>{pct(r.count, base)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Analytics() {
  const f = useUrlFilters("/admin/analytics");
  const preset = f.get("range") || (f.get("from") || f.get("to") ? "custom" : "30");
  const presetDays = PRESETS.find((p) => p.key === preset)?.days;
  const from = preset === "custom" ? f.get("from") : presetDays ? isoDaysAgo(presetDays) : "";
  const to = preset === "custom" ? f.get("to") : "";
  const includeTest = f.get("include_test") === "1";
  const { data, error, loading, reload } = useResource<Data>(
    `/analytics${toQuery({ from, to, include_test: includeTest ? "true" : null })}`,
  );

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Registrations, onboarding completion and data quality. Demo and test records are excluded unless you include them."
      />
      <div className="card adm-toolbar">
        <div className="adm-toolbar-row">
          <div className="pill-group adm-pills">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`pill-option${preset === p.key ? " active" : ""}`}
                onClick={() => f.set({ range: p.key === "30" ? null : p.key, from: null, to: null })}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              className={`pill-option${preset === "custom" ? " active" : ""}`}
              onClick={() => f.set({ range: "custom", from: from || isoDaysAgo(30), to: to || isoDaysAgo(1) })}
            >
              Custom
            </button>
          </div>
          {preset === "custom" && (
            <div className="adm-date-range">
              <input type="date" aria-label="From" value={from} max={to || undefined} onChange={(e) => f.set({ from: e.target.value })} />
              <span>to</span>
              <input type="date" aria-label="To" value={to} min={from || undefined} onChange={(e) => f.set({ to: e.target.value })} />
            </div>
          )}
          <label className="adm-toggle">
            <input type="checkbox" checked={includeTest} onChange={(e) => f.set({ include_test: e.target.checked ? "1" : null })} />
            Include demo/test
          </label>
        </div>
      </div>

      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {!data ? (
        loading && <Loading />
      ) : (
        <div className={loading ? "adm-stale" : undefined}>
          {!includeTest && data.excludedDemoTest > 0 && (
            <p className="adm-muted adm-foot-note">
              {data.excludedDemoTest} demo/test record{data.excludedDemoTest === 1 ? "" : "s"} excluded from these numbers.
            </p>
          )}
          <div className="stat-row adm-kpis">
            <div className="stat-chip">
              <b>{data.registrations.users}</b>
              <span>User registrations</span>
            </div>
            <div className="stat-chip">
              <b>{data.registrations.manufacturers}</b>
              <span>Manufacturer profiles started</span>
            </div>
            <div className="stat-chip">
              <b>{data.onboarding.completionRate}%</b>
              <span>
                Onboarding completion · {data.onboarding.completed} of {data.registrations.manufacturers}
              </span>
            </div>
            <div className="stat-chip">
              <b>{data.onboarding.incomplete}</b>
              <span>Incomplete profiles · {pct(data.onboarding.incomplete, data.registrations.manufacturers)}</span>
            </div>
          </div>

          <div className="adm-chart-grid">
            <BarList
              title="Drop-off by section"
              rows={data.dropOff}
              base={data.onboarding.incomplete + data.registrations.usersWithoutProfile}
              baseLabel="unfinished"
              empty="No one has dropped off in this period."
              tone="amber"
            />
            <BarList
              title="Data quality: most-missed required fields"
              rows={data.missingFields}
              base={data.registrations.manufacturers}
              baseLabel="manufacturers"
              empty="No required fields missing."
              tone="amber"
            />
            <BarList title="Manufacturers by industry" rows={data.byIndustry} base={data.registrations.manufacturers} baseLabel="manufacturers" />
            <BarList title="Manufacturers by location" rows={data.byLocation} base={data.registrations.manufacturers} baseLabel="manufacturers" />
            <BarList title="Manufacturers by major process" rows={data.byProcess} base={data.registrations.manufacturers} baseLabel="manufacturers" />
            <BarList title="Referral source" rows={data.byReferral} base={data.registrations.manufacturers} baseLabel="manufacturers" />
            <BarList
              title="Review status"
              rows={data.byReviewStatus.map((r) => ({ ...r, label: REVIEW_LABELS[r.label as ReviewStatus] ?? r.label }))}
              base={data.registrations.manufacturers}
              baseLabel="manufacturers"
            />
            <section className="card adm-chart">
              <div className="adm-section-head">
                <h3>Admin-assisted vs self-completed</h3>
              </div>
              {data.entrySources.length === 0 ? (
                <p className="adm-muted">No data for this period.</p>
              ) : (
                <div className="adm-table-wrap adm-bordered">
                <table className="adm-table adm-table-compact">
                  <thead>
                    <tr>
                      <th>Entry source</th>
                      <th>Profiles</th>
                      <th>Completed</th>
                      <th>Completion rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.entrySources.map((e) => (
                      <tr key={e.label}>
                        <td>{ENTRY_LABELS[e.label as EntrySource] ?? e.label}</td>
                        <td>
                          {e.count} <span className="adm-muted">({pct(e.count, data.registrations.manufacturers)})</span>
                        </td>
                        <td>{e.completed}</td>
                        <td>{pct(e.completed, e.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </section>
          </div>
          <p className="adm-muted adm-foot-note">
            Completeness = required fields completed ÷ applicable required fields × 100 (14 required items across the onboarding
            sections). The period filters by registration date.
          </p>
        </div>
      )}
    </>
  );
}
