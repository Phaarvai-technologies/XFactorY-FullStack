/** Admin dashboard layout pass: Actions menu (keyboard), approval labels, Users role filter, Machinery tab. */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Machinery } from "@/components/admin/Machinery";
import { ActionsMenu, ReviewBadge } from "@/components/admin/ui";
import { Users } from "@/components/admin/Users";
import { AdminHostContext, type AdminHost } from "@/lib/admin/api";
import { REVIEW_LABELS } from "@/lib/admin/format";

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

describe("Actions menu", () => {
  it("opens from the keyboard, moves with arrows, runs an item, Escape returns focus", async () => {
    const archive = vi.fn();
    render(
      <div className="adm-root">
        <ActionsMenu context="Acme" items={[
          { label: "View details", onSelect: vi.fn() },
          { label: "Hidden", onSelect: vi.fn(), hidden: true },
          { label: "Archive", onSelect: archive, danger: true, group: true },
        ]} />
      </div>,
    );
    const button = screen.getByRole("button", { name: "Actions for Acme" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    button.focus();
    fireEvent.keyDown(button, { key: "ArrowDown" });
    const menu = await screen.findByRole("menu", { name: "Actions for Acme" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("menuitem", { name: "Hidden" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "View details" })));
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Archive" }));
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));
    expect(archive).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("approval labels", () => {
  it("only the stored approval reads Approved; rejected / correction / submitted keep their labels", () => {
    expect(REVIEW_LABELS).toMatchObject({ REVIEWED: "Approved", REJECTED: "Rejected", NEEDS_CORRECTION: "Needs correction", SUBMITTED: "Submitted" });
    render(<><ReviewBadge status="REVIEWED" /><ReviewBadge status="REJECTED" /></>);
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
  });
});

describe("Users and Machinery tabs", () => {
  it("Users: role filter is sent to the API; roles and onboarding source are shown", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ total: 1, page: 1, pageSize: 25, rows: [{
        id: "u1", name: "Vee Sionary", email: "v@example.com", phone: null, userType: "Other role", roles: ["demand_requester"],
        isAdmin: false, manufacturerId: "o1", companyName: "Acme Works", completeness: 40, recordType: "REAL",
        companies: [{ id: "o1", name: "Acme Works", onboardingSource: "database_import", reviewStatus: "IN_PROGRESS",
          membershipRole: "owner", isArchived: false }], registeredAt: "2026-10-01T00:00:00Z", lastActivity: null, accountStatus: "active",
        onboardingStatus: "IN_PROGRESS", staffOnly: false, adminLogin: null }] }), { status: 200 });
    });
    render(<AdminHostContext.Provider value={host("/admin/users", "role=visionary")}><Users /></AdminHostContext.Provider>);
    await screen.findByText("Vee Sionary");
    expect(urls[0]).toContain("/admin/users?role=visionary");
    expect(screen.getByText("Visionary")).toBeInTheDocument();
    expect(screen.getByText("Source: Database Import")).toBeInTheDocument();
    expect((screen.getByLabelText("Role") as HTMLSelectElement).value).toBe("visionary");
    expect(Array.from((screen.getByLabelText("Role") as HTMLSelectElement).options).map((o) => o.text))
      .toEqual(["All roles", "Manufacturers", "Visionaries"]);
  });

  it("Machinery: real records with company, listing status and availability; company filter chip", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ total: 1, page: 1, pageSize: 25, company: "Acme Works", rows: [{
        id: "m1", name: "Lathe", industry: "Automotive", capacity: "100", maker: null, model: null, year: null,
        listingStatus: "Draft", companyId: "o1", companyName: "Acme Works", recordType: "REAL", imageCount: 0,
        availability: "2 × 2026-11-01 to 2026-11-30", createdAt: "2026-10-01T00:00:00Z" }] }), { status: 200 });
    });
    const h = host("/admin/machinery", "org=o1");
    render(<AdminHostContext.Provider value={h}><Machinery /></AdminHostContext.Provider>);
    await screen.findByText("Lathe");
    expect(urls[0]).toContain("/admin/machinery?org=o1");
    expect(screen.getByText("Draft", { selector: "span.badge" })).toBeInTheDocument();
    expect(screen.getByText("2 × 2026-11-01 to 2026-11-30")).toBeInTheDocument();
    expect(screen.getByText("Acme Works", { selector: "b" })).toBeInTheDocument(); // filter chip
    fireEvent.click(screen.getByRole("button", { name: "Show details for Lathe" }));
    expect(screen.getByText("Capacity")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Actions for Lathe" })));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open company" }));
    expect(h.went).toEqual(["/admin/manufacturers/o1"]);
  });
});
