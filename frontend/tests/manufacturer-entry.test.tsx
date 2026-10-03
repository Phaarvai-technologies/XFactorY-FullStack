// Manufacturer portal entry: an existing account goes straight to the portal with its
// saved data (one load, no "Join Our Ecosystem" flash); no account shows the Join page.
// The backend answer is a real GET /manufacturer/bootstrap response (fixtures/).
import "./setup";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ManufacturerApp } from "@/components/manufacturer/ManufacturerApp";
import existing from "./fixtures/bootstrap-existing.json";
import { clerkCalls, session } from "./mocks/clerk";
import { nav } from "./mocks/navigation";

let passed = 0, failed = 0;
const results: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; results.push(`PASS ${name}`); }
  catch (e) { failed++; results.push(`FAIL ${name}: ${(e as Error).message}`); }
  finally { cleanup(); }
}
function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const joinShown = () => !!screen.queryByText("Join Our Ecosystem");
const loadingShown = () => !!screen.queryByText("Loading your manufacturer account…");

type Reply = { status: number; body: unknown };
let replies: Reply[] = [];
const calls: string[] = [];
let releaseFetch: (() => void) | null = null;
(globalThis as any).fetch = async (url: string) => {
  calls.push(String(url));
  if (releaseFetch === null) await new Promise<void>((r) => { releaseFetch = r; });
  const reply = replies.shift() ?? { status: 200, body: existing };
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
};
async function answer() { releaseFetch?.(); releaseFetch = () => undefined; await flush(); await flush(); }

function reset(path: string, signedIn = true) {
  session.isSignedIn = signedIn; session.userId = signedIn ? `user_${Math.random()}` : null; session.tokens = [];
  nav.pathname = path; nav.pushed.length = 0; nav.replaced.length = 0;
  calls.length = 0; replies = []; releaseFetch = null;
}

(async () => {
  await test("Existing account: loading first, never the Join page, then straight to the dashboard", async () => {
    reset("/manufacturer");
    render(<ManufacturerApp />);
    await flush();
    assert(loadingShown(), "no loading indicator while checking");
    assert(!joinShown(), "Join Our Ecosystem flashed before the check finished");
    await answer();
    assert(!joinShown(), "Join page shown for an existing account");
    assert(nav.replaced.includes("/manufacturer/dashboard"), `not sent to the dashboard: ${nav.replaced}`);
    await act(async () => nav.go("/manufacturer/dashboard"));
    await flush();
    assert(screen.getByText(/Welcome, Meera/), "dashboard not shown with saved data");
    assert(calls.length === 1, `expected one load, got ${calls.length}`);
  });

  await test("Existing account: saved areas, certifications and own machinery are there on the first open", async () => {
    reset("/manufacturer");
    render(<ManufacturerApp />);
    await answer();
    await act(async () => nav.go("/manufacturer/dashboard"));
    await flush();
    // Availability: own machinery + saved plan
    fireEvent.click(screen.getAllByRole("button").find((b) => /availability/i.test(b.textContent ?? ""))!);
    await flush();
    const select = document.getElementById("cap-machine") as HTMLSelectElement;
    const options = [...select.options].map((o) => o.value).filter(Boolean);
    assert(JSON.stringify(options) === '["Thermoforming","Injection Moulding"]', `machinery options: ${options}`);
    assert(select.value === "Injection Moulding", `saved plan not selected: ${select.value}`);
    // Profile wizard: location step shows saved areas; certifications step shows the saved one
    fireEvent.click(document.querySelector(".panel-back")!);
    await flush();
    fireEvent.click(screen.getAllByRole("button").find((b) => /company profile/i.test(b.textContent ?? ""))!);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Open profile setup" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Get started" })); await flush(); await flush();
    fireEvent.click(screen.getByRole("button", { name: "Save & Next" })); await flush(); await flush();
    assert(screen.getByText("Tamil Nadu") && screen.getByText("South India"), "saved serviceable areas not shown");
    fireEvent.click(screen.getByRole("button", { name: "Save & Next" })); await flush(); await flush();
    assert(screen.getByText("ISO 9001:2015"), "saved certification not shown");
  });

  await test("No account: loading first, then the Join page; Join opens the account form", async () => {
    reset("/manufacturer");
    replies = [{ status: 200, body: { ...existing, accountExists: false } }];
    render(<ManufacturerApp />);
    await flush();
    assert(loadingShown() && !joinShown(), "Join page shown before the check finished");
    await answer();
    assert(joinShown(), "Join page not shown for a user without an account");
    assert(nav.replaced.length === 0, `unexpected redirect: ${nav.replaced}`);
    fireEvent.click(screen.getByText("Join Our Ecosystem"));
    assert(nav.pushed.includes("/manufacturer/account"), `Join did not open the form: ${nav.pushed}`);
  });

  await test("Signed out: Join page right away, no backend call", async () => {
    reset("/manufacturer", false);
    render(<ManufacturerApp />);
    await flush();
    assert(joinShown() && calls.length === 0, "signed-out overview changed");
  });

  await test("Just signed in (token not ready yet): retried, then straight to the dashboard", async () => {
    reset("/manufacturer");
    session.tokens = [null];                       // first getToken() has no token yet
    render(<ManufacturerApp />);
    await act(async () => { releaseFetch = () => undefined; await new Promise((r) => setTimeout(r, 900)); });
    await flush();
    assert(!joinShown(), "Join page shown after a token hiccup");
    assert(nav.replaced.includes("/manufacturer/dashboard"), `not sent to the dashboard: ${nav.replaced}`);
  });

  await test("Account form URL with an existing account goes to the dashboard (no form flash)", async () => {
    reset("/manufacturer/account");
    render(<ManufacturerApp />);
    await flush();
    assert(loadingShown() && !screen.queryByText(/Date of birth/i), "account form flashed");
    await answer();
    assert(nav.replaced.includes("/manufacturer/dashboard"), `not redirected: ${nav.replaced}`);
  });

  await test("Account menu: name button opens the menu; Manage account and Sign out work", async () => {
    reset("/manufacturer/dashboard");
    clerkCalls.length = 0;
    render(<ManufacturerApp />);
    await answer();
    const chip = document.querySelector(".avatar-chip") as HTMLButtonElement;
    assert(chip && !screen.queryByRole("menu"), "menu open before clicking");
    fireEvent.click(chip); await flush();
    assert(screen.getByRole("menu"), "menu did not open");
    assert(screen.getByText("test user22") && screen.getByText("testuser22@example.com"), "user not shown");
    assert(!screen.queryByText(/demo only/), "old demo toast still shown");
    fireEvent.click(screen.getByRole("menuitem", { name: "Manage account" })); await flush();
    assert(clerkCalls.includes("openUserProfile") && !screen.queryByRole("menu"), "Manage account did not open the profile");
    fireEvent.click(chip); await flush();
    fireEvent.keyDown(document, { key: "Escape" }); await flush();
    assert(!screen.queryByRole("menu"), "Escape did not close the menu");
    fireEvent.click(chip); await flush();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" })); await flush();
    assert(clerkCalls.includes("signOut:/"), `sign out not called: ${clerkCalls}`);
  });

  console.log(results.join("\n") + `\n\n${passed}/${passed + failed} manufacturer entry tests passed`);
  process.exit(failed ? 1 : 0);
})();
