/**
 * Update requests for a company managed by someone else: the details form hint, the requester's
 * status on the dashboard, and the admin review (side by side, edit, apply chosen fields, decide).
 * The admin detail data is a real backend response (tests/fixtures/admin-detail-update-request.json,
 * captured from GET/PATCH /api/v1/admin/manufacturers/{id} with one approved and one pending request).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import detailFixture from "./fixtures/admin-detail-update-request.json";
import { ManufacturerDetail } from "@/components/admin/ManufacturerDetail";
import { AccountScreen, type AccountSubmission } from "@/components/manufacturer/AccountScreen";
import { DashboardScreen } from "@/components/manufacturer/DashboardScreen";
import type { CompanyUpdateRequest } from "@/components/manufacturer/ManufacturerApp";
import { AdminHostContext, type AdminHost } from "@/lib/admin/api";
import type { CompanyDetails, CompanySearchResult } from "@/lib/api";
import { createInitialManufacturerState } from "@/lib/manufacturer/types";

vi.mock("@/components/manufacturer/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/manufacturer/AccountMenu", () => ({ AccountMenu: () => null }));

const ORG = detailFixture.manufacturer.id as string;
const PENDING = detailFixture.updateRequests.find((r) => r.status === "pending")!;

function host(): AdminHost {
  return {
    ready: true, path: `/admin/manufacturers/${ORG}`, search: new URLSearchParams("tab=onboarding"), go: () => undefined,
    getClerkToken: async () => "clerk-token", clerkEmail: "admin@example.com",
    clerkSignIn: async () => ({ ok: true }), clerkVerifyCode: async () => ({ ok: true }),
    clerkSignOut: async () => undefined,
  } as unknown as AdminHost;
}

afterEach(() => vi.unstubAllGlobals());

function stubAdmin(onDecision: (body: Record<string, unknown>) => Response, onPatch?: (body: Record<string, unknown>) => Response) {
  const calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, url: String(url), body });
    if (String(url).endsWith("/decision")) return onDecision(body);
    if (method === "PATCH" && String(url).includes("/update-requests/")) {
      return onPatch ? onPatch(body) : new Response(JSON.stringify(detailFixture), { status: 200 });
    }
    if (String(url).endsWith(`/admin/manufacturers/${ORG}`)) return new Response(JSON.stringify(detailFixture), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  });
  render(<AdminHostContext.Provider value={host()}><ManufacturerDetail id={ORG} /></AdminHostContext.Provider>);
  return calls;
}

async function pendingSection() {
  const sections = (await screen.findAllByText("Update request")).map((t) => t.closest("section")!);
  return sections.find((s) => within(s).queryByText("Awaiting review"))!;
}

describe("admin: update request review", () => {
  it("shows current and proposed values side by side, the requester, source and that access is not granted", async () => {
    stubAdmin(() => new Response("{}", { status: 200 }));
    const section = await pendingSection();
    expect(within(section).getByText(/Existing company update · from Ravi Kumar/)).toBeInTheDocument();
    expect(within(section).getByText(/source: web_dashboard/)).toBeInTheDocument();
    // approval links the applicant as a member, never as the owner
    expect(within(section).getByText(/makes them a member of the company \(never its owner\)/)).toBeInTheDocument();
    // (the label also appears in the "Fields to correct" choices; the table row is the one in a <tr>)
    const cap = within(section).getAllByText("Production capacity").map((el) => el.closest("tr")).find(Boolean)!;
    expect(cap.querySelectorAll("td")[2].textContent).toContain(PENDING.fields.find((f) => f.key === "capacity")!.current);
    expect((within(cap).getByLabelText("Proposed Production capacity") as HTMLInputElement).value).toBe("7,800 units/month");
    expect(cap.textContent).toContain("(requester: 7800)"); // admin edit is visible
    // fields that do not differ cannot be applied
    expect((within(section).getByLabelText("Apply Company name") as HTMLInputElement).disabled).toBe(true);
    expect((within(section).getByLabelText("Verification / contact notes (internal)") as HTMLTextAreaElement).value)
      .toBe("Called the plant.");
    // the closed (approved) request shows what was applied and has no decision buttons
    const done = screen.getAllByText("Update request").map((t) => t.closest("section")!)
      .find((s) => within(s).queryByText("Approved"))!;
    expect(within(done).getByText(/Applied: Production capacity: 10 units → 500 units/)).toBeInTheDocument();
    expect(within(done).queryByRole("button", { name: "Approve with selected changes" })).toBeNull();
  });

  it("approves only the ticked fields with the fingerprint it showed", async () => {
    const calls = stubAdmin(() => new Response(JSON.stringify({ ...detailFixture, updateRequests: [] }), { status: 200 }));
    const section = await pendingSection();
    fireEvent.click(within(section).getByLabelText("Apply Contact email"));   // untick
    fireEvent.click(within(section).getByLabelText("Apply Contact phone"));   // untick
    await act(async () => fireEvent.click(within(section).getByRole("button", { name: "Approve with selected changes" })));
    const decision = calls.find((c) => c.url.endsWith("/decision"))!;
    expect(decision.url).toContain(`/admin/manufacturers/${ORG}/update-requests/${PENDING.id}/decision`);
    expect(decision.body).toEqual({ decision: "approve", fingerprint: PENDING.fingerprint, feedback: null,
                                    fields: ["companyType", "capacity"] });
  });

  it("edits are saved first, then the decision uses the new version", async () => {
    const edited = { ...detailFixture, updateRequests: detailFixture.updateRequests.map((r) =>
      r.id === PENDING.id ? { ...r, fingerprint: "after-edit-fp" } : r) };
    const calls = stubAdmin(() => new Response(JSON.stringify(edited), { status: 200 }),
                            () => new Response(JSON.stringify(edited), { status: 200 }));
    const section = await pendingSection();
    fireEvent.change(within(section).getByLabelText("Proposed Category"), { target: { value: "Automotive & Machinery" } });
    await act(async () => fireEvent.click(within(section).getByRole("button", { name: "Approve with selected changes" })));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.body).toEqual({ values: { companyType: "Automotive & Machinery" } });
    expect(calls.find((c) => c.url.endsWith("/decision"))!.body).toMatchObject({ fingerprint: "after-edit-fp" });
  });

  it("decline and corrections need feedback; a stale review reloads the latest values", async () => {
    const calls = stubAdmin(() => new Response(JSON.stringify({ detail: "The company record or this request changed after you opened it. Review the latest differences, then decide again." }), { status: 409 }));
    const section = await pendingSection();
    const decline = within(section).getByRole("button", { name: "Decline" }) as HTMLButtonElement;
    expect(decline.disabled).toBe(true);
    expect((within(section).getByRole("button", { name: "Request corrections" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(section).getByLabelText(/Feedback to the requester/), { target: { value: "Not verified" } });
    await act(async () => fireEvent.click(decline));
    expect(calls.find((c) => c.url.endsWith("/decision"))!.body).toMatchObject({ decision: "decline", feedback: "Not verified" });
    await waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.url.endsWith(`/admin/manufacturers/${ORG}`)).length).toBe(2));
  });
});

describe("requester", () => {
  it("is told the details go to X!Y review when the selected company is managed by someone else", async () => {
    const result: CompanySearchResult = { id: "co-1", companyName: "Ashok Leyland Limited", country: "India", city: "Chennai",
                                          companyType: "Automotive & Machinery", claimed: true };
    const details: CompanyDetails = { id: "co-1", companyName: "Ashok Leyland Limited", companyType: "Automotive & Machinery",
                                      country: "India", city: "Chennai", state: "", capacity: "", phone: "",
                                      access: "claimed", canUpdate: false };
    const submitted: AccountSubmission[] = [];
    render(<AccountScreen onBack={() => undefined} onAccountCreated={(s) => { submitted.push(s); }}
                          onSearchCompanies={async () => [result]} onLoadCompany={async () => details} />);
    fireEvent.focus(screen.getByLabelText("Company name"));
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "ashok" } });
    fireEvent.click((await screen.findByText("Chennai, India")).closest("button")!);
    expect(await screen.findByText(/managed by another X!Y user/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Ashok Leyland Ltd" } });
    expect(screen.queryByText(/managed by another X!Y user/)).toBeNull(); // selection dropped
  });

  it("sees the status and X!Y feedback of their own requests on the dashboard", () => {
    const requests: CompanyUpdateRequest[] = [
      { id: "r1", status: "changes_requested", companyId: "co-1", companyName: "Ashok Leyland Limited", proposed: {},
        feedback: "Please add units to the capacity.", submittedAt: "2026-10-14T10:00:00Z", updatedAt: null, reviewedAt: null },
      { id: "r2", status: "approved", companyId: "co-2", companyName: "Other Co", proposed: {}, feedback: null,
        submittedAt: "2026-10-10T10:00:00Z", updatedAt: null, reviewedAt: null },
    ];
    const fix = vi.fn();
    const noop = () => undefined;
    render(<DashboardScreen state={createInitialManufacturerState()} pct={15}
                            flags={{ companyDetailsDone: false, locationDone: false, certsDone: false, infraDone: false, faqDone: false }}
                            onOpenProfileWizard={noop} onFixCompanyDetails={fix} updateRequests={requests}
                            onOpenMachineryWizard={noop} onEditMachinery={noop} onSetMachineryStatus={noop} onSaveCapacity={noop}
                            onCycleDay={noop} onOpenRecurringModal={noop} onAcceptBooking={noop} onDeclineBooking={noop}
                            onBackToLanding={noop} showToast={noop} />);
    expect(screen.getByText("Company update requests")).toBeInTheDocument();
    const row = screen.getByText("Ashok Leyland Limited").closest(".wiz-check-row")!;
    expect(within(row as HTMLElement).getByText("Corrections requested")).toBeInTheDocument();
    expect(row.textContent).toContain("X!Y: Please add units to the capacity.");
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Correct details" }));
    expect(fix).toHaveBeenCalled();
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });
});
