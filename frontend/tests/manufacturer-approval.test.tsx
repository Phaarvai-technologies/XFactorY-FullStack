/**
 * Admin approval UI and the manufacturer's correction path.
 * The admin detail data is a real backend response (tests/fixtures/admin-detail-pending.json,
 * captured from GET /api/v1/admin/manufacturers/{id} for a company awaiting approval).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import detailFixture from "./fixtures/admin-detail-pending.json";
import { ManufacturerDetail } from "@/components/admin/ManufacturerDetail";
import { AccountScreen, type AccountSubmission } from "@/components/manufacturer/AccountScreen";
import { AdminHostContext, type AdminHost } from "@/lib/admin/api";

const ORG = detailFixture.manufacturer.id as string;

function host(): AdminHost {
  return {
    ready: true, path: `/admin/manufacturers/${ORG}`, search: new URLSearchParams("tab=onboarding"), go: () => undefined,
    getClerkToken: async () => "clerk-token", clerkEmail: "admin@example.com",
    clerkSignIn: async () => ({ ok: true }), clerkVerifyCode: async () => ({ ok: true }),
    clerkSignOut: async () => undefined,
  } as unknown as AdminHost;
}

afterEach(() => vi.unstubAllGlobals());

describe("admin: company details awaiting approval", () => {
  it("shows the submitted details next to the current record and offers approve / correct / reject", async () => {
    const patches: unknown[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      if ((init.method ?? "GET") === "PATCH") {
        patches.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ...detailFixture, manufacturer: { ...detailFixture.manufacturer, reviewStatus: "REJECTED" },
                                             pendingSubmission: null }), { status: 200 });
      }
      if (String(url).endsWith(`/admin/manufacturers/${ORG}`)) return new Response(JSON.stringify(detailFixture), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    });
    render(<AdminHostContext.Provider value={host()}><ManufacturerDetail id={ORG} /></AdminHostContext.Provider>);

    // "Onboarding & Review" tab of the manufacturer detail page
    const section = (await screen.findByText("Submitted for approval")).closest("section")!;
    expect(within(section).getByText("Awaiting review")).toBeInTheDocument();
    expect(within(section).getByText("Fixture Castings")).toBeInTheDocument();          // submitted
    expect(within(section).getByText(/Company details · /)).toBeInTheDocument();
    const row = within(section).getByText("Company name").closest("tr")!;
    expect(row.querySelectorAll("td")[2].textContent).not.toBe("Fixture Castings");  // record unchanged

    const select = screen.getByLabelText("Change status") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(
      ["Not started", "In progress", "Submitted", "Needs correction", "Approved", "Rejected"]);
    fireEvent.change(select, { target: { value: "REJECTED" } });
    expect(screen.getByText(/Reason for rejection/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Reason for rejection/), { target: { value: "Not a manufacturer" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save status" })));
    await waitFor(() => expect(patches).toEqual([{ review_status: "REJECTED", reason: "Not a manufacturer" }]));
  });
});

describe("manufacturer: correcting submitted details", () => {
  it("the details form reopens prefilled with what was submitted, including the selected company", async () => {
    const submitted: AccountSubmission[] = [];
    render(<AccountScreen onBack={() => undefined} onAccountCreated={(s) => { submitted.push(s); }}
                          onSearchCompanies={async () => []}
                          initial={{ firstName: "Asha", lastName: "Rao", contact: "asha@factory.in", dob: "1990-02-02",
                                     companyName: "Seeded Cast", companyType: "Other", country: "India",
                                     phone: "", capacity: "1 t", companyId: "seeded-id" }} />);
    expect((screen.getByLabelText("Company name") as HTMLInputElement).value).toBe("Seeded Cast");
    expect((screen.getByLabelText("Country / location") as HTMLSelectElement).value).toBe("India");
    fireEvent.click(screen.getByRole("checkbox"));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Create Manufacturer account" }));
    await act(async () => { vi.advanceTimersByTime(800); });
    vi.useRealTimers();
    expect(submitted[0]).toMatchObject({ companyId: "seeded-id", companyName: "Seeded Cast", capacity: "1 t" });
  });
});
