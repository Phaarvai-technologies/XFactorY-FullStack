/** Admins tab -> Edit details, and "Edit my details" from the header. */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminHostContext, type AdminHost } from "@/lib/admin/api";
import type { AdminMe, AdminUser } from "@/lib/admin/types";

const shell = vi.hoisted(() => ({
  me: null as AdminMe | null,
  toasts: [] as string[],
  reloadMe: vi.fn(),
}));
vi.mock("@/components/admin/AdminShell", () => ({
  useToast: () => (m: string) => shell.toasts.push(m),
  useAdminMe: () => shell.me,
  useReloadAdminMe: () => shell.reloadMe,
}));

import { Admins } from "@/components/admin/Admins";
import { EditMyDetailsModal, savedMessage } from "@/components/admin/EditAdminDetails";

function host(): AdminHost {
  return {
    ready: true, path: "/admin/admins", search: new URLSearchParams(), go: () => undefined,
    getClerkToken: async () => "t", clerkEmail: null, clerkSignIn: async () => ({ ok: true }),
    clerkVerifyCode: async () => ({ ok: true }), clerkResendCode: async () => undefined, clerkSignOut: async () => undefined,
  } as AdminHost;
}

const base: Omit<AdminUser, "id" | "email" | "name"> = {
  role: "platform_administrator", roleLabel: "Administrator", status: "active", hasAdminAccount: true,
  hasXyAccount: false, mustChangePassword: false, locked: false, grantedAt: "2026-09-29T00:00:00Z", grantedBy: null,
  revokedAt: null, lastSignIn: null, isDefault: false, isYou: false, canEditDetails: true, emailEditable: true,
  firstName: null, lastName: null, phone: null,
};
const BUILT_IN: AdminUser = { ...base, id: "a1", name: "Vignesh phaarvai", email: "admin@phaarvai.com", isDefault: true,
  isYou: true, hasXyAccount: true, emailEditable: false, firstName: "Vignesh", lastName: "phaarvai" };
const OPS: AdminUser = { ...base, id: "a2", name: "Ops Person", email: "ops@example.com", role: "platform_operator",
  roleLabel: "Operator", firstName: "Ops", lastName: "Person", phone: "+91 90000 11111" };

type Call = { url: string; method: string; body: unknown };
function serve(list: AdminUser[], patch: (body: Record<string, string>) => [unknown, number]) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), method, body });
    const [res, status] = method === "PATCH" ? patch(body) : [list, 200];
    return new Response(JSON.stringify(res), { status });
  });
  return calls;
}
const ok = (admin: AdminUser, changed: string[], clerkSync = "not_needed") =>
  [{ admin, changed, clerkSync }, 200] as [unknown, number];

