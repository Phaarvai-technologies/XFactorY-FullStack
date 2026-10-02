import "./setup";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createBlankProfileData, ProfileWizard, type ProfileWizardData } from "@/components/manufacturer/ProfileWizard";
import { MachineryWizard } from "@/components/manufacturer/MachineryWizard";
import { DashboardScreen } from "@/components/manufacturer/DashboardScreen";
import { createInitialManufacturerState } from "@/lib/manufacturer/types";

let passed = 0, failed = 0;
const results: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; results.push(`PASS ${name}`); }
  catch (e) { failed++; results.push(`FAIL ${name}: ${(e as Error).message}`); }
  finally { cleanup(); }
}
function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }
function deferred() { let resolve!: (v: boolean) => void; const promise = new Promise<boolean>((r) => (resolve = r)); return { promise, resolve }; }
const heading = () => screen.getByRole("heading", { level: 2 }).textContent ?? "";
const flush = () => act(async () => { await Promise.resolve(); });
const noop = () => undefined;
const flags = { companyDetailsDone: false, locationDone: false, certsDone: false, infraDone: false, faqDone: false };

function profileData(): ProfileWizardData {
  const d = createBlankProfileData("Acme");
  d.company.about = "We make parts";
  return d;
}
function renderProfile(onSaveStep: any, extra: Partial<{ initialStep: number; data: ProfileWizardData; onExit: () => void }> = {}) {
  return render(<ProfileWizard firstName="Priya" flags={flags} pct={15} initialStep={extra.initialStep ?? 1}
    data={extra.data ?? profileData()} onChange={noop} onExit={extra.onExit ?? noop} onFinish={noop}
    showToast={noop} onSaveStep={onSaveStep} />);
}

