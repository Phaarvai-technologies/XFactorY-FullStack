/** Admin: each linked company's onboarding source under Users (approval kept separate) and the
 * Visionaries listing / detail (search, pagination, empty and error states). */
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Users } from "@/components/admin/Users";
import { VisionaryDetail, Visionaries } from "@/components/admin/Visionaries";
import { AdminHostContext, type AdminHost } from "@/lib/admin/api";
import { ONBOARDING_SOURCE_LABELS, onboardingSourceLabel } from "@/lib/admin/format";

vi.mock("@/components/admin/AdminShell", () => ({ useToast: () => () => undefined, useAdminMe: () => null }));
afterEach(() => vi.unstubAllGlobals());

function host(path: string, search = ""): AdminHost & { went: string[] } {
  const went: string[] = [];
  return {
    ready: true, path, search: new URLSearchParams(search), go: (h: string) => { went.push(h); },
    getClerkToken: async () => "t", clerkEmail: null, clerkSignIn: async () => ({ ok: true }),
    clerkVerifyCode: async () => ({ ok: true }), clerkSignOut: async () => undefined, went,
  } as unknown as AdminHost & { went: string[] };
}

function serve(body: unknown, status = 200) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify(body), { status });
  });
  return urls;
}

const USER = {
  phone: null, userType: "Manufacturer", isAdmin: false, completeness: 40, recordType: "REAL",
  registeredAt: "2026-10-01T00:00:00Z", lastActivity: null, accountStatus: "active", staffOnly: false, adminLogin: null,
};

describe("onboarding source labels", () => {
  it("uses the five readable labels, Unknown for missing evidence", () => {
    expect(Object.values(ONBOARDING_SOURCE_LABELS).sort()).toEqual(
      ["AI Voice Call", "Admin Entry", "Database Import", "Ground Sales", "Web Dashboard"]);
    expect(onboardingSourceLabel(null)).toBe("Unknown");
    expect(onboardingSourceLabel("web_dashboard")).toBe("Web Dashboard");
  });
});

describe("Users tab", () => {
  it("shows each linked company's own source, Unknown / Not applicable, and approval separately", async () => {
    serve({ total: 2, page: 1, pageSize: 25, rows: [
      { ...USER, id: "u1", name: "Multi Owner", email: "m@example.com", roles: ["manufacturer"], manufacturerId: "o1",
        companyName: "Own Works", onboardingStatus: "REVIEWED", companies: [
          { id: "o1", name: "Own Works", onboardingSource: "web_dashboard", reviewStatus: "REVIEWED", membershipRole: "owner", isArchived: false },
          { id: "o2", name: "Imported Forge", onboardingSource: "database_import", reviewStatus: "NOT_STARTED", membershipRole: "member", isArchived: false },
          { id: "o3", name: "Old Records Ltd", onboardingSource: null, reviewStatus: "NOT_STARTED", membershipRole: "member", isArchived: false },
        ] },
      { ...USER, id: "u2", name: "Vee Sionary", email: "v@example.com", roles: ["demand_requester"], manufacturerId: null,
        companyName: null, completeness: null, onboardingStatus: "NO_PROFILE", companies: [] },
    ] });
    render(<AdminHostContext.Provider value={host("/admin/users")}><Users /></AdminHostContext.Provider>);
    const multi = (await screen.findByText("Multi Owner")).closest("tr")!;
    const cell = within(multi);
    expect(cell.getByText("Own Works")).toBeInTheDocument();
    expect(cell.getByText("Source: Web Dashboard")).toBeInTheDocument();
    expect(cell.getByText("Source: Database Import")).toBeInTheDocument();
    expect(cell.getByText("Source: Unknown")).toBeInTheDocument();
    // approval is its own badge, never shown as a source
    expect(cell.getByText("Approved")).toBeInTheDocument();
    expect(cell.queryByText(/Source: Approved/)).toBeNull();
    const vis = within((await screen.findByText("Vee Sionary")).closest("tr")!);
    expect(vis.getByText("Not applicable")).toBeInTheDocument();
  });
});

const VIS_ROW = {
  id: "v1", name: "Priya Raman", accountName: "Priya R", email: "priya@example.com", phone: null, accountStatus: "active",
  registeredAt: "2026-10-01T00:00:00Z", lastActivity: null, profileSaved: true, roleTitle: "Founder",
  organizationName: "Brew Co", location: "Chennai", projectCount: 1, requestCount: 2, lastSavedAt: null,
};

