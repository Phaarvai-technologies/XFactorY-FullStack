/** Admin "Data" filter: Real / Demo / Real + demo on Users (server-side, with counts) and on
 * Manufacturers (a shortcut over the Record type filter). */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Manufacturers } from "@/components/admin/Manufacturers";
import { Users } from "@/components/admin/Users";
import { AdminHostContext, type AdminHost } from "@/lib/admin/api";

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

function serve(body: unknown) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return urls;
}

const USER = {
  phone: null, userType: "Manufacturer", isAdmin: false, completeness: 40, roles: [],
  registeredAt: "2026-10-01T00:00:00Z", lastActivity: null, accountStatus: "active", staffOnly: false, adminLogin: null,
  onboardingStatus: "NOT_STARTED",
};
const company = (id: string, name: string, recordType: string) => ({
  id, name, onboardingSource: null, reviewStatus: "NOT_STARTED", recordType, membershipRole: "owner", isArchived: false,
});
const USERS = {
  total: 3, page: 1, pageSize: 25, dataCounts: { real: 2, demo: 1, all: 3 },
  rows: [
    { ...USER, id: "u1", name: "Real Owner", email: "r@example.com", manufacturerId: "o1", companyName: "Real Co",
      recordType: "REAL", companies: [company("o1", "Real Co", "REAL")] },
    { ...USER, id: "u2", name: "Demo Owner", email: "d@example.com", manufacturerId: "o2", companyName: "Demo Co",
      recordType: "DEMO", companies: [company("o2", "Demo Co", "DEMO"), company("o3", "Test Co", "TEST")] },
    { ...USER, id: "u3", name: "No Company", email: "n@example.com", manufacturerId: null, companyName: null,
      recordType: null, completeness: null, onboardingStatus: "NO_PROFILE", companies: [] },
  ],
};

const dataGroup = () => screen.getByRole("group", { name: "Data" });
const pressed = () => within(dataGroup()).getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true")
  .map((b) => b.textContent);

describe("Users: Data filter", () => {
  it("defaults to Real + demo, shows each count, and badges every non-real company", async () => {
    const urls = serve(USERS);
    render(<AdminHostContext.Provider value={host("/admin/users")}><Users /></AdminHostContext.Provider>);
    await screen.findByText("Real Owner");
    expect(urls[0]).not.toContain("data=");                       // all = no parameter (unchanged default)
    const group = within(dataGroup());
    expect(group.getByRole("button", { name: /^Real\s*2$/ })).toHaveAttribute("aria-pressed", "false");
    expect(group.getByRole("button", { name: /^Demo\s*1$/ })).toBeInTheDocument();
    expect(group.getByRole("button", { name: /^Real \+ demo\s*3$/ })).toHaveAttribute("aria-pressed", "true");
    const demoRow = within(screen.getByText("Demo Owner").closest("tr")!);
    expect(demoRow.getByText("Demo")).toBeInTheDocument();
    expect(demoRow.getByText("Test")).toBeInTheDocument();          // second company badged too
    expect(within(screen.getByText("Real Owner").closest("tr")!).queryByText("Real")).toBeNull();
  });

  it("choosing Real / Demo / Real + demo updates the URL; the URL value drives the request", async () => {
    serve(USERS);
    const h = host("/admin/users", "account_status=active&page=3");
    render(<AdminHostContext.Provider value={h}><Users /></AdminHostContext.Provider>);
    await screen.findByText("Real Owner");
    fireEvent.click(within(dataGroup()).getByRole("button", { name: /^Demo/ }));
    fireEvent.click(within(dataGroup()).getByRole("button", { name: /^Real\s*\d+$/ }));
    fireEvent.click(within(dataGroup()).getByRole("button", { name: /^Real \+ demo/ }));
    expect(h.went).toEqual([
      "/admin/users?account_status=active&data=demo",               // other filters kept, back to page 1
      "/admin/users?account_status=active&data=real",
      "/admin/users?account_status=active",
    ]);
  });

  it("data=demo in the URL is sent to the backend and highlighted", async () => {
    const urls = serve({ ...USERS, total: 1, rows: [USERS.rows[1]] });
    render(<AdminHostContext.Provider value={host("/admin/users", "data=demo")}><Users /></AdminHostContext.Provider>);
    await screen.findByText("Demo Owner");
    expect(urls[0]).toContain("data=demo");
    expect(pressed()[0]).toMatch(/^Demo/);
  });

  it("an unknown data value falls back to Real + demo", async () => {
    const urls = serve(USERS);
    render(<AdminHostContext.Provider value={host("/admin/users", "data=bogus")}><Users /></AdminHostContext.Provider>);
    await screen.findByText("Real Owner");
    expect(urls[0]).not.toContain("data=");
    expect(pressed()[0]).toMatch(/^Real \+ demo/);
  });
});

describe("Manufacturers: All / Real / Demo tabs", () => {
  const LIST = { total: 0, page: 1, pageSize: 25, rows: [], facets: { industries: [], countries: [] } };
  const tabs = () => within(screen.getByRole("tablist", { name: "Real or demo data" }));
  const selectedTabs = () => tabs().getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") === "true")
    .map((t) => t.textContent);

  it("maps onto the record type filter: Real -> REAL, Demo -> DEMO + TEST, All -> none", async () => {
    serve(LIST);
    const h = host("/admin/manufacturers");
    render(<AdminHostContext.Provider value={h}><Manufacturers /></AdminHostContext.Provider>);
    await screen.findByRole("tablist", { name: "Real or demo data" });
    expect(selectedTabs()).toEqual(["All"]);
    fireEvent.click(tabs().getByRole("tab", { name: "Real" }));
    fireEvent.click(tabs().getByRole("tab", { name: "Demo" }));
    fireEvent.click(tabs().getByRole("tab", { name: "All" }));
    expect(h.went).toEqual([
      "/admin/manufacturers?record_type=REAL",
      "/admin/manufacturers?record_type=DEMO&record_type=TEST",
      "/admin/manufacturers",
    ]);
  });

  it("reflects the URL record types; a custom combination highlights nothing", async () => {
    const urls = serve(LIST);
    const { unmount } = render(<AdminHostContext.Provider value={host("/admin/manufacturers", "record_type=TEST&record_type=DEMO")}>
      <Manufacturers /></AdminHostContext.Provider>);
    await screen.findByRole("tablist", { name: "Real or demo data" });
    expect(selectedTabs()).toEqual(["Demo"]);
    expect(urls[0]).toContain("record_type=TEST");
    unmount();
    render(<AdminHostContext.Provider value={host("/admin/manufacturers", "record_type=REAL&record_type=TEST")}>
      <Manufacturers /></AdminHostContext.Provider>);
    await screen.findByRole("tablist", { name: "Real or demo data" });
    expect(selectedTabs()).toEqual([]);
    expect(screen.getByText("Custom record type filter applied")).toBeInTheDocument();
  });
});
