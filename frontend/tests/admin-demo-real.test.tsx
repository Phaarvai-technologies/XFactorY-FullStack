/** Real vs demo manufacturer data in the admin portal: All / Real / Demo tabs with counts, a Real or
 * Demo badge on every row, and the confirmed, reasoned classification change (administrators and
 * operators only). The detail data is a real backend response (tests/fixtures/admin-detail-update-request.json). */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import detailFixture from "./fixtures/admin-detail-update-request.json";
import { ManufacturerDetail } from "@/components/admin/ManufacturerDetail";
import { Manufacturers } from "@/components/admin/Manufacturers";
import { ReviewQueue } from "@/components/admin/ReviewQueue";
import { AdminHostContext, type AdminHost } from "@/lib/admin/api";

const me = vi.hoisted(() => ({ current: null as null | { id: string; roles: string[] } }));
const toasts = vi.hoisted(() => [] as string[]);
vi.mock("@/components/admin/AdminShell", () => ({
  useToast: () => (m: string) => { toasts.push(m); },
  useAdminMe: () => me.current,
}));

beforeEach(() => { toasts.length = 0; });
afterEach(() => vi.unstubAllGlobals());

function host(path: string, search = ""): AdminHost & { went: string[] } {
  const went: string[] = [];
  return {
    ready: true, path, search: new URLSearchParams(search), go: (h: string) => { went.push(h); },
    getClerkToken: async () => "t", clerkEmail: null, clerkSignIn: async () => ({ ok: true }),
    clerkVerifyCode: async () => ({ ok: true }), clerkSignOut: async () => undefined, went,
  } as unknown as AdminHost & { went: string[] };
}

const ROW = {
  contactName: null, contactEmail: null, contactPhone: null, industry: "Metal", country: "India", city: "Hosur",
  location: "Hosur, India", majorProcess: null, listingCount: 0, completeness: 50, requiredDone: 7, requiredTotal: 14,
  entrySource: "IMPORTED", referralSource: null, assignedAdminId: null, isArchived: false, archivedAt: null,
  registeredAt: "2026-10-01T00:00:00Z", lastUpdated: "2026-10-01T00:00:00Z", lastSeenAt: null, ownerUserId: null,
  attentionReason: null, missingFields: [], sections: [], stoppedAt: null, lastCompletedSection: null, linkedUsers: 0,
  request: null, reviewStatus: "NOT_STARTED", onboardingSource: "database_import",
};

function serveList(counts = { REAL: 12, DEMO: 5, TEST: 1 }) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify({
      total: 2, page: 1, pageSize: 25, facets: { industries: [], countries: [] }, recordTypeCounts: counts,
      rows: [{ ...ROW, id: "r1", companyName: "Real Forge", recordType: "REAL" },
             { ...ROW, id: "d1", companyName: "Demo Forge", recordType: "DEMO" }],
    }), { status: 200 });
  });
  return urls;
}