describe("Visionaries tab", () => {
  it("lists Visionaries with search + pagination parameters and opens the detail", async () => {
    const urls = serve({ total: 1, page: 1, pageSize: 25, rows: [VIS_ROW] });
    const h = host("/admin/visionaries", "q=brew&profile=saved");
    render(<AdminHostContext.Provider value={h}><Visionaries /></AdminHostContext.Provider>);
    const link = await screen.findByRole("button", { name: "Priya Raman" });
    expect(urls[0]).toContain("/admin/visionaries?");
    expect(urls[0]).toContain("q=brew");
    expect(urls[0]).toContain("profile=saved");
    expect(urls[0]).toContain("page=1");
    const row = within(link.closest("tr")!);
    expect(row.getByText("Brew Co")).toBeInTheDocument();
    expect(row.getByText("Saved")).toBeInTheDocument();
    expect(row.getByText("2")).toBeInTheDocument();
    link.click();
    expect(h.went).toContain("/admin/visionaries/v1");
  });

  it("shows the empty state and API errors with a retry", async () => {
    serve({ total: 0, page: 1, pageSize: 25, rows: [] });
    const { unmount } = render(<AdminHostContext.Provider value={host("/admin/visionaries")}><Visionaries /></AdminHostContext.Provider>);
    expect(await screen.findByText("No Visionaries match these filters.")).toBeInTheDocument();
    unmount();
    serve({ detail: "Admin access required" }, 403);
    render(<AdminHostContext.Provider value={host("/admin/visionaries")}><Visionaries /></AdminHostContext.Provider>);
    expect(await screen.findByText(/Admin access required/)).toBeInTheDocument();
  });

  it("detail shows the saved profile, projects and requests from the API", async () => {
    serve({
      visionary: VIS_ROW,
      profile: { fullName: "Priya Raman", roleTitle: "Founder", organizationName: "Brew Co", location: "Chennai",
                 introduction: "Cups for cafés.", createdAt: null, updatedAt: "2026-10-02T00:00:00Z" },
      projects: [{ id: "p1", name: "Coffee Cups", idea: "Branded cups", status: "active", product: "Paper cups",
                   industry: "Food & Beverage", stage: "Prototype Stage", location: "Chennai", quantity: 1000,
                   quantityUnit: "units", budget: 200000, currency: "INR", timeline: "1_3_months",
                   additionalRequirements: "Food-grade ink", requestCount: 1, createdAt: "2026-10-02T00:00:00Z",
                   updatedAt: "2026-10-02T00:00:00Z" }],
      requests: [{ id: "r1", number: "REQ-1", status: "new", manufacturerId: "o9", manufacturerName: "Kaveri Works",
                   projectId: "p1", projectName: "Coffee Cups", machine: "Die Casting", quantity: 1000, unit: "units",
                   duration: "1_month", location: "Chennai", budget: 200000, currency: "INR", timeline: "1_3_months",
                   additionalRequirements: null, createdAt: "2026-10-03T00:00:00Z", respondedAt: null }],
      draftCount: 0,
    });
    const h = host("/admin/visionaries/v1");
    render(<AdminHostContext.Provider value={h}><VisionaryDetail id="v1" /></AdminHostContext.Provider>);
    expect(await screen.findByText("Cups for cafés.")).toBeInTheDocument();
    expect(screen.getByText("Paper cups")).toBeInTheDocument();
    expect(screen.getByText("Food-grade ink")).toBeInTheDocument();
    expect(screen.getAllByText("1–3 months").length).toBeGreaterThan(0);
    expect(screen.getByText("Die Casting")).toBeInTheDocument();
    screen.getByRole("button", { name: /Kaveri Works/ }).click();
    expect(h.went).toContain("/admin/manufacturers/o9");
  });
});

describe("source and registration display (backfill round)", () => {
  const MFG = {
    contactName: null, contactEmail: null, contactPhone: null, industry: "Metal", country: "India", city: "Pune",
    location: "Pune, India", majorProcess: null, listingCount: 0, completeness: 50, requiredDone: 7, requiredTotal: 14,
    recordType: "REAL", entrySource: "MANUFACTURER", referralSource: null, assignedAdminId: null, isArchived: false,
    archivedAt: null, registeredAt: "2026-10-01T00:00:00Z", lastUpdated: "2026-10-01T00:00:00Z", lastSeenAt: null,
    ownerUserId: null, attentionReason: null, missingFields: [], sections: [], stoppedAt: null,
    lastCompletedSection: null, linkedUsers: 0, request: null,
  };

  it("Manufacturers: each row shows the stored original source, Unknown with its reason, separate from approval", async () => {
    const { Manufacturers } = await import("@/components/admin/Manufacturers");
    serve({ total: 2, page: 1, pageSize: 25, rows: [
      { ...MFG, id: "o1", companyName: "Imported Forge", reviewStatus: "REVIEWED", onboardingSource: "database_import" },
      { ...MFG, id: "o2", companyName: "Clerk Org Co", reviewStatus: "NOT_STARTED", onboardingSource: null,
        onboardingSourceNote: "created from a Clerk organization event" },
    ], facets: { industries: [], countries: [] } });
    render(<AdminHostContext.Provider value={host("/admin/manufacturers")}><Manufacturers /></AdminHostContext.Provider>);
    const first = within((await screen.findByText("Imported Forge")).closest("tr")!);
    expect(first.getByText("Source: Database Import")).toBeInTheDocument();
    expect(first.getByText("Approved")).toBeInTheDocument();
    const second = within(screen.getByText("Clerk Org Co").closest("tr")!);
    const unknown = second.getByText("Source: Unknown");
    expect(unknown).toHaveAttribute("title", "created from a Clerk organization event");
  });

  it("Users: registration channel is shown separately from the company source", async () => {
    serve({ total: 1, page: 1, pageSize: 25, rows: [
      { ...USER, id: "u1", name: "Claimer", email: "c@example.com", roles: ["manufacturer"], manufacturerId: "o1",
        companyName: "Imported Forge", onboardingStatus: "REVIEWED", registrationChannel: "web_signup",
        registrationMethod: "google", companies: [
          { id: "o1", name: "Imported Forge", onboardingSource: "database_import", reviewStatus: "REVIEWED",
            membershipRole: "owner", isArchived: false }] },
    ] });
    render(<AdminHostContext.Provider value={host("/admin/users")}><Users /></AdminHostContext.Provider>);
    const row = within((await screen.findByText("Claimer")).closest("tr")!);
    expect(row.getByText("Website sign-up")).toHaveAttribute("title", "Website sign-up · Google");
    expect(row.getByText("Source: Database Import")).toBeInTheDocument();
  });
});
