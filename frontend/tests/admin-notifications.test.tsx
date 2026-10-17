/** Admin header bell: new / corrected manufacturer applications (real response: admin-notifications.json). */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import feed from "./fixtures/admin-notifications.json";
import { AdminNotifications } from "@/components/admin/AdminNotifications";
import { AdminHostContext, type AdminHost } from "@/lib/admin/api";

afterEach(() => vi.unstubAllGlobals());

function host(went: string[]): AdminHost {
  return {
    ready: true, path: "/admin", search: new URLSearchParams(), go: (h: string) => { went.push(h); },
    getClerkToken: async () => "t", clerkEmail: null, clerkSignIn: async () => ({ ok: true }),
    clerkVerifyCode: async () => ({ ok: true }), clerkSignOut: async () => undefined,
  } as unknown as AdminHost;
}

describe("admin notifications", () => {
  it("shows unread applications and opens the company's Onboarding & review tab", async () => {
    const posts: unknown[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      if ((init.method ?? "GET") === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ...feed, unread: 0 }), { status: 200 });
      }
      return new Response(JSON.stringify(feed), { status: 200 });
    });
    const went: string[] = [];
    render(<AdminHostContext.Provider value={host(went)}><AdminNotifications /></AdminHostContext.Provider>);
    const bell = await screen.findByRole("button", { name: `Notifications, ${feed.unread} unread` });
    fireEvent.click(bell);
    const unread = feed.items.find((i) => !i.read)!;
    const item = screen.getByText(unread.body).closest("button")!;
    expect(item).toHaveClass("unread");
    await act(async () => fireEvent.click(item));
    await waitFor(() => expect(posts).toEqual([{ ids: [unread.id] }]));
    expect(went).toEqual([`/admin/manufacturers/${unread.companyId}?tab=onboarding`]);
  });
});
