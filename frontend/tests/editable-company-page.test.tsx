/**
 * Daily check-in 26 Nov 2026: the company page is editable in place ("make it fully editable and
 * give a Save button below"), and the magic link sits inside Registered Users.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import detailFixture from "./fixtures/admin-detail-pending.json";
import { ManufacturerDetail } from "@/components/admin/ManufacturerDetail";
import { AdminHostContext, type AdminHost } from "@/lib/admin/api";

afterEach(() => vi.unstubAllGlobals());

const ORG = detailFixture.manufacturer.id as string;
function host(): AdminHost {
  return {
    ready: true, path: `/admin/manufacturers/${ORG}`, search: new URLSearchParams(""), go: () => undefined,
    getClerkToken: async () => "t", clerkEmail: null, clerkSignIn: async () => ({ ok: true }),
    clerkVerifyCode: async () => ({ ok: true }), clerkSignOut: async () => undefined,
  } as unknown as AdminHost;
}

const INVITES = { invitations: [], details: { source: null, at: null, by: "", reviewedAt: null, reviewedBy: "" }, canInvite: true };
const PEOPLE = { registeredUsers: [], requests: [], counts: { linkedUsers: 0, openRequests: 0 }, primaryUser: null, otherUsers: [] };

function serve() {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null });
    if (u.endsWith("/fields/batch")) {
      const about = (calls.at(-1)!.body as { changes: { field: string; value: string }[] }).changes[0].value;
      const saved = structuredClone(detailFixture) as typeof detailFixture;
      (saved.profile.profileData.company as Record<string, unknown>).about = about;
      return new Response(JSON.stringify(saved), { status: 200 });
    }
    if (u.includes("/invitations")) return new Response(JSON.stringify(INVITES), { status: 200 });
    if (u.includes("/people")) return new Response(JSON.stringify(PEOPLE), { status: 200 });
    if (u.includes(`/admin/manufacturers/${ORG}`)) return new Response(JSON.stringify(detailFixture), { status: 200 });
    return new Response(JSON.stringify({ detail: "not mocked" }), { status: 500 });
  });
  return calls;
}

describe("Editable company page", () => {
  it("fields are boxes; one Save sends every change together", async () => {
    const calls = serve();
    render(<AdminHostContext.Provider value={host()}><ManufacturerDetail id={ORG} /></AdminHostContext.Provider>);
    const about = await screen.findByLabelText(/About the company/);
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull();

    fireEvent.change(about, { target: { value: "Containers, caps and closures." } });
    fireEvent.change(screen.getByLabelText(/^City/), { target: { value: "Coimbatore" } });
    const bar = within(screen.getByRole("region", { name: "Unsaved changes" }));
    expect(bar.getByText("2 unsaved changes")).toBeInTheDocument();
    fireEvent.change(bar.getByLabelText("Reason (optional)"), { target: { value: "Confirmed on call" } });
    await act(async () => fireEvent.click(bar.getByRole("button", { name: "Save changes" })));

    const save = calls.find((c) => c.url.endsWith("/fields/batch"))!;
    expect(save.method).toBe("PATCH");
    expect(save.body).toEqual({
      changes: [
        { field: "company.about", value: "Containers, caps and closures." },
        { field: "location.city", value: "Coimbatore" },
      ],
      reason: "Confirmed on call",
    });
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull();
  });

  it("typing the old value back removes the change; Discard clears everything", async () => {
    serve();
    render(<AdminHostContext.Provider value={host()}><ManufacturerDetail id={ORG} /></AdminHostContext.Provider>);
    const city = (await screen.findByLabelText(/^City/)) as HTMLInputElement;
    const original = city.value;
    fireEvent.change(city, { target: { value: "Madurai" } });
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
    fireEvent.change(city, { target: { value: original } });
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull();
    fireEvent.change(city, { target: { value: "Madurai" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect((screen.getByLabelText(/^City/) as HTMLInputElement).value).toBe(original);
  });

  it("Invited users (magic link) is inside Registered Users: Send by Email / Send by WhatsApp", async () => {
    serve();
    render(<AdminHostContext.Provider value={host()}><ManufacturerDetail id={ORG} /></AdminHostContext.Provider>);
    await screen.findByText(/Invited users/);
    const users = screen.getByRole("heading", { name: /Registered Users/ }).closest("section")!;
    expect(within(users).getByText(/Invited users/)).toBeInTheDocument();
    expect(within(users).getByRole("button", { name: "Send by Email" })).toBeInTheDocument();
    expect(within(users).getByRole("button", { name: "Send by WhatsApp" })).toBeInTheDocument();
  });
});
