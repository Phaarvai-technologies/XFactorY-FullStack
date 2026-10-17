/** Manufacturer details form: an existing company's saved details are read-only; a new company is
 * editable; personal email and company phone are separate (layout and styles unchanged). */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountScreen, type AccountSubmission } from "@/components/manufacturer/AccountScreen";
import type { CompanyDetails, CompanySearchResult } from "@/lib/api";

const ASHOK: CompanySearchResult = { id: "co-al", companyName: "Ashok Leyland", country: "India", city: "Chennai",
                                     state: "Tamil Nadu", companyType: "Automotive & Machinery" };
const SAVED: CompanyDetails = { id: "co-al", companyName: "Ashok Leyland", companyType: "Automotive & Machinery",
                                country: "India", city: "Chennai", state: "Tamil Nadu", capacity: "900 t",
                                phone: "+914423456789", missing: [], access: "claimed", canUpdate: false };

function setup(details: CompanyDetails = SAVED) {
  const submitted: AccountSubmission[] = [];
  render(<AccountScreen onBack={() => undefined} onAccountCreated={(s) => { submitted.push(s); }}
                        onSearchCompanies={vi.fn(async () => [ASHOK])} onLoadCompany={vi.fn(async () => details)} />);
  return submitted;
}
const field = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLSelectElement;

async function pickAshok() {
  fireEvent.focus(field("acc-company"));
  fireEvent.change(field("acc-company"), { target: { value: "ashok" } });
  fireEvent.click((await screen.findByText("Chennai, Tamil Nadu, India")).closest("button")!);
}

function fillPersonal() {
  fireEvent.change(field("acc-first"), { target: { value: "Ravi" } });
  fireEvent.change(field("acc-last"), { target: { value: "Kumar" } });
  fireEvent.change(field("acc-email"), { target: { value: "ravi.kumar@gmail.com" } });
  fireEvent.change(field("acc-dob"), { target: { value: "1991-03-03" } });
}

async function submit() {
  fireEvent.click(field("acc-agree"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create Manufacturer account" })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 800)); });
}

describe("existing company", () => {
  it("loads the saved details read-only and keeps personal information separate", async () => {
    const submitted = setup();
    await pickAshok();
    await waitFor(() => expect(field("acc-company-type").value).toBe("Automotive & Machinery"));
    expect(field("acc-country").value).toBe("India");
    expect(field("acc-phone").value).toBe("4423456789");
    expect(field("acc-capacity").value).toBe("900 t");
    for (const id of ["acc-company-type", "acc-country", "acc-phone", "acc-capacity"]) expect(field(id).disabled).toBe(true);
    for (const id of ["acc-first", "acc-last", "acc-email"]) {
      expect(field(id).value).toBe("");          // never filled from the company
      expect(field(id).disabled).toBe(false);
    }
    fillPersonal();
    await submit();
    expect(submitted[0]).toMatchObject({ companyId: "co-al", email: "ravi.kumar@gmail.com", phone: "+914423456789",
                                         companyType: "Automotive & Machinery", country: "India", capacity: "900 t" });
  });

  it("fields the company does not have stay editable; the phone is then required", async () => {
    const submitted = setup({ ...SAVED, phone: "  ", capacity: "", missing: ["phone", "capacity"] });
    await pickAshok();
    await waitFor(() => expect(field("acc-company-type").disabled).toBe(true));
    expect(field("acc-phone").disabled).toBe(false);
    expect(field("acc-capacity").disabled).toBe(false);
    fillPersonal();
    await submit();
    expect(submitted).toHaveLength(0);
    expect(screen.getByText("Mobile number is required.")).toBeInTheDocument();
  });

  it("choosing a new company makes every company field editable again", async () => {
    setup();
    await pickAshok();
    await waitFor(() => expect(field("acc-capacity").disabled).toBe(true));
    fireEvent.change(field("acc-company"), { target: { value: "Ashok Leyland Spares" } });
    for (const id of ["acc-company-type", "acc-country", "acc-phone", "acc-capacity"]) {
      expect(field(id).disabled).toBe(false);
      expect(field(id).value).toBe("");
    }
  });
});
