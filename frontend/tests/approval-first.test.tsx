/**
 * Approval-first manufacturer onboarding: the dashboard stays locked until XfactorY approves, date of
 * birth is optional, corrections open only the listed fields, and the admin names those fields.
 * Same layout and styles as before (existing elements and classes only).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import detailFixture from "./fixtures/admin-detail-pending.json";
import { ManufacturerDetail } from "@/components/admin/ManufacturerDetail";
import { AccountScreen, type AccountSubmission } from "@/components/manufacturer/AccountScreen";
import { DashboardScreen } from "@/components/manufacturer/DashboardScreen";
import { AdminHostContext, type AdminHost } from "@/lib/admin/api";
import { createInitialManufacturerState } from "@/lib/manufacturer/types";

vi.mock("@/components/manufacturer/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/manufacturer/AccountMenu", () => ({ AccountMenu: () => null }));

afterEach(() => vi.unstubAllGlobals());

const PENDING_MESSAGE = "Your manufacturer application is awaiting admin approval.";
const noop = () => undefined;

function dashboard(props: Partial<Parameters<typeof DashboardScreen>[0]> = {}) {
  const toasts: string[] = [];
  const opened: string[] = [];
  render(<DashboardScreen state={createInitialManufacturerState()} pct={15}
                          flags={{ companyDetailsDone: false, locationDone: false, certsDone: false, infraDone: false, faqDone: false }}
                          onOpenProfileWizard={() => opened.push("profile")} onOpenMachineryWizard={() => opened.push("machinery")}
                          onEditMachinery={noop} onSetMachineryStatus={noop} onSaveCapacity={noop} onCycleDay={noop}
                          onOpenRecurringModal={noop} onAcceptBooking={noop} onDeclineBooking={noop}
                          onBackToLanding={noop} showToast={(m) => toasts.push(m)} {...props} />);
  return { toasts, opened };
}

describe("manufacturer dashboard while the application is reviewed", () => {
  it("shows the pending message and keeps every remaining section locked", () => {
    const { toasts, opened } = dashboard({ lock: { message: PENDING_MESSAGE } });
    expect(screen.getByText(PENDING_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Complete remaining details" })).toBeNull();
    for (const card of ["Company Profile", "Machinery", "Availability", "Booking Requests"]) {
      fireEvent.click(screen.getByText(card).closest("button")!);
    }
    expect(toasts).toEqual([PENDING_MESSAGE, PENDING_MESSAGE, PENDING_MESSAGE, PENDING_MESSAGE]);
    expect(opened).toEqual([]);
    expect(screen.getByText("Your workspace")).toBeInTheDocument(); // still on the dashboard
  });

  it("rejected: shows XfactorY's explanation and, once allowed, Apply again", () => {
    const fix = vi.fn();
    dashboard({
      lock: { message: "Your manufacturer application was not approved. You can now send a new application.",
              detail: "XfactorY: We could not confirm you work here.", actionLabel: "Apply again" },
      onFixCompanyDetails: fix,
    });
    expect(screen.getByText(/could not confirm you work here/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply again" }));
    expect(fix).toHaveBeenCalled();
  });

  it("approved member: the shared company profile is the owner's", () => {
    const { toasts, opened } = dashboard({ profileLockedMessage: "Only the company's primary user can edit the shared company profile." });
    fireEvent.click(screen.getByRole("button", { name: "Complete remaining details" }));
    expect(toasts).toEqual(["Only the company's primary user can edit the shared company profile."]);
    expect(opened).toEqual([]);
  });

  it("approved owner: unchanged dashboard", () => {
    const { opened } = dashboard();
    expect(screen.getByText(/Next step:/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Complete remaining details" }));
    expect(opened).toEqual(["profile"]);
  });
});

describe("details form", () => {
  const field = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLSelectElement;

  async function submit() {
    fireEvent.click(field("acc-agree"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create Manufacturer account" })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 800)); });
  }

  it("date of birth is optional", async () => {
    const submitted: AccountSubmission[] = [];
    render(<AccountScreen onBack={noop} onAccountCreated={(s) => { submitted.push(s); }} onSearchCompanies={async () => []}
                          initial={{ firstName: "Jansi", lastName: "Rani", email: "jansi@gmail.com" }} />);
    fireEvent.change(field("acc-company"), { target: { value: "Rani Tools" } });
    fireEvent.change(field("acc-company-type"), { target: { value: "Other" } });
    fireEvent.change(field("acc-country"), { target: { value: "India" } });
    fireEvent.change(field("acc-phone"), { target: { value: "9876543210" } });
    await submit();
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ firstName: "Jansi", lastName: "Rani", email: "jansi@gmail.com", dob: null });
  });

  it("corrections: only the fields XfactorY listed can be edited", () => {
    render(<AccountScreen onBack={noop} onAccountCreated={noop} onSearchCompanies={async () => []}
                          correctionFields={["capacity", "personalEmail"]}
                          initial={{ firstName: "Asha", lastName: "Rao", email: "asha@gmail.com", dob: "1990-02-02",
                                     companyName: "Asha Cast", companyType: "Other", country: "India",
                                     phone: "+919000011111", capacity: "500" }} />);
    expect(screen.getByText(/XfactorY asked you to correct: Email address, Production capacity/)).toBeInTheDocument();
    for (const id of ["acc-capacity", "acc-email"]) expect(field(id).disabled).toBe(false);
    for (const id of ["acc-first", "acc-last", "acc-dob", "acc-company", "acc-company-type", "acc-country", "acc-phone"]) {
      expect(field(id).disabled).toBe(true);
    }
  });
});

describe("admin: requesting corrections names the exact fields", () => {
  const ORG = detailFixture.manufacturer.id as string;
  const host = () => ({
    ready: true, path: `/admin/manufacturers/${ORG}`, search: new URLSearchParams("tab=onboarding"), go: () => undefined,
    getClerkToken: async () => "clerk-token", clerkEmail: "admin@example.com",
    clerkSignIn: async () => ({ ok: true }), clerkVerifyCode: async () => ({ ok: true }), clerkSignOut: async () => undefined,
  }) as unknown as AdminHost;

  it("Save status stays disabled until a field is ticked; the fields are sent", async () => {
    const patches: unknown[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      if ((init.method ?? "GET") === "PATCH") {
        patches.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(detailFixture), { status: 200 });
      }
      if (String(url).endsWith(`/admin/manufacturers/${ORG}`)) return new Response(JSON.stringify(detailFixture), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    });
    render(<AdminHostContext.Provider value={host()}><ManufacturerDetail id={ORG} /></AdminHostContext.Provider>);
    await screen.findByText("Submitted for approval");
    fireEvent.change(screen.getByLabelText("Change status"), { target: { value: "NEEDS_CORRECTION" } });
    fireEvent.change(screen.getByLabelText(/What needs correcting/), { target: { value: "Capacity per month" } });
    const save = screen.getByRole("button", { name: "Save status" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const picker = screen.getByText("Fields to correct").parentElement!;
    fireEvent.click(within(picker).getByLabelText("Production capacity"));
    expect(save.disabled).toBe(false);
    await act(async () => fireEvent.click(save));
    await waitFor(() => expect(patches).toEqual([
      { review_status: "NEEDS_CORRECTION", reason: "Capacity per month", correction_fields: ["capacity"] }]));
  });
});
