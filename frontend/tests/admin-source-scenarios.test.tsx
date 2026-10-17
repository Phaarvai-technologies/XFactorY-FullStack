/** Scenario coverage for the admin screens: source / registration helpers, Users list and user
 * detail, Manufacturers list, company onboarding panel, Visionaries list / detail, and navigation. */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import detailFixture from "./fixtures/admin-detail-pending.json";
import { AdminShell } from "@/components/admin/AdminShell";
import { ManufacturerDetail } from "@/components/admin/ManufacturerDetail";
import { Manufacturers } from "@/components/admin/Manufacturers";
import { UserDetailView, Users } from "@/components/admin/Users";
import { VisionaryDetail, Visionaries } from "@/components/admin/Visionaries";
import { AdminHostContext, type AdminHost } from "@/lib/admin/api";
import {
  DURATION_LABELS,
  REGISTRATION_CHANNEL_LABELS,
  TIMELINE_LABELS,
  fmtMoney,
  onboardingSourceLabel,
  registrationLabel,
  sourceText,
} from "@/lib/admin/format";

afterEach(() => vi.unstubAllGlobals());

function host(path: string, search = ""): AdminHost & { went: string[] } {
  const went: string[] = [];
  return {
    ready: true, path, search: new URLSearchParams(search), go: (h: string) => { went.push(h); },
    getClerkToken: async () => "t", clerkEmail: null, clerkSignIn: async () => ({ ok: true }),
    clerkVerifyCode: async () => ({ ok: true }), clerkSignOut: async () => undefined, went,
  } as unknown as AdminHost & { went: string[] };
}

/** fetch stub: routes by URL substring; records every URL. */
function serve(routes: [string, unknown, number?][]) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(String(url));
    const hit = routes.find(([part]) => String(url).includes(part));
    if (!hit) return new Response(JSON.stringify({ detail: "not mocked" }), { status: 500 });
    return new Response(JSON.stringify(hit[1]), { status: hit[2] ?? 200 });
  });
  return urls;
}

const withHost = (h: AdminHost, ui: React.ReactNode) => <AdminHostContext.Provider value={h}>{ui}</AdminHostContext.Provider>;

const USER = {
  phone: null, userType: "Manufacturer", isAdmin: false, completeness: 40, recordType: "REAL", manufacturerId: null,
  companyName: null, registeredAt: "2026-10-01T00:00:00Z", lastActivity: null, accountStatus: "active",
  staffOnly: false, adminLogin: null, roles: ["manufacturer"], onboardingStatus: "NO_PROFILE", companies: [],
};

// ------------------------------------------------------------------ helpers
describe("format helpers", () => {
  it("labels every source, unknown and unexpected values", () => {
    expect(onboardingSourceLabel("database_import")).toBe("Database Import");
    expect(onboardingSourceLabel("web_dashboard")).toBe("Web Dashboard");
    expect(onboardingSourceLabel("ai_voice_call")).toBe("AI Voice Call");
    expect(onboardingSourceLabel("ground_sales")).toBe("Ground Sales");
    expect(onboardingSourceLabel("admin_entry")).toBe("Admin Entry");
    expect(onboardingSourceLabel(undefined)).toBe("Unknown");
    expect(onboardingSourceLabel("")).toBe("Unknown");
    expect(onboardingSourceLabel("future_channel")).toBe("future_channel");
  });

  it("registration channel is labelled separately from the sign-in method", () => {
    expect(Object.keys(REGISTRATION_CHANNEL_LABELS).sort()).toEqual(["admin_portal", "legacy_account", "web_signup"]);
    expect(registrationLabel("web_signup", "google")).toBe("Website sign-up · Google");
    expect(registrationLabel("web_signup", "manual")).toBe("Website sign-up · email & password");
    expect(registrationLabel("legacy_account", "legacy_activity")).toBe("Existing account (before sign-up was required)");
    expect(registrationLabel("admin_portal", null)).toBe("Admin portal (staff account)");
    expect(registrationLabel(null, "google")).toBe("Not registered / unknown");
  });

  it("money, timeline and duration codes", () => {
    expect(fmtMoney(200000, "INR")).toBe("₹2,00,000");
    expect(fmtMoney(null)).toBe("—");
    expect(fmtMoney(5, "USD")).toBe("USD 5");
    expect(TIMELINE_LABELS["3_6_months"]).toBe("3–6 months");
    expect(DURATION_LABELS["2_weeks"]).toBe("2 weeks");
  });
});