(async () => {
  // ---------------------------------------------------------------- Company profile wizard
  await test("Profile: Next waits for the save, shows Saving…, blocks double clicks", async () => {
    const d = deferred(); const calls: any[] = [];
    renderProfile((...a: any[]) => { calls.push(a); return d.promise; });
    const next = screen.getByRole("button", { name: "Get started" });
    fireEvent.click(next); await flush();
    fireEvent.click(screen.getByRole("button", { name: "Saving…" })); await flush();
    assert(calls.length === 1, `expected 1 save, got ${calls.length}`);
    assert((screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled, "button not disabled while saving");
    assert(heading().startsWith("Welcome"), "moved before the save finished");
    await act(async () => d.resolve(true));
    assert(heading() === "Company details", `after save expected Company details, got ${heading()}`);
    assert(calls[0][0] === 1 && calls[0][2].completed === true && calls[0][2].nextStep === 2, "wrong step payload");
  });

  await test("Profile: failed save keeps the user on the step", async () => {
    renderProfile(async () => false, { initialStep: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Save & Next" })); await flush(); await flush();
    assert(heading() === "Company details", `moved despite failed save: ${heading()}`);
  });

  await test("Profile: invalid step is not sent to the backend", async () => {
    const calls: any[] = [];
    const empty = createBlankProfileData("");
    renderProfile(async (...a: any[]) => { calls.push(a); return true; }, { initialStep: 2, data: empty });
    fireEvent.click(screen.getByRole("button", { name: "Save & Next" })); await flush();
    assert(calls.length === 0, "invalid step was saved");
    assert(screen.getByText("Company name is required."), "validation message missing");
  });

  await test("Profile: step data is sent with the save", async () => {
    const calls: any[] = [];
    renderProfile(async (...a: any[]) => { calls.push(a); return true; }, { initialStep: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Save & Next" })); await flush(); await flush();
    assert(calls[0][0] === 2 && calls[0][1].company.name === "Acme" && calls[0][1].company.about === "We make parts", "data missing");
    assert(heading() === "Location", `expected Location, got ${heading()}`);
  });

  await test("Profile: Skip saves position only (no data) then moves", async () => {
    const calls: any[] = [];
    renderProfile(async (...a: any[]) => { calls.push(a); return true; }, { initialStep: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Skip" })); await flush(); await flush();
    assert(calls[0][0] === 3 && calls[0][1] === null && calls[0][2].completed === false && calls[0][2].nextStep === 4, "wrong skip payload");
    assert(heading() === "Certifications", `expected Certifications, got ${heading()}`);
  });

  await test("Profile: resumes at the step given by the backend", async () => {
    renderProfile(async () => true, { initialStep: 4 });
    assert(heading() === "Certifications", `expected Certifications, got ${heading()}`);
  });

  await test("Profile: Previous saves edits (not completed) before going back", async () => {
    const calls: any[] = [];
    renderProfile(async (...a: any[]) => { calls.push(a); return true; }, { initialStep: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Previous" })); await flush(); await flush();
    assert(calls[0][2].completed === false && calls[0][2].nextStep === 2 && calls[0][1] !== null, "wrong previous payload");
    assert(heading() === "Company details", `expected Company details, got ${heading()}`);
  });

  // ---------------------------------------------------------------- Machinery wizard
  const machine = { industry: "Automotive & Machinery", subcategory: "", type: "Lathe", capacity: "100", age: "", condition: "",
    technical: "", images: [], rawMatStatus: "Available", materialDetails: "", laborType: "Skilled", workerCount: "",
    workerRoles: "", logistics: ["Local"], logisticsPartner: "", pricing: { hour: "", day: "", month: "", unit: "", batch: "" }, insurance: "" };
  function renderMachine(p: any) {
    return render(<MachineryWizard onClose={p.onClose ?? noop} onPublish={p.onPublish ?? (async () => true)} showToast={p.showToast ?? noop}
      onSaveStep={p.onSaveStep ?? (async () => true)} initialDraft={p.initialDraft ?? null} initialStep={p.initialStep ?? 1}
      hasSavedDraft={p.hasSavedDraft ?? false} />);
  }

  await test("Machinery: step 1 is validated before any save", async () => {
    const calls: any[] = [];
    renderMachine({ onSaveStep: async (...a: any[]) => { calls.push(a); return true; } });
    fireEvent.click(screen.getByRole("button", { name: "Save & Next" })); await flush();
    assert(calls.length === 0 && heading() === "Machinery details", "saved or moved without industry/type");
  });

  await test("Machinery: Next saves (creates draft) and moves only after success", async () => {
    const d = deferred(); const calls: any[] = [];
    renderMachine({ initialDraft: machine, onSaveStep: (...a: any[]) => { calls.push(a); return d.promise; } });
    fireEvent.click(screen.getByRole("button", { name: "Save & Next" })); await flush();
    fireEvent.click(screen.getByRole("button", { name: "Saving…" })); await flush();
    assert(calls.length === 1 && heading() === "Machinery details", "double submit or moved early");
    await act(async () => d.resolve(true));
    assert(heading() === "Add images", `expected Add images, got ${heading()}`);
    assert(calls[0][0] === 1 && calls[0][1].type === "Lathe" && calls[0][2].completed === true, "wrong payload");
  });

  await test("Machinery: resumes a saved draft at its last incomplete step", async () => {
    renderMachine({ initialDraft: machine, initialStep: 5, hasSavedDraft: true });
    assert(heading() === "Logistics", `expected Logistics, got ${heading()}`);
  });

  await test("Machinery: closing before the first save says nothing was saved", async () => {
    const toasts: string[] = []; let closed = false; const calls: any[] = [];
    renderMachine({ showToast: (m: string) => toasts.push(m), onClose: () => { closed = true; },
      onSaveStep: async (...a: any[]) => { calls.push(a); return true; } });
    fireEvent.click(screen.getByRole("button", { name: "Previous" })); await flush();
    assert(closed && calls.length === 0 && toasts[0].startsWith("Draft discarded"), `got ${toasts}`);
  });

  await test("Machinery: closing a saved draft keeps it", async () => {
    const toasts: string[] = []; let closed = false; const calls: any[] = [];
    renderMachine({ initialDraft: machine, hasSavedDraft: true, showToast: (m: string) => toasts.push(m),
      onClose: () => { closed = true; }, onSaveStep: async (...a: any[]) => { calls.push(a); return true; } });
    fireEvent.click(screen.getByRole("button", { name: "Previous" })); await flush(); await flush();
    assert(closed && calls.length === 1 && calls[0][2].completed === false && toasts[0].startsWith("Progress saved"), `got ${toasts}`);
  });

  await test("Machinery: Publish is sent once and waits for the save", async () => {
    const d = deferred(); let publishes = 0;
    renderMachine({ initialDraft: machine, initialStep: 7, hasSavedDraft: true, onPublish: () => { publishes++; return d.promise; } });
    const publish = screen.getByRole("button", { name: "Publish" });
    fireEvent.click(publish); await flush(); fireEvent.click(publish); await flush();
    assert(publishes === 1, `published ${publishes} times`);
    assert((publish as HTMLButtonElement).disabled && (screen.getByRole("button", { name: "Save as Draft" }) as HTMLButtonElement).disabled, "buttons not disabled");
    await act(async () => d.resolve(true));
  });

  // ---------------------------------------------------------------- saved values are not lost
  await test("Profile: an area typed without Enter is saved with Save & Next", async () => {
    const calls: any[] = [];
    const d = profileData();
    d.location = { ...d.location, address: "4 Ring Rd", city: "Coimbatore", country: "India", serviceableAreas: ["Chennai"] };
    renderProfile(async (...a: any[]) => { calls.push(a); return true; }, { initialStep: 3, data: d });
    assert(screen.getByText("Chennai"), "saved area not shown when the step opens");
    fireEvent.change(document.getElementById("serviceable-input")!, { target: { value: "South India" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & Next" })); await flush(); await flush();
    const areas = calls[0]?.[1]?.location?.serviceableAreas;
    assert(JSON.stringify(areas) === '["Chennai","South India"]', `areas sent: ${JSON.stringify(areas)}`);
  });

  await test("Profile: a certification typed without + Add is saved with Save & Next", async () => {
    const calls: any[] = [];
    renderProfile(async (...a: any[]) => { calls.push(a); return true; }, { initialStep: 4 });
    fireEvent.change(document.getElementById("cert-name")!, { target: { value: "ISO 9001:2015" } });
    fireEvent.change(document.getElementById("cert-body")!, { target: { value: "BSI" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & Next" })); await flush(); await flush();
    const certs = calls[0]?.[1]?.certifications;
    assert(certs?.length === 1 && certs[0].name === "ISO 9001:2015" && certs[0].body === "BSI", `certs sent: ${JSON.stringify(certs)}`);
    assert(calls[0][2].completed === true, "step not marked complete");
  });

  await test("Profile: a half-filled certification is not skipped silently", async () => {
    const calls: any[] = [];
    renderProfile(async (...a: any[]) => { calls.push(a); return true; }, { initialStep: 4 });
    fireEvent.change(document.getElementById("cert-name")!, { target: { value: "ISO 14001" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & Next" })); await flush();
    assert(calls.length === 0, "saved without the issuing body");
    assert(screen.getAllByText("Certification name and issuing body are both required.").length > 0, "no error shown");
  });

  await test("Availability: Machine Name lists the manufacturer's own machinery", async () => {
    const state = createInitialManufacturerState();
    state.machinery = [
      { ...(machine as any), id: 1, type: "VMC 850", status: "Published" },
      { ...(machine as any), id: 2, type: "Old lathe", status: "Archived" },
      { ...(machine as any), id: 3, type: "Laser cutter", status: "Draft" },
    ];
    state.capacity = { machine: "VMC 850", count: "2", start: "2026-11-01", end: "2026-11-30" };
    render(<DashboardScreen state={state} pct={15} flags={flags} onOpenProfileWizard={noop}
      onOpenMachineryWizard={noop} onEditMachinery={noop} onSetMachineryStatus={noop} onSaveCapacity={noop}
      onCycleDay={noop} onOpenRecurringModal={noop} onAcceptBooking={noop} onDeclineBooking={noop}
      onBackToLanding={noop} showToast={noop} />);
    fireEvent.click(screen.getAllByRole("button").find((b) => /availability/i.test(b.textContent ?? ""))!); await flush();
    const select = document.getElementById("cap-machine") as HTMLSelectElement;
    const options = [...select.options].map((o) => o.value).filter(Boolean);
    assert(JSON.stringify(options) === '["VMC 850","Laser cutter"]', `options: ${JSON.stringify(options)}`);
    assert(select.value === "VMC 850", `saved plan not selected: ${select.value}`);
  });

  console.log(results.join("\n") + `\n\n${passed}/${passed + failed} component tests passed`);
  process.exit(failed ? 1 : 0);
})();
