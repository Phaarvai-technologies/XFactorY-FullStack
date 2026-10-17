import { FactoryMark } from "@/components/layout/Logo";
import { AccountMenu } from "@/components/manufacturer/AccountMenu";
import { NotificationBell } from "@/components/manufacturer/NotificationBell";
import { CalendarDaysIcon, DocumentIcon, ListIcon, MachineIcon } from "@/components/manufacturer/icons";
import {
  COMPANY_FIELDS,
  FIELD_LABELS,
  PERSONAL_FIELDS,
  formatIndianPhone,
  type OnboardingState,
} from "@/lib/manufacturer/onboarding";

/** The manufacturer sections that stay locked until X!Y approves the application. */
const LOCKED_SECTIONS = [
  { title: "Company Profile", text: "Company details, location, certifications, infrastructure & FAQ.", icon: DocumentIcon },
  { title: "Machinery", text: "List machinery & services with pricing and specs.", icon: MachineIcon },
  { title: "Availability", text: "Manage your calendar, capacity, and special pricing.", icon: CalendarDaysIcon },
  { title: "Booking Requests", text: "Review, accept, or decline incoming requests.", icon: ListIcon },
];

function fmt(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

type Props = {
  onboarding: OnboardingState;
  fullName: string;
  initials: string;
  /** Opens the details form with the requested corrections. */
  onCorrect: () => void;
  /** A rejected applicant may apply again (only when X!Y's reapplication policy allows it). */
  onReapply: () => void;
  /** Back to the main X!Y dashboard (the account and other roles are unaffected). */
  onMainDashboard: () => void;
};

/**
 * What an applicant sees until their manufacturer application is approved: the status, X!Y's
 * message (never internal notes), what they sent, and the remaining sections shown as locked.
 */
export function ApplicationStatusScreen({ onboarding, fullName, initials, onCorrect, onReapply, onMainDashboard }: Props) {
  const app = onboarding.application;
  const status = onboarding.access.status;
  const reapply = onboarding.reapply;

  const heading =
    status === "pending"
      ? "Your application is with X!Y for review"
      : status === "changes_requested"
        ? "X!Y asked for a few corrections"
        : status === "rejected"
          ? "Your manufacturer application was not approved"
          : status === "no_permission"
            ? "Your access to this company is view-only"
            : "Send your basic details for approval";

  return (
    <div>
      <div className="topbar">
        <div className="topbar-inner">
          <div className="topbar-logo">
            <FactoryMark className="topbar-factory-mark" />
            X!Y <span className="topbar-crumb">Manufacturer</span>
          </div>
          <div className="topbar-actions">
            <NotificationBell onOpenProfile={status === "changes_requested" ? onCorrect : undefined} />
            <AccountMenu>
              <span className="avatar-circle">{initials}</span>
              <span>{fullName}</span>
            </AccountMenu>
          </div>
        </div>
      </div>

      <div className="dash-main">
        <section className={`card app-status app-status-${status}`} aria-labelledby="app-status-title">
          <span className={`badge ${status === "rejected" ? "badge-rejected" : status === "pending" ? "badge-pending" : "badge-neutral"}`}>
            {status === "pending" ? "Pending approval" : status === "changes_requested" ? "Corrections requested"
              : status === "rejected" ? "Not approved" : "Locked"}
          </span>
          <h1 id="app-status-title">{heading}</h1>

          {status === "pending" ? (
            <p>
              We received your details{app?.submittedAt ? ` on ${fmt(app.submittedAt)}` : ""}
              {app?.companyName ? ` for ${app.companyName}` : ""}. You&rsquo;ll get a notification when X!Y has
              reviewed them. Until then the rest of the manufacturer area stays locked.
            </p>
          ) : null}

          {status === "changes_requested" && app ? (
            <>
              {app.feedback ? (
                <div className="account-feedback" role="note">
                  <b>Message from X!Y</b>
                  <p>{app.feedback}</p>
                </div>
              ) : null}
              <p>
                Please correct: <b>{app.correctionFields.map((f) => FIELD_LABELS[f] ?? f).join(", ")}</b>. Only these
                fields can be changed; everything else stays as you sent it.
              </p>
              <div className="app-status-actions">
                <button type="button" className="btn-primary" onClick={onCorrect}>Correct my details</button>
              </div>
            </>
          ) : null}

          {status === "rejected" ? (
            <>
              {app?.feedback ? (
                <div className="account-feedback app-status-reason" role="note">
                  <b>Reason</b>
                  <p>{app.feedback}</p>
                </div>
              ) : null}
              <p>
                Your X!Y account and your other roles are not affected. The manufacturer sections are not available
                for this application.
              </p>
              <p className="field-hint">
                {reapply?.allowed
                  ? "You can send a new application."
                  : reapply?.availableFrom
                    ? `You can apply again from ${fmt(reapply.availableFrom)}.`
                    : "Applying again is not available yet. Please contact X!Y support if you have questions."}
              </p>
              <div className="app-status-actions">
                <button type="button" className="btn-primary" onClick={onMainDashboard}>Go to my X!Y dashboard</button>
                {reapply?.allowed ? (
                  <button type="button" className="btn-ghost" onClick={onReapply}>Apply again</button>
                ) : null}
              </div>
            </>
          ) : null}

          {status === "no_permission" ? (
            <p>
              Your membership of this company does not include editing it. Ask the company&rsquo;s primary user to
              change your access.
            </p>
          ) : null}

          {app && status !== "rejected" ? (
            <details className="app-status-sent">
              <summary>What you sent</summary>
              <dl>
                {[...COMPANY_FIELDS, ...PERSONAL_FIELDS].map((f) => (
                  <div key={f.key}>
                    <dt>{f.label}</dt>
                    <dd>{(f.key === "companyPhone" ? formatIndianPhone(app.values[f.key]) : app.values[f.key]) || "—"}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ) : null}
        </section>

        {status !== "rejected" ? (
          <>
            <p className="section-label">Opens after approval</p>
            <div className="nav-cards">
              {LOCKED_SECTIONS.map(({ title, text, icon: Icon }) => (
                <div className="nav-card nav-card-locked" key={title} aria-disabled="true">
                  <div className="nav-card-icon">
                    <Icon size={19} />
                  </div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                  <span className="nav-card-meta">Locked until approval</span>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