// ------------------------------------------------------------------ Users
describe("Users list", () => {
  it("each linked company (incl. unnamed and archived) keeps its own source; unknown shows why", async () => {
    serve([["/admin/users", { total: 1, page: 1, pageSize: 25, rows: [{
      ...USER, id: "u1", name: "Two Companies", email: "two@example.com", registrationChannel: "legacy_account",
      registrationMethod: "legacy_terms", companies: [
        { id: "o1", name: null, onboardingSource: "web_dashboard", reviewStatus: "SUBMITTED", membershipRole: "owner", isArchived: false },
        { id: "o2", name: "Old Works", onboardingSource: null, sourceNote: "placeholder created for a user at sign-in",
          reviewStatus: "NOT_STARTED", membershipRole: "member", isArchived: true },
      ] }] }]]);
    const h = host("/admin/users");
    render(withHost(h, <Users />));
    const row = within((await screen.findByText("Two Companies")).closest("tr")!);
    expect(row.getByText("Unnamed company")).toBeInTheDocument();
    expect(row.getByText("Source: Web Dashboard")).toBeInTheDocument();
    expect(row.getByText("Source: Unknown")).toHaveAttribute("title", "placeholder created for a user at sign-in");
    expect(row.getByText("Existing account (before sign-up was required)")).toBeInTheDocument();
    fireEvent.click(row.getByText("Old Works"));
    expect(h.went).toContain("/admin/manufacturers/o2");
  });

  it("details row lists every company's source with the reason, and the registration", async () => {
    serve([["/admin/users", { total: 1, page: 1, pageSize: 25, rows: [{
      ...USER, id: "u1", name: "Details Person", email: "d@example.com", registrationChannel: "web_signup",
      registrationMethod: "manual", companies: [
        { id: "o1", name: "Alpha", onboardingSource: "database_import", reviewStatus: "REVIEWED", membershipRole: "owner", isArchived: false },
        { id: "o2", name: "Beta", onboardingSource: null, sourceNote: "Clerk org", reviewStatus: "NOT_STARTED",
          membershipRole: "member", isArchived: false },
      ] }] }]]);
    render(withHost(host("/admin/users"), <Users />));
    await screen.findByText("Details Person");
    fireEvent.click(screen.getByRole("button", { name: "Show details for Details Person" }));
    expect(screen.getByText("Website sign-up · email & password")).toBeInTheDocument();
    expect(screen.getByText("Alpha: Database Import · Beta: Unknown (Clerk org)")).toBeInTheDocument();
  });

  it("users without a company show Not applicable; errors and empty results are shown", async () => {
    serve([["/admin/users", { total: 1, page: 1, pageSize: 25, rows: [{ ...USER, id: "u2", name: "No Co", email: "n@example.com" }] }]]);
    const { unmount } = render(withHost(host("/admin/users"), <Users />));
    const row = within((await screen.findByText("No Co")).closest("tr")!);
    expect(row.getByText("Not applicable")).toBeInTheDocument();
    expect(row.getByText("Not registered / unknown")).toBeInTheDocument();
    unmount();
    serve([["/admin/users", { total: 0, page: 1, pageSize: 25, rows: [] }]]);
    const second = render(withHost(host("/admin/users"), <Users />));
    expect(await screen.findByText("No users match these filters.")).toBeInTheDocument();
    second.unmount();
    serve([["/admin/users", { detail: "Database unavailable" }, 503]]);
    render(withHost(host("/admin/users"), <Users />));
    expect(await screen.findByText(/Database unavailable/)).toBeInTheDocument();
  });
});

