// Live: admin portal API (real backend :8000, Postgres) sets Needs correction + notes; the real
// manufacturer bell (jsdom, real fetch, real Clerk-format token) shows them.
// Needs: backend on :8000 with a TEST database, MFR_TOKEN (a Clerk token for a manufacturer whose
// company name contains "Kaveri") and ADMIN_TEST_PASSWORD (admin@phaarvai.com on that database).
import "../setup";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NotificationBell } from "@/components/manufacturer/NotificationBell";
import { session } from "../mocks/clerk";

const API = "http://localhost:8000/api/v1";
let passed = 0, failed = 0; const results: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; results.push(`PASS ${name}`); } catch (e) { failed++; results.push(`FAIL ${name}: ${(e as Error).message}`); } finally { cleanup(); }
}
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const MFR = process.env.MFR_TOKEN!;
session.tokens = Array(50).fill(MFR);
async function j(path: string, token: string, method = "GET", body?: unknown) {
  const r = await fetch(API + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${t}`); return t ? JSON.parse(t) : null;
}
const stamp = Date.now();
(async () => {
  const login = await fetch(API + "/admin/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@phaarvai.com", password: process.env.ADMIN_TEST_PASSWORD }) });
  const admin = (await login.json()).token as string;
  const org = (await j("/admin/manufacturers?q=Kaveri", admin)).rows[0].id as string;
  await j("/manufacturer/notifications/read", MFR, "POST", {});
  await j(`/admin/manufacturers/${org}/admin-fields`, admin, "PATCH", { review_status: "IN_PROGRESS" }).catch(() => undefined);
  await j(`/admin/manufacturers/${org}/notes`, admin, "POST", { note: `Private ${stamp}: owner sounded unsure` });
  await j(`/admin/manufacturers/${org}/admin-fields`, admin, "PATCH", { review_status: "NEEDS_CORRECTION", reason: `Upload a clearer ISO certificate ${stamp}` });
  await j(`/admin/manufacturers/${org}/notes`, admin, "POST", { note: `Please show the expiry date ${stamp}`, share: true });

  await test("Manufacturer sees the popup for the correction request", async () => {
    render(<NotificationBell onOpenProfile={() => undefined} />);
    await wait(1500);
    assert(screen.queryByRole("alertdialog"), "no popup");
    assert(screen.getByText("Your profile needs a few corrections", { selector: "h3" }), "title");
  });
  await test("Open notifications: the admin's correction note and shared note are shown; private note is not", async () => {
    render(<NotificationBell onOpenProfile={() => undefined} />);
    await wait(1500);
    fireEvent.click(screen.getByRole("button", { name: "Open notifications" }));
    await wait(1500);
    const panel = screen.getByRole("dialog", { name: "Notifications" });
    const text = panel.textContent ?? "";
    assert(panel.querySelector(".notif-reason")?.textContent === `Upload a clearer ISO certificate ${stamp}`, "reason");
    assert(text.includes(`Please show the expiry date ${stamp}`), "shared note");
    assert(!text.includes(`Private ${stamp}`), "private note leaked");
    const after = await j("/manufacturer/notifications", MFR);
    assert(after.unread === 0 && after.popup === null, `still unread: ${after.unread}`);
  });
  await test("Next visit: no popup again", async () => {
    render(<NotificationBell />);
    await wait(1500);
    assert(!screen.queryByRole("alertdialog"), "popup shown again");
  });
  console.log(results.join("\n") + `\n\n${passed}/${passed + failed} live notification tests passed`);
  process.exit(failed ? 1 : 0);
})();
