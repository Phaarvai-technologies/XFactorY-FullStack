/** Manufacturers tab lists approved / admin-added companies (Listing filter), Mark as demo / real on
 * manufacturers and Visionaries, and the person-level Demo badge in Users. */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminHostContext, type AdminHost } from "@/lib/admin/api";

const toasts = vi.hoisted(() => [] as string[]);
const me = vi.hoisted(() => ({ current: null as null | { id: string; roles: string[] } }));
vi.mock("@/components/admin/AdminShell", () => ({
  useToast: () => (m: string) => toasts.push(m),
  useAdminMe: () => me.current,
}));

import { Manufacturers } from "@/components/admin/Manufacturers";
import { Users } from "@/components/admin/Users";
import { VisionaryDetail, Visionaries } from "@/components/admin/Visionaries";

function host(path: string, search = ""): AdminHost & { went: string[] } {
  const went: string[] = [];
  return {
    ready: true, path, search: new URLSearchParams(search), go: (h: string) => { went.push(h); },
    getClerkToken: async () => "t", clerkEmail: null, clerkSignIn: async () => ({ ok: true }),
    clerkVerifyCode: async () => ({ ok: true }), clerkSignOut: async () => undefined, went,
  } as unknown as AdminHost & { went: string[] };
}

type Call = { url: string; method: string; body: unknown };
function serve(get: (url: string) => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(method === "GET" ? get(String(url)) : {}), { status: 200 });
  });
  return calls;
}
beforeEach(() => { toasts.length = 0; me.current = null; });
afterEach(() => vi.unstubAllGlobals());

const MFG = {
  contactName: null, contactEmail: null, contactPhone: null, industry: "Metal", country: "India", city: "Pune",
  location: "Pune, India", majorProcess: null, listingCount: 0, completeness: 50, requiredDone: 7, requiredTotal: 14,
  entrySource: "MANUFACTURER", referralSource: null, assignedAdminId: null, isArchived: false,
  archivedAt: null, registeredAt: "2026-10-01T00:00:00Z", lastUpdated: "2026-10-01T00:00:00Z", lastSeenAt: null,
  ownerUserId: null, attentionReason: null, missingFields: [], sections: [], stoppedAt: null,
  lastCompletedSection: null, linkedUsers: 0, request: null, reviewStatus: "REVIEWED", onboardingSource: "database_import",
};
const LIST = { total: 2, page: 1, pageSize: 25, facets: { industries: [], countries: [] }, rows: [
  { ...MFG, id: "o1", companyName: "Real Forge", recordType: "REAL" },
  { ...MFG, id: "o2", companyName: "Demo Forge", recordType: "DEMO" },
] };

async function pick(rowName: string, item: string) {
  fireEvent.click(screen.getByRole("button", { name: `Actions for ${rowName}` }));
  await act(async () => fireEvent.click(await screen.findByRole("menuitem", { name: item })));
}

describe("Manufacturers: listing", () => {
  it("default request lists approved / admin-added companies; the subtitle says where pending ones are", async () => {
    const calls = serve(() => LIST);
    render(<AdminHostContext.Provider value={host("/admin/manufacturers")}><Manufacturers /></AdminHostContext.Provider>);
    await screen.findByText("Real Forge");
    expect(calls[0].url).not.toContain("listing=");
    expect(screen.getByText("Approved companies and those added by admins. New submissions wait in Onboarding & review.")).toBeInTheDocument();
  });

  it("Listing filter: awaiting approval / all companies go in the URL and the request; counted as a filter", async () => {
    const calls = serve(() => LIST);
    const h = host("/admin/manufacturers", "listing=awaiting");
    render(<AdminHostContext.Provider value={h}><Manufacturers /></AdminHostContext.Provider>);
    await screen.findByText("Real Forge");
    expect(calls[0].url).toContain("listing=awaiting");
    expect(screen.getByRole("button", { name: /Filters \(1\)/ })).toBeInTheDocument();
    const select = screen.getByLabelText("Listing");             // panel open because a filter is set
    expect(select).toHaveValue("awaiting");
    fireEvent.change(select, { target: { value: "all" } });
    fireEvent.change(select, { target: { value: "listed" } });
    expect(h.went).toEqual(["/admin/manufacturers?listing=all", "/admin/manufacturers"]);
  });
});

