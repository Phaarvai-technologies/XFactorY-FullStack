/** Admin shell: menu order, sidebar footer (only Log out), name button without an icon that opens
 * Edit my details, and Change password reached from there. */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminHostContext, type AdminHost } from "@/lib/admin/api";

afterEach(() => vi.unstubAllGlobals());

function host(): AdminHost {
  return {
    ready: true, path: "/admin/no-such-page", search: new URLSearchParams(), go: () => undefined,
    getClerkToken: async () => "t", clerkEmail: null, clerkSignIn: async () => ({ ok: true }),
    clerkVerifyCode: async () => ({ ok: true }), clerkResendCode: async () => undefined, clerkSignOut: async () => undefined,
  } as AdminHost;
}

const ME = { id: "a1", name: "Phaarvai", email: "admin@phaarvai.com", roles: ["platform_administrator"], authMethod: "password" };
const RECORD = {
  ...ME, role: "platform_administrator", roleLabel: "Administrator", status: "active", hasAdminAccount: true,
  hasXyAccount: false, mustChangePassword: false, locked: false, grantedAt: null, grantedBy: null, revokedAt: null,
  lastSignIn: null, isDefault: true, isYou: true, canEditDetails: true, emailEditable: false,
  firstName: "Phaarvai", lastName: null, phone: null,
};

function serve(me = ME) {
  vi.stubGlobal("fetch", async (url: string) => {
    const u = String(url);
    const body = u.endsWith("/admin/me") ? me : u.includes("/admin/admin-users") ? [{ ...RECORD, authMethod: undefined }] : {};
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

async function renderShell() {
  render(<AdminHostContext.Provider value={host()}><AdminShell /></AdminHostContext.Provider>);
  return screen.findByRole("button", { name: /Edit my details \(Phaarvai\)/ });
}

describe("admin shell layout", () => {
  it("menu: Visionaries right after Manufacturers", async () => {
    serve();
    await renderShell();
    const labels = within(screen.getByRole("navigation")).getAllByRole("link").map((a) => a.textContent?.trim());
    expect(labels).toEqual(["Overview", "Users", "Admins", "Manufacturers", "Visionaries", "Machinery",
      "Onboarding & review", "Analytics", "Support"]);
  });

  it("sidebar footer: name, email and only Log out", async () => {
    serve();
    await renderShell();
    const foot = document.querySelector(".adm-sidebar-foot") as HTMLElement;
    expect(foot).toHaveTextContent("Phaarvai");
    expect(foot).toHaveTextContent("admin@phaarvai.com");
    expect(within(foot).getAllByRole("button").map((b) => b.textContent?.trim())).toEqual(["Log out"]);
  });

  it("name button has no pencil icon and opens Edit my details, which offers Change password", async () => {
    serve();
    const chip = await renderShell();
    expect(chip.querySelectorAll("svg")).toHaveLength(0);
    expect(chip).toHaveTextContent("Phaarvai");
    await act(async () => fireEvent.click(chip));
    const dialog = await screen.findByRole("dialog", { name: "Edit my details" });
    expect(within(dialog).getByLabelText(/First name/)).toHaveValue("Phaarvai");
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Change password" })));
    expect(screen.queryByRole("dialog", { name: "Edit my details" })).toBeNull();
    expect(await screen.findByLabelText(/Current password/i)).toBeInTheDocument();
  });

  it("signed in with an XfactorY account: no Change password (that password is managed in the XfactorY account)", async () => {
    serve({ ...ME, authMethod: "clerk" });
    const chip = await renderShell();
    await act(async () => fireEvent.click(chip));
    const dialog = await screen.findByRole("dialog", { name: "Edit my details" });
    await within(dialog).findByLabelText(/First name/);
    expect(within(dialog).queryByRole("button", { name: "Change password" })).toBeNull();
  });
});
