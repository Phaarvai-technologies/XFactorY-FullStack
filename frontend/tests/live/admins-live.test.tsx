// Live check: the real admin portal screens (jsdom) -> real backend on :8000 -> Postgres.
// Signs in with the built-in admin@phaarvai.com admin account (no Clerk involved).
// Needs a running backend on :8000 with a TEST database (it adds an admin) and
// ADMIN_TEST_PASSWORD set to the built-in admin's password on that test database.
// Run: npm run test:live (skipped when ADMIN_TEST_PASSWORD is not set).
import { describe, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminHostContext, type AdminHost } from "@/lib/admin/api";
import { clearAdminSession, saveAdminSession } from "@/lib/admin/session";

function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }
const opts = { timeout: 8000 };
const API = process.env.ADMIN_TEST_API ?? "http://localhost:8000/api/v1";
const ROOT_PASSWORD = process.env.ADMIN_TEST_PASSWORD ?? "";

async function signIn(email: string, password: string) {
  const r = await fetch(`${API}/admin/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error(`login ${email}: ${r.status} ${await r.text()}`);
  const body = await r.json();
  saveAdminSession({ token: body.token, expiresAt: body.expiresAt });
}

function host(path: string): AdminHost {
  return {
    ready: true, path, search: new URLSearchParams(), go: () => undefined,
    getClerkToken: async () => null, clerkEmail: null,
    clerkSignIn: async () => ({ ok: false, message: "n/a" }), clerkVerifyCode: async () => ({ ok: false, message: "n/a" }),
    clerkResendCode: async () => undefined, clerkSignOut: async () => undefined,
  };
}
const show = (path: string) => render(<AdminHostContext.Provider value={host(path)}><AdminShell /></AdminHostContext.Provider>);
const click = (el: Element) => act(async () => { fireEvent.click(el); });
const table = () => within(document.querySelector(".adm-table") as HTMLElement);
const rowOf = async (email: string) => { await screen.findByRole("table", {}, opts); return (await table().findByText(email, {}, opts)).closest("tr")!; };
const newEmail = `ops-${Date.now()}@example.com`;
let temporary = "";

describe.skipIf(!process.env.ADMIN_TEST_PASSWORD)("Admins tab (live backend)", () => {
  it("Admins tab lists the built-in admin; Add admin shows a temporary password once", async () => {
    clearAdminSession();
    await signIn("admin@phaarvai.com", ROOT_PASSWORD);
    show("/admin/admins");
    await screen.findByRole("heading", { name: "Admins" }, opts);
    const row = await rowOf("admin@phaarvai.com");
    assert(within(row).getByText("Built-in") && within(row).getByText("You"), "built-in admin not marked");
    assert(!within(row).queryByText("Revoke"), "built-in admin can be revoked from the list");
    await click(screen.getByRole("button", { name: /Add admin/ }));
    fireEvent.change(document.getElementById("adm-new-email")!, { target: { value: newEmail } });
    fireEvent.change(document.getElementById("adm-new-name")!, { target: { value: "Ops Person" } });
    fireEvent.change(document.getElementById("adm-new-role")!, { target: { value: "platform_operator" } });
    await click(screen.getAllByRole("button", { name: "Add admin" }).at(-1)!);
    await screen.findByRole("heading", { name: "Admin added" }, opts);
    temporary = document.querySelector(".adm-temp-password code")!.textContent ?? "";
    assert(temporary.length === 16, `temporary password: ${temporary}`);
    await click(screen.getByRole("button", { name: "Done" }));
    const opsRow = await rowOf(newEmail);
    assert(within(opsRow).getByText("Temporary password"), "status not shown");
  });

  it("Admins are not in Users", async () => {
    show("/admin/users");
    await screen.findByRole("heading", { name: "Users" }, opts);
    await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    const t = document.querySelector(".adm-table") as HTMLElement | null;
    const text = t?.textContent ?? "";
    assert(t, "users table not rendered");
    assert(!text.includes("admin@phaarvai.com") && !text.includes(newEmail), "an admin is listed in Users");
  });

  it("New admin must choose a password first, then the portal opens", async () => {
    clearAdminSession();
    await signIn(newEmail, temporary);
    show("/admin");
    await screen.findByRole("heading", { name: "Choose your password" }, opts);
    assert(!document.querySelector(".adm-modal-close"), "required modal can be closed");
    fireEvent.change(document.getElementById("cp-current")!, { target: { value: temporary } });
    fireEvent.change(document.getElementById("cp-new")!, { target: { value: "Green-Press-2027-y" } });
    fireEvent.change(document.getElementById("cp-repeat")!, { target: { value: "Green-Press-2027-y" } });
    await click(screen.getByRole("button", { name: "Save and continue" }));
    await screen.findByText("Password changed. Welcome to the admin portal.", {}, opts);
    assert(!screen.queryByRole("heading", { name: "Choose your password" }), "modal still open");
  });

  it("Administrator revokes and restores the new admin from the list", async () => {
    clearAdminSession();
    await signIn("admin@phaarvai.com", ROOT_PASSWORD);
    show("/admin/admins");
    let row = await rowOf(newEmail);
    await click(within(row).getByRole("button", { name: /Revoke/ }));
    await click(screen.getByRole("button", { name: "Revoke access" }));
    await screen.findByText(/Admin access revoked for/, {}, opts);
    row = await rowOf(newEmail);
    await within(row).findByText("Revoked", {}, opts);
    const blocked = await fetch(`${API}/admin/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: newEmail, password: "Green-Press-2027-y" }) });
    assert(blocked.status === 403, `revoked admin could sign in: ${blocked.status}`);
    row = await rowOf(newEmail);
    await click(within(row).getByRole("button", { name: /Restore/ }));
    await click(screen.getByRole("button", { name: "Restore access" }));
    await screen.findByText(/Admin access restored for/, {}, opts);
    const ok = await fetch(`${API}/admin/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: newEmail, password: "Green-Press-2027-y" }) });
    assert(ok.status === 200, `restored admin cannot sign in: ${ok.status}`);
  });

});
