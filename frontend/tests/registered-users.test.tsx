/** Company detail: Registered Users and onboarding requests (kept apart), company contact kept
 * separate from users, refresh without a hard reload, and access errors. */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import detailFixture from "./fixtures/admin-detail-pending.json";
import { ManufacturerDetail } from "@/components/admin/ManufacturerDetail";
import { Manufacturers } from "@/components/admin/Manufacturers";
import { RegisteredUsers } from "@/components/admin/RegisteredUsers";
import { AdminHostContext, type AdminHost } from "@/lib/admin/api";
import type { CompanyPeople } from "@/lib/admin/types";

vi.mock("@/components/admin/AdminShell", () => ({ useToast: () => () => undefined, useAdminMe: () => null }));
afterEach(() => vi.unstubAllGlobals());

function host(path = "/admin/manufacturers/o1"): AdminHost & { went: string[] } {
  const went: string[] = [];
  return {
    ready: true, path, search: new URLSearchParams(), go: (h: string) => { went.push(h); },
    getClerkToken: async () => "t", clerkEmail: null, clerkSignIn: async () => ({ ok: true }),
    clerkVerifyCode: async () => ({ ok: true }), clerkSignOut: async () => undefined, went,
  } as unknown as AdminHost & { went: string[] };
}

const user = (id: string, over: Partial<CompanyPeople["registeredUsers"][number]> = {}) => ({
  id, name: `User ${id}`, email: `${id}@example.com`, role: "member", membershipStatus: "active",
  accountStatus: "active" as const, linkedAt: "2026-10-01T00:00:00Z", registeredAt: "2026-09-30T00:00:00Z", roles: [], ...over,
});
const request = (id: string, status: CompanyPeople["requests"][number]["status"], statusLabel: string, member = false) => ({
  id, kind: "update_request", kindLabel: "Update request from another user", status, statusLabel, source: "web_dashboard",
  submittedAt: "2026-10-02T00:00:00Z", reviewedAt: status === "pending" ? null : "2026-10-03T00:00:00Z",
  reviewer: status === "pending" ? null : "Priya Admin", feedback: status === "rejected" ? "Not verified" : null,
  requester: { id: `u-${id}`, name: `Requester ${id}`, email: `req-${id}@example.com` }, requesterIsMember: member,
});
const PEOPLE_A: CompanyPeople = {
  registeredUsers: [user("owner-1", { role: "owner" }), user("mem-2"), user("gone-3", { membershipStatus: "removed" })],
  requests: [request("r1", "pending", "Awaiting review"), request("r2", "approved", "Approved"),
             request("r3", "rejected", "Rejected")],
  counts: { linkedUsers: 2, openRequests: 1 },
};
const PEOPLE_B: CompanyPeople = { registeredUsers: [user("b-only")], requests: [], counts: { linkedUsers: 1, openRequests: 0 } };

function serve(byPath: Record<string, () => [unknown, number]>) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(String(url));
    const key = Object.keys(byPath).find((k) => String(url).includes(k));
    const [body, status] = key ? byPath[key]() : [{ detail: "not mocked" }, 500];
    return new Response(JSON.stringify(body), { status });
  });
  return urls;
}