describe("Manufacturers list: All / Real / Demo", () => {
  it("shows a Real or Demo badge on every row and counts on each tab", async () => {
    me.current = { id: "a", roles: ["support_specialist"] };
    serveList();
    render(<AdminHostContext.Provider value={host("/admin/manufacturers")}><Manufacturers /></AdminHostContext.Provider>);
    expect(within((await screen.findByText("Real Forge")).closest("tr")!).getByText("Real")).toHaveClass("badge-info");
    expect(within(screen.getByText("Demo Forge").closest("tr")!).getByText("Demo")).toHaveClass("badge-purple");
    const tabs = within(screen.getByRole("tablist", { name: /Real or demo/ }));
    expect(tabs.getByRole("tab", { name: "All (18)" })).toHaveAttribute("aria-selected", "true");
    expect(tabs.getByRole("tab", { name: "Real (12)" })).toHaveAttribute("aria-selected", "false");
    expect(tabs.getByRole("tab", { name: "Demo (6)" })).toBeInTheDocument();   // demo + test
  });

  it("tabs set the record type filter (page reset, other filters kept) and the API is asked for that type", async () => {
    serveList();
    const h = host("/admin/manufacturers", "q=forge&page=3");
    render(<AdminHostContext.Provider value={h}><Manufacturers /></AdminHostContext.Provider>);
    await screen.findByText("Real Forge");
    fireEvent.click(screen.getByRole("tab", { name: /^Demo/ }));
    expect(h.went.at(-1)).toBe("/admin/manufacturers?q=forge&record_type=DEMO&record_type=TEST");
    fireEvent.click(screen.getByRole("tab", { name: /^All/ }));
    expect(h.went.at(-1)).toBe("/admin/manufacturers?q=forge");
  });

  it("the selected tab follows the URL and its filter reaches the API", async () => {
    const urls = serveList();
    render(<AdminHostContext.Provider value={host("/admin/manufacturers", "record_type=REAL")}><Manufacturers /></AdminHostContext.Provider>);
    await screen.findByText("Real Forge");
    expect(screen.getByRole("tab", { name: /^Real/ })).toHaveAttribute("aria-selected", "true");
    expect(urls[0]).toContain("record_type=REAL");
    expect(screen.getByRole("button", { name: /^Filters$/ })).toBeInTheDocument();     // a tab is not counted as a filter
  });
});