beforeEach(() => {
  shell.me = { id: "a1", name: "Vignesh phaarvai", email: "admin@phaarvai.com", roles: ["platform_administrator"], authMethod: "password" };
  shell.toasts = [];
  shell.reloadMe.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const renderAdmins = () => render(<AdminHostContext.Provider value={host()}><Admins /></AdminHostContext.Provider>);

describe("Admins: Edit details", () => {
  it("built-in admin (you): name editable, email read-only; only changed fields are sent; header reloads", async () => {
    const calls = serve([BUILT_IN, OPS], (b) => ok({ ...BUILT_IN, firstName: b.firstName, name: `${b.firstName} phaarvai` }, ["first name"]));
    renderAdmins();
    fireEvent.click(await screen.findByRole("button", { name: "Edit details of Vignesh phaarvai" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Edit my details")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/First name/)).toHaveValue("Vignesh");
    expect(within(dialog).getByLabelText("Last name")).toHaveValue("phaarvai");
    const email = within(dialog).getByLabelText("Sign-in email");
    expect(email).toHaveAttribute("readonly");
    expect(within(dialog).getByText(/built-in administrator's email cannot be changed/)).toBeInTheDocument();
    const save = within(dialog).getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();                                      // nothing changed yet
    fireEvent.change(within(dialog).getByLabelText(/First name/), { target: { value: "  Vicky " } });
    await act(async () => fireEvent.click(save));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toContain("/admin-users/a1");
    expect(patch.body).toEqual({ firstName: "Vicky" });             // trimmed, nothing else sent
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(shell.reloadMe).toHaveBeenCalledTimes(1);
    expect(shell.toasts).toEqual(["Your details were saved."]);
    expect(calls.filter((c) => c.method === "GET").length).toBe(2); // list refreshed
  });

  it("administrator edits another admin's name, phone and email", async () => {
    const calls = serve([BUILT_IN, OPS], () => ok({ ...OPS, name: "Priya Raman" }, ["first name", "last name", "phone", "email"]));
    renderAdmins();
    fireEvent.click(await screen.findByRole("button", { name: "Edit details of Ops Person" }));
    const d = within(screen.getByRole("dialog"));
    expect(d.getByLabelText("Phone")).toHaveValue("+91 90000 11111");
    fireEvent.change(d.getByLabelText(/First name/), { target: { value: "Priya" } });
    fireEvent.change(d.getByLabelText("Last name"), { target: { value: "Raman" } });
    fireEvent.change(d.getByLabelText("Phone"), { target: { value: "" } });
    fireEvent.change(d.getByLabelText("Sign-in email"), { target: { value: "priya@example.com" } });
    await act(async () => fireEvent.click(d.getByRole("button", { name: "Save changes" })));
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual(
      { firstName: "Priya", lastName: "Raman", phone: "", email: "priya@example.com" });
    await waitFor(() => expect(shell.toasts).toEqual(["Priya Raman's details were saved."]));
    expect(shell.reloadMe).not.toHaveBeenCalled();
  });

  it("checks the form before sending and shows the server's refusal", async () => {
    const calls = serve([BUILT_IN, OPS], () => [{ detail: "ops2@example.com is already used by another account." }, 409]);
    renderAdmins();
    fireEvent.click(await screen.findByRole("button", { name: "Edit details of Ops Person" }));
    const d = within(screen.getByRole("dialog"));
    fireEvent.change(d.getByLabelText(/First name/), { target: { value: " " } });
    await act(async () => fireEvent.click(d.getByRole("button", { name: "Save changes" })));
    expect(d.getByRole("alert")).toHaveTextContent("First name is required.");
    fireEvent.change(d.getByLabelText(/First name/), { target: { value: "Ops" } });
    fireEvent.change(d.getByLabelText("Phone"), { target: { value: "call me" } });
    await act(async () => fireEvent.click(d.getByRole("button", { name: "Save changes" })));
    expect(d.getByRole("alert")).toHaveTextContent(/valid phone/);
    fireEvent.change(d.getByLabelText("Phone"), { target: { value: "+91 90000 11111" } });
    fireEvent.change(d.getByLabelText("Sign-in email"), { target: { value: "not-an-email" } });
    await act(async () => fireEvent.click(d.getByRole("button", { name: "Save changes" })));
    expect(d.getByRole("alert")).toHaveTextContent(/valid email/);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    fireEvent.change(d.getByLabelText("Sign-in email"), { target: { value: "ops2@example.com" } });
    await act(async () => fireEvent.click(d.getByRole("button", { name: "Save changes" })));
    expect(await d.findByRole("alert")).toHaveTextContent("already used by another account");
    expect(screen.getByRole("dialog")).toBeInTheDocument();          // stays open, nothing lost
  });

  it("non-administrator: Edit only on their own row; no access actions", async () => {
    shell.me = { id: "a2", name: "Ops Person", email: "ops@example.com", roles: ["platform_operator"], authMethod: "password" };
    serve([{ ...BUILT_IN, isYou: false, canEditDetails: false }, { ...OPS, isYou: true }], () => [{}, 200]);
    renderAdmins();
    expect(await screen.findByRole("button", { name: "Edit details of Ops Person" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit details of Vignesh phaarvai" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Revoke|Reset password/ })).toBeNull();
  });

  it("XfactorY account admin: email managed in the XfactorY account; a failed name sync is reported", async () => {
    const xy = { ...OPS, hasXyAccount: true, emailEditable: false };
    serve([BUILT_IN, xy], () => ok({ ...xy, name: "Meera Person" }, ["first name"], "failed"));
    renderAdmins();
    fireEvent.click(await screen.findByRole("button", { name: "Edit details of Ops Person" }));
    const d = within(screen.getByRole("dialog"));
    expect(d.getByLabelText("Sign-in email")).toHaveAttribute("readonly");
    expect(d.getByText(/managed in that account/)).toBeInTheDocument();
    expect(d.getByText(/also updated in the XfactorY account/)).toBeInTheDocument();
    fireEvent.change(d.getByLabelText(/First name/), { target: { value: "Meera" } });
    await act(async () => fireEvent.click(d.getByRole("button", { name: "Save changes" })));
    await waitFor(() => expect(shell.toasts[0]).toMatch(/saved, but the name could not be updated in the XfactorY account/));
  });
});

describe("Edit my details (header)", () => {
  it("opens the signed-in admin's own record", async () => {
    serve([OPS, BUILT_IN], () => ok(BUILT_IN, []));
    const onSaved = vi.fn();
    render(<AdminHostContext.Provider value={host()}><EditMyDetailsModal onClose={() => undefined} onSaved={onSaved} /></AdminHostContext.Provider>);
    expect(await screen.findByLabelText(/First name/)).toHaveValue("Vignesh");
    expect(screen.getByText("Edit my details")).toBeInTheDocument();
  });

  it("savedMessage wording", () => {
    expect(savedMessage({ admin: BUILT_IN, changed: [], clerkSync: "not_needed" })).toBe("No changes to save.");
    expect(savedMessage({ admin: OPS, changed: ["phone"], clerkSync: "not_needed" })).toBe("Ops Person's details were saved.");
  });
});
