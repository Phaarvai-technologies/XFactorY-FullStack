"use client";

import { UserRound } from "lucide-react";
import { useCallback } from "react";
import { ErrorBox, Loading, PageHeader, SearchInput } from "@/components/admin/ui";
import { useAdminHost, useResource } from "@/lib/admin/api";
import { fmtDateTime } from "@/lib/admin/format";
import type { RecentError } from "@/lib/admin/types";

/** XY-ADMIN-10: find a user and see what went wrong. Read-only. */
export function Support() {
  const { go } = useAdminHost();
  const { data, error, loading, reload } = useResource<RecentError[]>("/support/recent-errors");
  const lookup = useCallback((q: string) => q && go(`/admin/users?q=${encodeURIComponent(q)}`), [go]);

  return (
    <>
      <PageHeader
        title="Support & troubleshooting"
        subtitle="Look up a user to see their account status, last login, last save and recent failed operations. Passwords, codes and tokens are never shown."
      />
      <div className="card adm-toolbar">
        <p className="adm-toolbar-label">
          Find a user
        </p>
        <SearchInput value="" onCommit={lookup} placeholder="Name, email or phone — press Enter" debounce={false} />
      </div>

      <section className="card adm-section">
        <div className="adm-section-head">
          <h3>Recent failed operations</h3>
          <span className="adm-muted">Latest 25 across all users</span>
        </div>
        {error && <ErrorBox message={error.message} onRetry={reload} />}
        {!data ? (
          loading && <Loading />
        ) : data.length === 0 ? (
          <p className="adm-muted">No failed operations recorded. </p>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>User</th>
                  <th>Operation</th>
                  <th>What happened</th>
                  <th>Error reference</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {data.map((e, i) => (
                  <tr key={`${e.request_id}-${i}`}>
                    <td className="adm-nowrap">{fmtDateTime(e.created_at)}</td>
                    <td>
                      <div className="adm-cell-main">{e.name || "Unknown user"}</div>
                      <div className="adm-cell-sub">{e.email || ""}</div>
                    </td>
                    <td>
                      <span className="badge badge-rejected">
                        {e.status_code} {e.method}
                      </span>
                      <div className="adm-cell-sub">
                        <code className="adm-code">{e.path}</code>
                      </div>
                    </td>
                    <td className="adm-wrap">{e.detail || "—"}</td>
                    <td>
                      <code className="adm-code">{e.request_id || "—"}</code>
                    </td>
                    <td>
                      {e.user_id && (
                        <button type="button" className="btn-text adm-nowrap" onClick={() => go(`/admin/users/${e.user_id}`)}>
                          <UserRound size={14} /> View user profile
                        </button>
                      )}
                    </td>
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
