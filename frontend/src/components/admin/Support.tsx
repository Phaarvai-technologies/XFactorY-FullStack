"use client";

import { Mail, Send, UserRound } from "lucide-react";
import { useCallback, useState } from "react";
import { EmailStatusBadge, ErrorBox, Loading, PageHeader, SearchInput } from "@/components/admin/ui";
import { jsonBody, useAdminApi, useAdminHost, useResource } from "@/lib/admin/api";
import { fmtDateTime } from "@/lib/admin/format";
import type { EmailLog, RecentError, TestEmailResult } from "@/lib/admin/types";

const TEMPLATE_LABELS: Record<string, string> = {
  welcome: "Welcome (new user)",
  review_needs_correction: "Profile needs changes",
  review_reviewed: "Profile reviewed",
  account_suspended: "Account suspended",
  account_reactivated: "Account reactivated",
  admin_account_created: "Admin account created",
  admin_password_changed: "Admin password changed",
  test: "Test email",
};

/** Outgoing email: send a test and see the latest deliveries. */
function EmailCard() {
  const call = useAdminApi();
  const log = useResource<EmailLog>("/support/emails");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestEmailResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setFailure(null);
    setResult(null);
    try {
      setResult(await call<TestEmailResult>("/support/test-email", jsonBody("POST", { to: to.trim() || null })));
      log.reload();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Could not send the test email.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card adm-section">
      <div className="adm-section-head">
        <h3>
          <Mail size={16} /> Outgoing email
        </h3>
        {log.data && (
          <span className={`badge ${log.data.smtpConfigured ? "badge-verified" : "badge-neutral"}`}>
            {log.data.smtpConfigured ? "Email is on" : "Email is off (SMTP_HOST not set)"}
          </span>
        )}
      </div>
      <p className="adm-section-hint">
        Send a test email to check the setup. Verification codes are sent by Clerk and are not listed here.
      </p>
      <div className="adm-toolbar-row">
        <div className="input-wrap adm-search">
          <input
            type="email"
            value={to}
            placeholder="Recipient — leave empty to send to yourself"
            aria-label="Test email recipient"
            onChange={(e) => setTo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && void send()}
          />
        </div>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void send()}>
          <Send size={14} /> {busy ? "Sending…" : "Send test email"}
        </button>
      </div>
      {result && (
        <p className={result.status === "sent" ? "adm-section-hint" : "field-error"} role="status">
          {result.status === "sent"
            ? `Test email sent to ${result.to}.`
            : result.status === "skipped"
              ? "Email is off: set SMTP_HOST (and the other SMTP_* settings) in the backend .env and restart the backend."
              : `Sending to ${result.to} failed: ${result.error}`}
        </p>
      )}
      {failure && <p className="field-error">{failure}</p>}

      {log.error && <ErrorBox message={log.error.message} onRetry={log.reload} />}
      {!log.data ? (
        log.loading && <Loading />
      ) : log.data.emails.length === 0 ? (
        <p className="adm-muted">No emails sent yet.</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>When</th>
                <th>To</th>
                <th>Email</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {log.data.emails.map((e) => (
                <tr key={e.id}>
                  <td className="adm-nowrap">{fmtDateTime(e.created_at)}</td>
                  <td>{e.to_email}</td>
                  <td className="adm-wrap">
                    <div className="adm-cell-main">{e.subject}</div>
                    <div className="adm-cell-sub">{TEMPLATE_LABELS[e.template] ?? (e.template.startsWith("clerk_") ? `Clerk email (${e.template.slice(6)})` : e.template)}</div>
                  </td>
                  <td>
                    <EmailStatusBadge status={e.status} />
                    {e.error && <div className="adm-cell-sub adm-wrap">{e.error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

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

      <EmailCard />

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