describe("Manufacturer detail: changing Real / Demo", () => {
  const ORG = detailFixture.manufacturer.id as string;

  function serveDetail(onPatch: (body: Record<string, unknown>) => [unknown, number]) {
    const calls: { method: string; body: Record<string, unknown> | null }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method, body });
      if (method === "PATCH" && String(url).endsWith("/admin-fields")) {
        const [reply, status] = onPatch(body);
        return new Response(JSON.stringify(reply), { status });
      }
      return new Response(JSON.stringify(detailFixture), { status: 200 });
    });
    render(<AdminHostContext.Provider value={host(`/admin/manufacturers/${ORG}`, "tab=onboarding")}>
      <ManufacturerDetail id={ORG} />
    </AdminHostContext.Provider>);
    return calls;
  }

  it("administrators confirm with a required reason; only record_type and the reason are sent", async () => {
    me.current = { id: "a", roles: ["platform_administrator"] };
    const demo = { ...detailFixture, manufacturer: { ...detailFixture.manufacturer, recordType: "DEMO" } };
    const calls = serveDetail(() => [demo, 200]);
    const select = await screen.findByLabelText("Change to");
    fireEvent.change(select, { target: { value: "DEMO" } });
    fireEvent.click(screen.getByRole("button", { name: "Change classification…" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/hidden from Visionaries/)).toBeInTheDocument();
    const confirm = dialog.getByRole("button", { name: "Mark as Demo" });
    expect(confirm).toBeDisabled();                                       // reason required
    fireEvent.change(dialog.getByLabelText(/Reason/), { target: { value: "Sample data for sales demos" } });
    await act(async () => fireEvent.click(confirm));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const patch = calls.filter((c) => c.method === "PATCH");
    expect(patch.map((c) => c.body)).toEqual([{ record_type: "DEMO", reason: "Sample data for sales demos" }]);
    expect(toasts).toContain("Marked as Demo data");
  });

  it("a refusal from the backend is shown and nothing else is sent", async () => {
    me.current = { id: "a", roles: ["platform_operator"] };
    serveDetail(() => [{ detail: "Only administrators and operators can change whether a company is real or demo data." }, 403]);
    fireEvent.change(await screen.findByLabelText("Change to"), { target: { value: "DEMO" } });
    fireEvent.click(screen.getByRole("button", { name: "Change classification…" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText(/Reason/), { target: { value: "x" } });
    await act(async () => fireEvent.click(dialog.getByRole("button", { name: "Mark as Demo" })));
    expect(await screen.findByText(/Only administrators and operators/)).toBeInTheDocument();
  });

  it("support and verification roles see the classification but cannot change it", async () => {
    me.current = { id: "a", roles: ["verification_analyst"] };
    serveDetail(() => [{}, 500]);
    expect(await screen.findByText(/Only administrators and operators can change/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Change to")).toBeNull();
    expect(screen.queryByRole("button", { name: "Change classification…" })).toBeNull();
  });
});

describe("Manufacturer detail: actions follow the admin's role", () => {
  const ORG = detailFixture.manufacturer.id as string;
  function serve() {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(detailFixture), { status: 200 }));
    render(<AdminHostContext.Provider value={host(`/admin/manufacturers/${ORG}`, "tab=onboarding")}>
      <ManufacturerDetail id={ORG} />
    </AdminHostContext.Provider>);
  }

  it("support specialists cannot decide applications or archive", async () => {
    me.current = { id: "a", roles: ["support_specialist"] };
    serve();
    expect(await screen.findByText(/Only administrators, operators and verification analysts can approve/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save status" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /^Actions/ })[0]);
    expect(await screen.findByRole("menuitem", { name: "View machinery" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Archive" })).toBeNull();
  });

  it("verification analysts decide applications but do not archive", async () => {
    me.current = { id: "a", roles: ["verification_analyst"] };
    serve();
    expect(await screen.findByRole("button", { name: "Save status" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /^Actions/ })[0]);
    await screen.findByRole("menuitem", { name: "View machinery" });
    expect(screen.queryByRole("menuitem", { name: "Archive" })).toBeNull();
  });

  it("operators can archive", async () => {
    me.current = { id: "a", roles: ["platform_operator"] };
    serve();
    await screen.findByRole("button", { name: "Save status" });
    fireEvent.click(screen.getAllByRole("button", { name: /^Actions/ })[0]);
    expect(await screen.findByRole("menuitem", { name: /^(Archive|Restore)$/ })).toBeInTheDocument();
  });
});

describe("Onboarding & review: Real / Demo / Real + demo", () => {
  function serveQueue() {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({
        admins: [],
        rows: [{ ...ROW, id: "d1", companyName: "Demo Forge", recordType: "DEMO" }],
      }), { status: 200 });
    });
    return urls;
  }

  it("defaults to real data, asks the API for demo data when chosen, and shows the Demo badge", async () => {
    me.current = { id: "a", roles: ["support_specialist"] };
    const urls = serveQueue();
    const h = host("/admin/review");
    render(<AdminHostContext.Provider value={h}><ReviewQueue /></AdminHostContext.Provider>);
    await screen.findByText("Demo Forge");
    const select = screen.getByRole("combobox", { name: "Real or demo data" });
    expect(select).toHaveValue("real");
    expect(urls.at(-1)).not.toContain("data=");
    fireEvent.change(select, { target: { value: "demo" } });
    expect(h.went.at(-1)).toBe("/admin/review?data=demo");
    expect(within(screen.getByText("Demo Forge").closest("tr")!).getByText("Demo")).toHaveClass("badge-purple");
  });

  it("follows the URL (including the older include_test=1 link) when loading the queue", async () => {
    const urls = serveQueue();
    const { unmount } = render(
      <AdminHostContext.Provider value={host("/admin/review", "data=demo")}><ReviewQueue /></AdminHostContext.Provider>);
    await screen.findByText("Demo Forge");
    expect(screen.getByRole("combobox", { name: "Real or demo data" })).toHaveValue("demo");
    expect(urls.at(-1)).toContain("data=demo");
    unmount();
    render(<AdminHostContext.Provider value={host("/admin/review", "include_test=1")}><ReviewQueue /></AdminHostContext.Provider>);
    await screen.findByText("Demo Forge");
    expect(screen.getByRole("combobox", { name: "Real or demo data" })).toHaveValue("all");
    expect(urls.at(-1)).toContain("data=all");
  });
});