describe("Mark as demo / real", () => {
  it("Manufacturers: Actions -> Change Real / Demo… opens the details page (a reason is asked there)", async () => {
    me.current = { id: "a", roles: ["platform_operator"] };
    const calls = serve(() => LIST);
    const h = host("/admin/manufacturers");
    render(<AdminHostContext.Provider value={h}><Manufacturers /></AdminHostContext.Provider>);
    await screen.findByText("Real Forge");
    await pick("Real Forge", "Change Real / Demo…");
    await pick("Demo Forge", "Change Real / Demo…");
    expect(h.went).toEqual(["/admin/manufacturers/o1?tab=onboarding", "/admin/manufacturers/o2?tab=onboarding"]);
    expect(calls.filter((c) => c.method === "PATCH")).toEqual([]);     // nothing changed from the list
  });

  it("Manufacturers: support and verification roles do not get the Real / Demo action", async () => {
    me.current = { id: "a", roles: ["support_specialist"] };
    serve(() => LIST);
    render(<AdminHostContext.Provider value={host("/admin/manufacturers")}><Manufacturers /></AdminHostContext.Provider>);
    await screen.findByText("Real Forge");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Real Forge" }));
    await screen.findByRole("menuitem", { name: "View details" });
    expect(screen.queryByRole("menuitem", { name: "Change Real / Demo…" })).toBeNull();
  });

  const VIS = {
    accountName: "Priya", phone: null, accountStatus: "active", registeredAt: "2026-10-01T00:00:00Z", lastActivity: null,
    profileSaved: true, roleTitle: "Founder", organizationName: "Brew Co", location: "Pune", projectCount: 1,
    requestCount: 0, lastSavedAt: null,
  };
  const VLIST = { total: 2, page: 1, pageSize: 25, dataCounts: { real: 1, demo: 1, all: 2 }, rows: [
    { ...VIS, id: "v1", name: "Priya Real", email: "p@example.com", recordType: "REAL" },
    { ...VIS, id: "v2", name: "Demo Visionary", email: "d@example.com", recordType: "DEMO" },
  ] };

  it("Visionaries: Data filter with counts, Demo badge, Actions -> Mark as demo / real", async () => {
    const calls = serve(() => VLIST);
    const h = host("/admin/visionaries");
    render(<AdminHostContext.Provider value={h}><Visionaries /></AdminHostContext.Provider>);
    await screen.findByText("Priya Real");
    const group = within(screen.getByRole("group", { name: "Data" }));
    expect(group.getByRole("button", { name: /^Demo\s*1$/ })).toBeInTheDocument();
    expect(within(screen.getByText("Demo Visionary").closest("tr")!).getByText("Demo")).toBeInTheDocument();
    expect(within(screen.getByText("Priya Real").closest("tr")!).queryByText("Real")).toBeNull();
    fireEvent.click(group.getByRole("button", { name: /^Demo/ }));
    expect(h.went).toEqual(["/admin/visionaries?data=demo"]);
    await pick("Priya Real", "Mark as demo");
    await pick("Demo Visionary", "Mark as real");
    expect(calls.filter((c) => c.method === "PATCH").map((c) => [c.url.replace(/^.*?\/admin\//, "/"), c.body])).toEqual([
      ["/visionaries/v1/record-type", { record_type: "DEMO" }],
      ["/visionaries/v2/record-type", { record_type: "REAL" }],
    ]);
  });

  it("Visionaries: data=demo in the URL is sent to the backend", async () => {
    const calls = serve(() => ({ ...VLIST, rows: [VLIST.rows[1]] }));
    render(<AdminHostContext.Provider value={host("/admin/visionaries", "data=demo")}><Visionaries /></AdminHostContext.Provider>);
    await screen.findByText("Demo Visionary");
    expect(calls[0].url).toContain("data=demo");
  });

  it("Visionary detail: Mark as demo button and the Data value", async () => {
    const detail = { visionary: VLIST.rows[0], profile: null, projects: [], requests: [], draftCount: 0 };
    const calls = serve(() => detail);
    render(<AdminHostContext.Provider value={host("/admin/visionaries/v1")}><VisionaryDetail id="v1" /></AdminHostContext.Provider>);
    const mark = await screen.findByRole("button", { name: "Mark as demo" });
    await act(async () => fireEvent.click(mark));
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ body: { record_type: "DEMO" } });
    expect(screen.getByText("Data").closest(".detail-item")).toHaveTextContent("Real");
  });
});

describe("Users: the person's own demo mark", () => {
  it("shows a Demo badge next to a person marked demo", async () => {
    const base = { phone: null, userType: "Registered user", isAdmin: false, completeness: null, roles: [],
      registeredAt: "2026-10-01T00:00:00Z", lastActivity: null, accountStatus: "active", staffOnly: false, adminLogin: null,
      onboardingStatus: "NO_PROFILE", manufacturerId: null, companyName: null, recordType: null, companies: [] };
    serve(() => ({ total: 2, page: 1, pageSize: 25, dataCounts: { real: 1, demo: 1, all: 2 }, rows: [
      { ...base, id: "u1", name: "Demo Person", email: "d@example.com", userRecordType: "DEMO" },
      { ...base, id: "u2", name: "Real Person", email: "r@example.com", userRecordType: "REAL" },
    ] }));
    render(<AdminHostContext.Provider value={host("/admin/users")}><Users /></AdminHostContext.Provider>);
    expect(within((await screen.findByText("Demo Person")).closest("tr")!).getByText("Demo")).toBeInTheDocument();
    expect(within(screen.getByText("Real Person").closest("tr")!).queryByText("Demo")).toBeNull();
  });
});