describe("User detail", () => {
  const detail = (manufacturers: unknown[], extra = {}) => ({
    user: { ...USER, id: "u1", name: "Detail Person", email: "dp@example.com", registrationChannel: "web_signup",
            registrationMethod: "google", ...extra },
    manufacturers,
    troubleshooting: { accountStatus: "active", lastLogin: { lastSignInAt: null, available: false }, lastActivity: null,
                       lastSuccessfulSave: null, profileWizardStep: null, onboarding: null, events: [],
                       notificationStatus: "—", emails: [] },
  });

  it("shows how the person registered and each linked company's source next to its approval", async () => {
    serve([["/admin/users/u1", detail([
      { organization_id: "o1", company_name: "Alpha", review_status: "REVIEWED", completeness: 100, record_type: "REAL",
        is_archived: false, membership_role: "owner", membership_status: "active", onboarding_source: "database_import",
        onboarding_source_label: "Database Import", machinery_count: 2 },
      { organization_id: "o2", company_name: "Beta", review_status: "NOT_STARTED", completeness: 10, record_type: "REAL",
        is_archived: false, membership_role: "member", membership_status: "active", onboarding_source: null,
        onboarding_source_label: "Unknown", machinery_count: 0 },
    ])]]);
    render(withHost(host("/admin/users/u1"), <UserDetailView id="u1" />));
    expect(await screen.findByText("Website sign-up · Google")).toBeInTheDocument();
    expect(screen.getByText("Source: Database Import")).toBeInTheDocument();
    expect(screen.getByText("Source: Unknown")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("without a company: Not applicable", async () => {
    serve([["/admin/users/u1", detail([], { registrationChannel: null })]]);
    render(withHost(host("/admin/users/u1"), <UserDetailView id="u1" />));
    expect(await screen.findByText(/Onboarding source: Not applicable/)).toBeInTheDocument();
    expect(screen.getByText("Not registered / unknown")).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ Manufacturers
describe("Manufacturers list", () => {
  const base = detailFixture.manufacturer;
  it("source line per row; details separate onboarding source from the admin entry source", async () => {
    serve([["/admin/manufacturers", { total: 1, page: 1, pageSize: 25, facets: { industries: [], countries: [] },
      rows: [{ ...base, id: "o1", companyName: "Entry Mismatch Co", entrySource: "IMPORTED", onboardingSource: "web_dashboard",
               linkedUsers: 1, request: null }] }]]);
    render(withHost(host("/admin/manufacturers"), <Manufacturers />));
    const row = (await screen.findByText("Entry Mismatch Co")).closest("tr")!;
    expect(within(row).getByText("Source: Web Dashboard")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Show details for Entry Mismatch Co" }));
    expect(screen.getByText("Onboarding source")).toBeInTheDocument();
    expect(screen.getByText("Web Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Record type / entry source (admin)")).toBeInTheDocument();
    expect(screen.getByTitle(/Entry source \(admin classification\)/)).toHaveTextContent("Imported");
  });
});

// ------------------------------------------------------------------ company onboarding panel
describe("Company detail: onboarding source panel", () => {
  const ORG = detailFixture.manufacturer.id as string;
  async function open(onboarding: unknown, manufacturer = {}) {
    serve([[`/admin/manufacturers/${ORG}`, { ...detailFixture, onboarding,
                                             manufacturer: { ...detailFixture.manufacturer, ...manufacturer } }]]);
    render(withHost(host(`/admin/manufacturers/${ORG}`, "tab=onboarding"), <ManufacturerDetail id={ORG} />));
    return (await screen.findByText("Onboarding source & history")).closest("section")!;
  }

  it("import: batch, original source and history with review actions", async () => {
    const section = await open({
      source: "database_import", sourceLabel: "Database Import", note: null, backfill: null,
      importBatch: { id: "b1", reference: "march.csv", importedBy: "job:nightly", importedAt: "2026-03-01T00:00:00Z" },
      history: [
        { id: "e2", event: "decision", label: "Review decision", source: "admin_review", sourceLabel: "Admin review",
          actor: "Priya (admin)", actorRole: "admin", at: "2026-03-03T00:00:00Z", submissionKind: "claim", decision: "changes_requested" },
        { id: "e1", event: "imported", label: "Imported", source: "database_import", sourceLabel: "Database Import",
          actor: "System (import job)", actorRole: "system", at: "2026-03-01T00:00:00Z", submissionKind: null, decision: null },
      ],
    });
    expect(within(section).getByText(/Imported from/)).toHaveTextContent("march.csv by job:nightly");
    expect(within(section).getByText("Review decision — changes requested")).toBeInTheDocument();
    expect(within(section).getByText(/Admin review · Priya \(admin\)/)).toBeInTheDocument();
    expect(screen.getByText(/Batch march.csv/)).toBeInTheDocument();
  });

  it("backfilled value shows rule, evidence and date", async () => {
    const section = await open({
      source: "web_dashboard", sourceLabel: "Web Dashboard", note: null, importBatch: null, history: [],
      backfill: { outcome: "applied", rule: "W2", at: "2026-10-15T00:00:00Z", reason: null,
                  evidence: ["dashboard details form submitted for this company by the user who created it"] },
    });
    expect(within(section).getByText(/rule W2/)).toHaveTextContent("details form submitted");
    expect(screen.getByText(/Set from evidence on .* \(rule W2\)/)).toBeInTheDocument();
    expect(within(section).getByText("No onboarding events recorded for this company.")).toBeInTheDocument();
  });

  it("unknown shows the reason from the backfill", async () => {
    const section = await open({ source: null, sourceLabel: "Unknown", note: "created from a Clerk organization event",
                                 backfill: null, importBatch: null, history: [] });
    expect(within(section).getByText(/Why unknown:/).closest("p")).toHaveTextContent("Clerk organization");
    await waitFor(() => expect(screen.getAllByText("created from a Clerk organization event").length).toBeGreaterThan(0));
  });

  it("not examined yet", async () => {
    await open({ source: null, sourceLabel: "Unknown", note: null, backfill: null, importBatch: null, history: [] },
               { onboardingSource: null, onboardingSourceNote: null });
    expect(screen.getByText("Not examined yet — run the source backfill")).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ Visionaries
const VROW = {
  id: "v1", name: null, accountName: null, email: "anon@example.com", phone: "999", accountStatus: "suspended",
  registeredAt: "2026-10-01T00:00:00Z", lastActivity: null, profileSaved: false, roleTitle: null, organizationName: null,
  location: null, projectCount: 0, requestCount: 0, lastSavedAt: null,
};

describe("Visionaries list", () => {
  it("falls back to the email, shows unsaved profile and suspended account; filters update the URL", async () => {
    const urls = serve([["/admin/visionaries", { total: 30, page: 1, pageSize: 25, rows: [VROW] }]]);
    const h = host("/admin/visionaries");
    render(withHost(h, <Visionaries />));
    const row = within((await screen.findByRole("button", { name: "anon@example.com" })).closest("tr")!);
    expect(row.getByText("Not saved yet")).toBeInTheDocument();
    expect(row.getByText("Suspended")).toBeInTheDocument();
    expect(urls[0]).toContain("page=1");
    fireEvent.change(screen.getByLabelText("Profile"), { target: { value: "missing" } });
    fireEvent.change(screen.getByLabelText("Account status"), { target: { value: "suspended" } });
    await waitFor(() => expect(h.went.some((u) => u.includes("profile=missing"))).toBe(true));
    expect(h.went.some((u) => u.includes("account_status=suspended"))).toBe(true);
  });

  it("expands details and opens the user account from the Actions menu", async () => {
    serve([["/admin/visionaries", { total: 1, page: 1, pageSize: 25, rows: [{ ...VROW, name: "Asha", roleTitle: "Founder" }] }]]);
    const h = host("/admin/visionaries");
    render(withHost(h, <Visionaries />));
    await screen.findByRole("button", { name: "Asha" });
    fireEvent.click(screen.getByRole("button", { name: "Show details for Asha" }));
    expect(screen.getByText("Founder")).toBeInTheDocument();
    expect(screen.getByText("999")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Asha" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open user account" }));
    expect(h.went).toContain("/admin/users/v1");
  });

  it("pagination asks for the next page", async () => {
    serve([["/admin/visionaries", { total: 30, page: 1, pageSize: 25, rows: [VROW] }]]);
    const h = host("/admin/visionaries");
    render(withHost(h, <Visionaries />));
    await screen.findByRole("button", { name: "anon@example.com" });
    const next = screen.getAllByRole("button").find((b) => /next/i.test(b.getAttribute("aria-label") ?? ""))!;
    await act(async () => fireEvent.click(next));
    expect(h.went.some((u) => u.includes("page=2"))).toBe(true);
  });
});

describe("Visionary detail", () => {
  it("no profile, projects or requests: clear empty states", async () => {
    serve([["/admin/visionaries/v1", { visionary: VROW, profile: null, projects: [], requests: [], draftCount: 2 }]]);
    const h = host("/admin/visionaries/v1");
    render(withHost(h, <VisionaryDetail id="v1" />));
    expect(await screen.findByText(/has not saved the “Let’s start with you” profile/)).toBeInTheDocument();
    expect(screen.getByText("No project saved yet.")).toBeInTheDocument();
    expect(screen.getByText("No requests sent yet.")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /User account/ }));
    expect(h.went).toContain("/admin/users/v1");
  });

  it("request statuses and partly filled projects", async () => {
    const req = (id: string, status: string) => ({
      id, number: `REQ-${id}`, status, manufacturerId: "o1", manufacturerName: null, projectId: "p1", projectName: "Cups",
      machine: "Lathe", quantity: null, unit: null, duration: "6_months", location: "Pune", budget: 1000, currency: "INR",
      timeline: "immediately", additionalRequirements: null, createdAt: "2026-10-01T00:00:00Z", respondedAt: null });
    serve([["/admin/visionaries/v1", {
      visionary: { ...VROW, name: "Asha" }, profile: null, draftCount: 0,
      projects: [{ id: "p1", name: "Cups", idea: null, status: "draft", product: null, industry: null, stage: null,
                   location: null, quantity: null, quantityUnit: "units", budget: null, currency: "INR", timeline: null,
                   additionalRequirements: null, requestCount: 0, createdAt: "2026-10-01T00:00:00Z",
                   updatedAt: "2026-10-01T00:00:00Z" }],
      requests: [req("1", "new"), req("2", "accepted"), req("3", "declined"), req("4", "in_review")],
    }]]);
    render(withHost(host("/admin/visionaries/v1"), <VisionaryDetail id="v1" />));
    expect(await screen.findByText("New")).toHaveClass("badge-info");
    expect(screen.getByText("Accepted")).toHaveClass("badge-verified");
    expect(screen.getByText("Declined")).toHaveClass("badge-rejected");
    expect(screen.getByText("In review")).toHaveClass("badge-pending");
    expect(screen.getAllByText("Manufacturer").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/6 months · Immediately/).length).toBe(4);
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("not found and access errors", async () => {
    serve([["/admin/visionaries/v9", { detail: "Visionary not found" }, 404]]);
    render(withHost(host("/admin/visionaries/v9"), <VisionaryDetail id="v9" />));
    expect(await screen.findByText(/Visionary not found/)).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ navigation
describe("Admin navigation", () => {
  const ME = { id: "a1", name: "Admin", email: "a@example.com", roles: ["platform_administrator"], authMethod: "clerk" };

  it("lists Visionaries right after Manufacturers and routes /admin/visionaries/{id} to the detail", async () => {
    serve([["/admin/me", ME], ["/admin/visionaries/v1", { visionary: { ...VROW, name: "Routed" }, profile: null,
                                                          projects: [], requests: [], draftCount: 0 }]]);
    render(withHost(host("/admin/visionaries/v1"), <AdminShell />));
    expect(await screen.findByRole("heading", { name: "Routed" })).toBeInTheDocument();
    const labels = Array.from(document.querySelectorAll(".adm-nav a, .adm-nav button, nav a, nav button"))
      .map((n) => n.textContent?.trim()).filter(Boolean);
    const i = labels.indexOf("Manufacturers");
    expect(i).toBeGreaterThan(-1);
    expect(labels[i + 1]).toBe("Visionaries");
    expect(labels[i + 2]).toBe("Machinery");
  });

  it("non-admins are refused by the API and see no Visionary data", async () => {
    serve([["/admin/me", { detail: "Admin access required" }, 403]]);
    render(withHost(host("/admin/visionaries"), <AdminShell />));
    await waitFor(() => expect(screen.queryByText("Visionaries", { selector: "h1, h2" })).toBeNull());
    expect((await screen.findAllByText(/Admin access required/)).length).toBeGreaterThan(0);
    expect(screen.queryByText("anon@example.com")).toBeNull();
  });
});


// ------------------------------------------------------------------ staged source (new companies awaiting approval)
describe("staged source of a new company not approved yet", () => {
  it("sourceText: stored value first, else the staged one with its status, else Unknown", () => {
    expect(sourceText("admin_entry", { source: "web_dashboard", status: "pending" })).toBe("Admin Entry");
    expect(sourceText(null, { source: "web_dashboard", status: "pending" })).toBe("Web Dashboard (awaiting approval)");
    expect(sourceText(null, { source: "web_dashboard", status: "changes_requested" })).toBe("Web Dashboard (corrections requested)");
    expect(sourceText(null, { source: "web_dashboard", status: "rejected" })).toBe("Web Dashboard (not approved)");
    expect(sourceText(null, null)).toBe("Unknown");
  });

  it("Manufacturers and Users show it; Admin Entry is labelled", async () => {
    const base = detailFixture.manufacturer;
    serve([["/admin/manufacturers", { total: 2, page: 1, pageSize: 25, facets: { industries: [], countries: [] }, rows: [
      { ...base, id: "o1", companyName: "Pending New Co", onboardingSource: null,
        stagedSource: { source: "web_dashboard", status: "pending" }, linkedUsers: 1, request: null },
      { ...base, id: "o2", companyName: "Admin Added Co", onboardingSource: "admin_entry", stagedSource: null,
        linkedUsers: 0, request: null },
    ] }]]);
    const { unmount } = render(withHost(host("/admin/manufacturers"), <Manufacturers />));
    expect(within((await screen.findByText("Pending New Co")).closest("tr")!)
      .getByText("Source: Web Dashboard (awaiting approval)")).toBeInTheDocument();
    expect(within(screen.getByText("Admin Added Co").closest("tr")!).getByText("Source: Admin Entry")).toBeInTheDocument();
    unmount();
    serve([["/admin/users", { total: 1, page: 1, pageSize: 25, rows: [{
      ...USER, id: "u1", name: "Rejected Maker", email: "r@example.com", onboardingStatus: "REJECTED", registrationChannel: "web_signup",
      registrationMethod: "google", companies: [{ id: "o1", name: "Turned Down Co", onboardingSource: null,
        stagedSource: { source: "web_dashboard", status: "rejected" }, reviewStatus: "REJECTED",
        membershipRole: "owner", isArchived: false }] }] }]]);
    render(withHost(host("/admin/users"), <Users />));
    const row = within((await screen.findByText("Rejected Maker")).closest("tr")!);
    expect(row.getByText("Source: Web Dashboard (not approved)")).toBeInTheDocument();
    expect(row.getByText("Rejected")).toBeInTheDocument();   // approval shown separately
    expect(row.getByText("Website sign-up")).toBeInTheDocument();  // registration, not the company source
  });

  it("company page explains that the staged source is copied on approval", async () => {
    const ORG = detailFixture.manufacturer.id as string;
    serve([[`/admin/manufacturers/${ORG}`, { ...detailFixture,
      manufacturer: { ...detailFixture.manufacturer, onboardingSource: null, stagedSource: { source: "web_dashboard", status: "pending" } },
      onboarding: { source: null, sourceLabel: "Unknown", note: null, backfill: null, importBatch: null, history: [],
                    staged: { source: "web_dashboard", status: "pending" } } }]]);
    render(withHost(host(`/admin/manufacturers/${ORG}`, "tab=onboarding"), <ManufacturerDetail id={ORG} />));
    expect(await screen.findByText("Recorded on the submission; copied to the company when approved")).toBeInTheDocument();
    expect(screen.getAllByText(/Web Dashboard \(awaiting approval\)/).length).toBeGreaterThan(0);
  });
});