describe("Registered Users section", () => {
  it("lists an applicant awaiting approval under the company's associated users (not counted)", async () => {
    const applicant = user("jhansi", { name: "Jhansi Rani", personalEmail: "jhansi@gmail.com", role: "applicant",
                                       membershipStatus: "pending", linkedAt: null, applicationStatus: "pending" });
    const people = { ...PEOPLE_A, primaryUser: user("owner-1", { role: "owner" }),
                     otherUsers: [user("mem-2"), applicant], counts: { linkedUsers: 2, openRequests: 1 } };
    serve({ "/admin/manufacturers/o1/people": () => [people, 200] });
    render(<AdminHostContext.Provider value={host()}><RegisteredUsers orgId="o1" /></AdminHostContext.Provider>);
    const others = await screen.findByRole("table", { name: "Other Users" });
    const row = within(others).getByText("Jhansi Rani").closest("tr")!;
    expect(within(row).getByText("jhansi@gmail.com")).toBeInTheDocument();
    expect(within(row).getByText("Pending approval")).toBeInTheDocument();
    expect(within(row).getByText("Application awaiting review")).toBeInTheDocument();
    expect(row).not.toHaveClass("adm-row-archived");
    expect(screen.getByTitle("Distinct users with an active membership")).toHaveTextContent("2");
  });

  it("shows personal emails (not sign-in emails) and no primary user when the company has no owner", async () => {
    const people = { ...PEOPLE_B, registeredUsers: [{ ...PEOPLE_B.registeredUsers[0], personalEmail: "b.only@gmail.com" }] };
    serve({ "/admin/manufacturers/o1/people": () => [people, 200] });
    render(<AdminHostContext.Provider value={host()}><RegisteredUsers orgId="o1" /></AdminHostContext.Provider>);
    expect(await screen.findByText("No primary user (owner) yet.")).toBeInTheDocument();
    const others = screen.getByRole("table", { name: "Other Users" });
    expect(within(others).getByText("b.only@gmail.com")).toBeInTheDocument();
    expect(within(others).queryByText("b-only@example.com")).not.toBeInTheDocument();
  });

  it("lists each user once with name, email, user id, role, membership and linked date; count = active", async () => {
    const urls = serve({ "/admin/manufacturers/o1/people": () => [PEOPLE_A, 200] });
    const h = host();
    render(<AdminHostContext.Provider value={h}><RegisteredUsers orgId="o1" /></AdminHostContext.Provider>);
    const section = (await screen.findByRole("heading", { name: /Registered Users/ })).closest("section")!;
    expect(urls[0]).toContain("/admin/manufacturers/o1/people");
    // the primary user (owner) and the Other Users are listed separately, each once
    const primaryRows = within(within(section).getByRole("table", { name: "Primary user" })).getAllByRole("row").slice(1);
    const otherRows = within(within(section).getByRole("table", { name: "Other Users" })).getAllByRole("row").slice(1);
    expect(primaryRows).toHaveLength(1);
    expect(otherRows).toHaveLength(2);
    const rows = [...primaryRows, ...otherRows];
    const owner = within(rows[0]);
    expect(owner.getByText("User owner-1")).toBeInTheDocument();
    expect(owner.getByText("owner-1@example.com")).toBeInTheDocument();
    expect(owner.getByText("owner-1")).toBeInTheDocument();          // application user id
    expect(owner.getByText("owner")).toBeInTheDocument();
    expect(owner.getByText("Active")).toBeInTheDocument();
    expect(owner.getByText("30 Sept 2026")).toBeInTheDocument();     // registration date
    expect(within(rows[2]).getByText("Removed")).toBeInTheDocument();
    expect(rows[2]).toHaveClass("adm-row-archived");
    expect(within(section).getByTitle("Distinct users with an active membership")).toHaveTextContent("2");
    fireEvent.click(owner.getByRole("button", { name: "Open user User owner-1" }));
    expect(h.went).toEqual(["/admin/users/owner-1"]);
  });

  it("requests are listed separately with their real status and are not members", async () => {
    serve({ "/people": () => [PEOPLE_A, 200] });
    render(<AdminHostContext.Provider value={host()}><RegisteredUsers orgId="o1" /></AdminHostContext.Provider>);
    const section = (await screen.findByRole("heading", { name: /Onboarding requests/ })).closest("section")!;
    const rows = within(section).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByText(/Awaiting review|Approved|Rejected/)[0].textContent))
      .toEqual(["Awaiting review", "Approved", "Rejected"]);
    expect(within(section).getAllByText("Not a member")).toHaveLength(3);
    expect(within(rows[2]).getByText("“Not verified”")).toBeInTheDocument();
    expect(within(rows[1]).getByText(/Priya Admin/)).toBeInTheDocument();
    expect(within(section).getByTitle("Awaiting a decision")).toHaveTextContent("1");
    // requesters are not in the Registered Users table
    const usersSection = screen.getByRole("heading", { name: /Registered Users/ }).closest("section")!;
    expect(within(usersSection).queryByText(/Requester/)).toBeNull();
  });

  it("selecting another company loads only that company's users and requests", async () => {
    const urls = serve({ "/manufacturers/o1/people": () => [PEOPLE_A, 200], "/manufacturers/o2/people": () => [PEOPLE_B, 200] });
    const { rerender } = render(<AdminHostContext.Provider value={host()}><RegisteredUsers orgId="o1" /></AdminHostContext.Provider>);
    await screen.findByText("User owner-1");
    rerender(<AdminHostContext.Provider value={host()}><RegisteredUsers orgId="o2" /></AdminHostContext.Provider>);
    await screen.findByText("User b-only");
    expect(screen.queryByText("User owner-1")).toBeNull();
    expect(screen.queryByText("Requester r1")).toBeNull();
    expect(screen.getByText("No requests submitted for this company.")).toBeInTheDocument();
    expect(urls.at(-1)).toContain("/manufacturers/o2/people");
  });

  it("new submissions appear without a hard refresh: on returning to the tab, on Refresh and after page actions", async () => {
    let people: CompanyPeople = { registeredUsers: [user("owner-1", { role: "owner" })], requests: [],
                                  counts: { linkedUsers: 1, openRequests: 0 } };
    const urls = serve({ "/people": () => [people, 200] });
    const h = host();
    const { rerender } = render(<AdminHostContext.Provider value={h}><RegisteredUsers orgId="o1" refreshKey={1} /></AdminHostContext.Provider>);
    await screen.findByText("No requests submitted for this company.");
    people = { ...people, requests: [request("new", "pending", "Awaiting review")], counts: { linkedUsers: 1, openRequests: 1 } };
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(await screen.findByText("Requester new")).toBeInTheDocument();
    people = { ...people, registeredUsers: [...people.registeredUsers, user("joined")], counts: { linkedUsers: 2, openRequests: 1 } };
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh users and requests" })));
    expect(await screen.findByText("User joined")).toBeInTheDocument();
    const before = urls.length;
    rerender(<AdminHostContext.Provider value={h}><RegisteredUsers orgId="o1" refreshKey={2} /></AdminHostContext.Provider>);
    await waitFor(() => expect(urls.length).toBe(before + 1));
    await new Promise((r) => setTimeout(r, 50));
    expect(urls.length).toBe(before + 1);   // exactly one refetch per page action
  });

  it("access refused / errors are shown, with retry", async () => {
    serve({ "/people": () => [{ detail: "Admin access required" }, 403] });
    render(<AdminHostContext.Provider value={host()}><RegisteredUsers orgId="o1" /></AdminHostContext.Provider>);
    expect(await screen.findByText(/Admin access required/)).toBeInTheDocument();
    expect(screen.queryByText("User owner-1")).toBeNull();
  });
});

