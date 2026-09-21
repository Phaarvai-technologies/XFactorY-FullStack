import { useMemo, useState, type ReactNode } from "react";
import { FactoryMark } from "@/components/layout/Logo";
import {
  BellIcon,
  CalendarDaysIcon,
  CheckIcon,
  DocumentIcon,
  ListIcon,
  MachineIcon,
} from "@/components/manufacturer/icons";
import { CHECKLIST_ITEMS, type ProfileCompletionFlags } from "@/components/manufacturer/ProfileWizard";
import type {
  BookingRequest,
  CapacityPlan,
  MachineryListing,
  ManufacturerState,
} from "@/lib/manufacturer/types";

export type DashboardPanel = "home" | "profile" | "machinery" | "availability" | "bookings";

type DashboardScreenProps = {
  state: ManufacturerState;
  pct: number;
  flags: ProfileCompletionFlags;
  onOpenProfileWizard: (jumpToNextIncomplete: boolean) => void;
  onOpenMachineryWizard: () => void;
  onSetMachineryStatus: (id: number, status: MachineryListing["status"]) => void;
  onSaveCapacity: (plan: CapacityPlan) => void;
  onCycleDay: (key: string) => void;
  onOpenRecurringModal: () => void;
  onAcceptBooking: (id: number) => void;
  onDeclineBooking: (id: number) => void;
  onBackToLanding: () => void;
  showToast: (message: string) => void;
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const BOOKING_STATUS_BADGE: Record<BookingRequest["status"], string> = {
  Booked: "badge-verified",
  Cancelled: "badge-rejected",
  Reserved: "badge-pending",
  New: "badge-neutral",
};

const MACHINERY_STATUS_BADGE: Record<MachineryListing["status"], string> = {
  Published: "badge-verified",
  Archived: "badge-neutral",
  Draft: "badge-pending",
  Unpublished: "badge-pending",
};

function dateKey(y: number, m: number, d: number) {
  return `${y}-${m}-${d}`;
}

export function DashboardScreen({
  state,
  pct,
  flags,
  onOpenProfileWizard,
  onOpenMachineryWizard,
  onSetMachineryStatus,
  onSaveCapacity,
  onCycleDay,
  onOpenRecurringModal,
  onAcceptBooking,
  onDeclineBooking,
  onBackToLanding,
  showToast,
}: DashboardScreenProps) {
  const [panel, setPanel] = useState<DashboardPanel>("home");

  const initials = useMemo(() => {
    const first = state.account.firstName || "J";
    const last = state.account.lastName || "L";
    return `${first[0]}${last[0]}`.toUpperCase();
  }, [state.account.firstName, state.account.lastName]);

  const fullName = `${state.account.firstName || "Jordan"} ${state.account.lastName || "Lee"}`.trim();

  const pendingBookings = state.bookings.filter((b) => b.status === "New").length;

  const nextChecklist = CHECKLIST_ITEMS.find((item) => !flags[item.key]);
  const nextStepLabel = nextChecklist
    ? `Complete ${nextChecklist.label}`
    : "All done — your profile is complete!";

  const machineryCount = state.machinery.length;
  const now = new Date();
  const calYear = now.getFullYear();
  const calMonth = now.getMonth();
  const monthLabel = now.toLocaleString("default", { month: "long", year: "numeric" });
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  function showPanel(next: DashboardPanel) {
    setPanel(next);
    window.scrollTo(0, 0);
  }

  return (
    <div>
      <div className="topbar">
        <div className="topbar-inner">
          <div className="topbar-logo">
            <FactoryMark className="topbar-factory-mark" />
            X!Y <span className="topbar-crumb">Manufacturer Dashboard</span>
          </div>
          <div className="topbar-actions">
            <span className="pct-badge">{pct}% complete</span>
            <button className="icon-btn" type="button" title="Notifications">
              <BellIcon size={17} />
              <span className="dot" />
            </button>
            <button
              className="avatar-chip"
              type="button"
              onClick={() => showToast("Account menu — demo only.")}
            >
              <span className="avatar-circle">{initials}</span>
              <span>{fullName}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="dash-main">
        {panel === "home" ? (
          <div>
            <button
              className="icon-btn"
              type="button"
              title="Back"
              aria-label="Back"
              onClick={onBackToLanding}
              style={{ marginBottom: 20 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M15 19l-7-7 7-7"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div className="welcome-card">
              <div className="welcome-row">
                <div>
                  <p className="welcome-title">
                    Welcome{state.account.firstName ? `, ${state.account.firstName}` : ", Manufacturer"}
                  </p>
                  <p className="welcome-sub">Here&apos;s where your profile and listings stand today.</p>
                </div>
                <div className="welcome-pct-wrap">
                  <div className="welcome-pct">{pct}%</div>
                  <div className="welcome-pct-label">Profile Complete</div>
                </div>
              </div>
              <div className="welcome-progress-track">
                <div className="welcome-progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="checklist">
                {CHECKLIST_ITEMS.map((item) => {
                  const done = flags[item.key];
                  return (
                    <div className={`checklist-item${done ? " done" : ""}`} key={item.key}>
                      <span className="checklist-dot">
                        {done ? <CheckIcon size={10} stroke="var(--blue-700)" /> : null}
                      </span>
                      {done ? "✓ " : "○ "}
                      {item.label}
                    </div>
                  );
                })}
              </div>
              <div className="welcome-next-row">
                <div className="welcome-next-text">
                  Next step: <b>{nextStepLabel}</b>
                </div>
                <button className="btn-primary" type="button" onClick={() => onOpenProfileWizard(true)}>
                  Complete remaining details
                </button>
              </div>
            </div>

            <p className="section-label">Your workspace</p>
            <div className="nav-cards">
              <button className="nav-card" type="button" onClick={() => showPanel("profile")}>
                <div className="nav-card-icon">
                  <DocumentIcon size={19} />
                </div>
                <h3>Company Profile</h3>
                <p>Company details, location, certifications, infrastructure &amp; FAQ.</p>
                <span className="nav-card-meta">{pct}% complete →</span>
              </button>
              <button className="nav-card" type="button" onClick={() => showPanel("machinery")}>
                <div className="nav-card-icon">
                  <MachineIcon size={19} />
                </div>
                <h3>Machinery</h3>
                <p>List machinery &amp; services with pricing and specs.</p>
                <span className="nav-card-meta">
                  {machineryCount
                    ? `${machineryCount} listing${machineryCount > 1 ? "s" : ""}`
                    : "No listings yet"}{" "}
                  →
                </span>
              </button>
              <button className="nav-card" type="button" onClick={() => showPanel("availability")}>
                <div className="nav-card-icon">
                  <CalendarDaysIcon size={19} />
                </div>
                <h3>Availability</h3>
                <p>Manage your calendar, capacity, and special pricing.</p>
                <span className="nav-card-meta">
                  {state.capacity ? "Capacity set" : "Not set"} →
                </span>
              </button>
              <button className="nav-card" type="button" onClick={() => showPanel("bookings")}>
                <div className="nav-card-icon">
                  <ListIcon size={19} />
                </div>
                <h3>Booking Requests</h3>
                <p>Review, accept, or decline incoming requests.</p>
                <span className="nav-card-meta">{pendingBookings} pending →</span>
              </button>
            </div>
          </div>
        ) : null}

        {panel === "profile" ? (
          <div>
            <div className="panel-header">
              <button className="panel-back" type="button" onClick={() => showPanel("home")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M15 19l-7-7 7-7"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <div>
                <h2>Company Profile</h2>
                <p>Company details, location, certifications, infrastructure &amp; FAQ.</p>
              </div>
            </div>
            <div className="card">
              {CHECKLIST_ITEMS.map((item) => (
                <div className="wiz-check-row" key={item.key}>
                  <div className={`wiz-check-icon${flags[item.key] ? " done" : ""}`}>
                    {flags[item.key] ? <CheckIcon size={12} /> : null}
                  </div>
                  <div className="wiz-check-text">
                    <b>{item.label}</b>
                    <span>{profileSummarySubtext(item.key, state)}</span>
                  </div>
                </div>
              ))}
              <button
                className="btn-primary"
                type="button"
                style={{ marginTop: 22 }}
                onClick={() => onOpenProfileWizard(false)}
              >
                Open profile setup
              </button>
            </div>
          </div>
        ) : null}

        {panel === "machinery" ? (
          <div>
            <div className="panel-header">
              <button className="panel-back" type="button" onClick={() => showPanel("home")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M15 19l-7-7 7-7"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <div>
                <h2>Machinery &amp; Services</h2>
                <p>Everything you&apos;ve listed for buyers to find.</p>
              </div>
              <div style={{ marginLeft: "auto" }}>
                <button className="btn-primary" type="button" onClick={onOpenMachineryWizard}>
                  Add Machinery
                </button>
              </div>
            </div>
            <div>
              {state.machinery.map((m) => {
                const primaryImg = m.images.find((i) => i.primary) ?? m.images[0];
                let actions: ReactNode = null;
                if (m.status === "Draft") {
                  actions = (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => onSetMachineryStatus(m.id, "Published")}
                    >
                      Publish
                    </button>
                  );
                } else if (m.status === "Published") {
                  actions = (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => onSetMachineryStatus(m.id, "Unpublished")}
                    >
                      Unpublish
                    </button>
                  );
                } else if (m.status === "Unpublished") {
                  actions = (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => onSetMachineryStatus(m.id, "Published")}
                    >
                      Publish
                    </button>
                  );
                }
                return (
                  <div className="list-item" key={m.id}>
                    {primaryImg ? (
                      <div className="img-thumb" style={{ width: 52, height: 52, flexShrink: 0 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={primaryImg.src} alt="" />
                      </div>
                    ) : (
                      <div className="nav-card-icon" style={{ margin: 0, flexShrink: 0 }}>
                        <MachineIcon size={18} />
                      </div>
                    )}
                    <div className="list-item-main" style={{ flex: 1 }}>
                      <b>{m.type || "Untitled machinery"}</b>
                      <span>{[m.industry, m.subcategory].filter(Boolean).join(" · ")}</span>
                    </div>
                    <div className="item-actions">
                      <span className={`badge ${MACHINERY_STATUS_BADGE[m.status]}`}>{m.status}</span>
                      {actions}
                      <button
                        type="button"
                        className="btn-danger-ghost"
                        onClick={() => onSetMachineryStatus(m.id, "Archived")}
                      >
                        Archive
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {machineryCount === 0 ? (
              <div className="empty-state card">
                <MachineIcon size={34} className="" />
                <p>You haven&apos;t listed any machinery or services yet.</p>
                <button className="btn-primary" type="button" onClick={onOpenMachineryWizard}>
                  Add your first machinery
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {panel === "availability" ? (
          <div>
            <div className="panel-header">
              <button className="panel-back" type="button" onClick={() => showPanel("home")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M15 19l-7-7 7-7"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <div>
                <h2>Availability</h2>
                <p>Calendar, capacity, and special pricing.</p>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 20 }}>
              <div className="cal-head">
                <h3>Availability — {monthLabel}</h3>
              </div>
              <div className="cal-legend">
                <span>
                  <span
                    className="cal-swatch"
                    style={{ background: "var(--emerald-50)", border: "1px solid var(--emerald-200)" }}
                  />
                  Available
                </span>
                <span>
                  <span
                    className="cal-swatch"
                    style={{ background: "var(--red-100)", border: "1px solid #fecaca" }}
                  />
                  Blocked
                </span>
                <span>
                  <span className="cal-swatch" style={{ background: "#fff", border: "1px solid var(--slate-200)" }} />
                  Unset
                </span>
              </div>
              <div className="cal-grid">
                {DOW.map((d) => (
                  <div className="cal-dow" key={d}>
                    {d}
                  </div>
                ))}
              </div>
              <div className="cal-grid" style={{ marginTop: 8 }}>
                {Array.from({ length: firstDay }, (_, i) => (
                  <div className="cal-day empty" key={`empty-${i}`} />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const day = i + 1;
                  const key = dateKey(calYear, calMonth, day);
                  const status = state.calendar[key];
                  return (
                    <div
                      className={`cal-day${status ? ` ${status}` : ""}`}
                      key={key}
                      onClick={() => onCycleDay(key)}
                    >
                      {day}
                    </div>
                  );
                })}
              </div>
              <p className="field-hint" style={{ marginTop: 14 }}>
                Tap a date to cycle it: unset → available → blocked.
              </p>
              <div className="field-hint">
                {state.recurring
                  ? `Recurring: ${state.recurring.days.join(", ")} · ${state.recurring.start}–${state.recurring.end}`
                  : ""}
              </div>
            </div>

            <div className="card">
              <CapacityForm
                machinery={state.machinery}
                capacity={state.capacity}
                onSave={onSaveCapacity}
                onOpenRecurringModal={onOpenRecurringModal}
                showToast={showToast}
              />
            </div>
          </div>
        ) : null}

        {panel === "bookings" ? (
          <div>
            <div className="panel-header">
              <button className="panel-back" type="button" onClick={() => showPanel("home")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M15 19l-7-7 7-7"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <div>
                <h2>Booking Requests</h2>
                <p>Accept or decline requests from buyers.</p>
              </div>
            </div>
            <div className="stat-row">
              <div className="stat-chip">
                <b>{state.bookings.filter((b) => b.status === "New").length}</b>
                <span>New requests</span>
              </div>
              <div className="stat-chip">
                <b>{state.bookings.filter((b) => b.status === "Reserved").length}</b>
                <span>Reserved</span>
              </div>
              <div className="stat-chip">
                <b>{state.bookings.filter((b) => b.status === "Booked").length}</b>
                <span>Booked</span>
              </div>
              <div className="stat-chip">
                <b>{state.bookings.filter((b) => b.status === "Cancelled").length}</b>
                <span>Cancelled</span>
              </div>
            </div>
            <div>
              {state.bookings.map((b) => {
                let actions: ReactNode = null;
                if (b.status === "New") {
                  actions = (
                    <>
                      <button
                        type="button"
                        className="btn-primary"
                        style={{ padding: "8px 16px" }}
                        onClick={() => onAcceptBooking(b.id)}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="btn-danger-ghost"
                        onClick={() => onDeclineBooking(b.id)}
                      >
                        Decline
                      </button>
                    </>
                  );
                } else if (b.status === "Reserved") {
                  actions = (
                    <>
                      <button
                        type="button"
                        className="btn-primary"
                        style={{ padding: "8px 16px" }}
                        onClick={() => onAcceptBooking(b.id)}
                      >
                        Confirm booking
                      </button>
                      <button
                        type="button"
                        className="btn-danger-ghost"
                        onClick={() => onDeclineBooking(b.id)}
                      >
                        Cancel
                      </button>
                    </>
                  );
                } else if (b.status === "Booked") {
                  actions = (
                    <button
                      type="button"
                      className="btn-danger-ghost"
                      onClick={() => onDeclineBooking(b.id)}
                    >
                      Cancel booking
                    </button>
                  );
                }
                return (
                  <div className="list-item" key={b.id}>
                    <div className="list-item-main" style={{ flex: 1 }}>
                      <b>{b.buyer}</b>
                      <span>
                        {b.item} · {b.date}
                      </span>
                    </div>
                    <div className="item-actions">
                      <span className={`badge ${BOOKING_STATUS_BADGE[b.status]}`}>{b.status}</span>
                      {actions}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function profileSummarySubtext(
  key: keyof ProfileCompletionFlags,
  state: ManufacturerState,
): string {
  switch (key) {
    case "companyDetailsDone":
      return "Name, logo, about, vision & mission, org info";
    case "locationDone":
      return "Address, map location, SEZ status, serviceable areas";
    case "certsDone":
      return state.epic2.certifications.length
        ? `${state.epic2.certifications.length} certification${state.epic2.certifications.length > 1 ? "s" : ""} added`
        : "No certifications added";
    case "infraDone":
      return "Electricity, water, storage, packaging, waste, QA";
    case "faqDone":
      return state.epic2.faqs.length
        ? `${state.epic2.faqs.length} FAQ${state.epic2.faqs.length > 1 ? "s" : ""} added`
        : "No FAQs added";
    default:
      return "";
  }
}

function CapacityForm({
  machinery,
  capacity,
  onSave,
  onOpenRecurringModal,
  showToast,
}: {
  machinery: MachineryListing[];
  capacity: CapacityPlan | null;
  onSave: (plan: CapacityPlan) => void;
  onOpenRecurringModal: () => void;
  showToast: (message: string) => void;
}) {
  const [machine, setMachine] = useState(capacity?.machine ?? "");
  const [count, setCount] = useState(capacity?.count ?? "");
  const [start, setStart] = useState(capacity?.start ?? "");
  const [end, setEnd] = useState(capacity?.end ?? "");

  function handleSave() {
    if (!machine || !count.trim() || !start || !end) {
      showToast("Fill in machine, number of machines, and both dates.");
      return;
    }
    onSave({ machine, count: count.trim(), start, end });
  }

  return (
    <>
      <div className="form-grid">
        <div>
          <label htmlFor="cap-machine">Machine Name</label>
          <select
            id="cap-machine"
            className={machine ? "" : "placeholder-shown"}
            value={machine}
            onChange={(e) => setMachine(e.target.value)}
          >
            <option value="" disabled>
              Select a machine
            </option>
            {machinery.map((m) => (
              <option key={m.id}>{m.type || "Untitled machinery"}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cap-count">No. of Machines</label>
          <input
            type="number"
            id="cap-count"
            min={1}
            placeholder="e.g. 5"
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="cap-start">Start date</label>
          <input
            type="date"
            id="cap-start"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="cap-end">End date</label>
          <input
            type="date"
            id="cap-end"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <button className="btn-ghost" type="button" onClick={onOpenRecurringModal}>
            Add recurring
          </button>
        </div>
      </div>
      <button className="btn-primary" type="button" style={{ marginTop: 20 }} onClick={handleSave}>
        Save capacity
      </button>
    </>
  );
}