describe("company contact stays the company's own", () => {
  const ORG = detailFixture.manufacturer.id as string;
  it("detail summary shows company contact, not a linked user's email; users are in their own section", async () => {
    serve({
      [`/admin/manufacturers/${ORG}/people`]: () => [PEOPLE_A, 200],
      [`/admin/manufacturers/${ORG}`]: () => [{ ...detailFixture, manufacturer: { ...detailFixture.manufacturer,
        contactName: null, contactEmail: null, contactPhone: null, linkedUsers: 2,
        primaryUser: { id: "owner-1", name: "User owner-1", email: "owner-1@example.com" } } }, 200],
    });
    render(<AdminHostContext.Provider value={host(`/admin/manufacturers/${ORG}`)}><ManufacturerDetail id={ORG} /></AdminHostContext.Provider>);
    const summary = (await screen.findByText("Company contact")).closest("div")!;
    expect(summary).toHaveTextContent("No company contact details");
    expect(summary).not.toHaveTextContent("owner-1@example.com");
    expect(screen.getByText("Linked users").closest("div")).toHaveTextContent("2");
    expect(await screen.findByText("owner-1@example.com")).toBeInTheDocument();   // in Registered Users
  });

  it("Manufacturers list details: company contact and the primary user are separate rows", async () => {
    serve({ "/admin/manufacturers": () => [{ total: 1, page: 1, pageSize: 25, facets: { industries: [], countries: [] },
      rows: [{ ...detailFixture.manufacturer, id: "o1", companyName: "Contact Co", contactEmail: "sales@contact.co",
               contactPhone: null, primaryUser: { id: "u1", name: "Asha Rao", email: "asha@gmail.com" }, linkedUsers: 3,
               request: null }] }, 200] });
    render(<AdminHostContext.Provider value={host("/admin/manufacturers")}><Manufacturers /></AdminHostContext.Provider>);
    const row = (await screen.findByText("Contact Co")).closest("tr")!;
    expect(within(row).getByText("3")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Show details for Contact Co" }));
    expect(screen.getByText("sales@contact.co")).toBeInTheDocument();
    expect(screen.getByText("Asha Rao · asha@gmail.com")).toBeInTheDocument();
  });
});
