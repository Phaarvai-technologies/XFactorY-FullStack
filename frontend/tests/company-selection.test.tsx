/**
 * Manufacturer details form (approval-first onboarding, original layout): company search, selection
 * by database id, saved company values filled in and disabled, missing ones editable, new-company
 * entry, stale responses, Indian company phone and personal email validation, corrections mode,
 * server field errors, drafts.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountScreen, type AccountSubmission } from "@/components/manufacturer/AccountScreen";
import { ApiError, type CompanyDetails, type CompanySearchResult } from "@/lib/api";
import { normalizeIndianPhone } from "@/lib/manufacturer/onboarding";

const PUNE: CompanySearchResult = { id: "id-pune", companyName: "Nova Metals", country: "India", city: "Pune", state: "Maharashtra", companyType: "Automotive & Machinery" };
const NAGPUR: CompanySearchResult = { id: "id-nagpur", companyName: "Nova Metals", country: "India", city: "Nagpur", state: null, companyType: "Other" };
const ZETA: CompanySearchResult = { id: "id-zeta", companyName: "Zeta Works", country: "Germany", city: "Berlin", companyType: null };

function details(over: Partial<CompanyDetails>): CompanyDetails {
  return { id: "", companyName: "", companyType: "", country: "", city: "", state: "", location: "", capacity: "",
           phone: "", missing: [], access: "unclaimed", canUpdate: false, ...over };
}
const PUNE_DETAILS = details({ id: "id-pune", companyName: "Nova Metals", companyType: "Automotive & Machinery", country: "India",
                               city: "Pune", state: "Maharashtra", location: "Pune, Maharashtra, India", capacity: "900 t",
                               phone: "+919999900000" });
// Like "Ashok Leyland": category and location saved, no phone, no production capacity
// (a whitespace-only phone counts as missing).
const NAGPUR_DETAILS = details({ id: "id-nagpur", companyName: "Nova Metals", companyType: "Other", country: "India",
                                 city: "Nagpur", location: "Nagpur, India", phone: "   ",
                                 missing: ["companyPhone", "capacity"] });

afterEach(() => vi.useRealTimers());

function setup(opts: {
  search?: (q: string) => Promise<CompanySearchResult[]>;
  load?: (id: string) => Promise<CompanyDetails>;
  create?: (s: AccountSubmission) => Promise<void>;
  props?: Partial<Parameters<typeof AccountScreen>[0]>;
} = {}) {
  const submitted: AccountSubmission[] = [];
  const search = vi.fn(opts.search ?? (async () => [PUNE, NAGPUR]));
  const load = vi.fn(opts.load ?? (async (id: string) => (id === "id-pune" ? PUNE_DETAILS : NAGPUR_DETAILS)));
  render(<AccountScreen onBack={() => undefined}
                        onAccountCreated={opts.create ?? ((s) => { submitted.push(s); })}
                        onSearchCompanies={search} onLoadCompany={load} {...opts.props} />);
  return { submitted, search, load };
}

const input = () => screen.getByLabelText(/^Company name/) as HTMLInputElement;
const byLabel = (label: string | RegExp) => screen.getByLabelText(label) as HTMLInputElement & HTMLSelectElement;
const CATEGORY = /^Company type \/ category/;
const COUNTRY = /^Country \/ location/;
const PHONE = /^Phone number/;
const CAPACITY = /^Production capacity/;

async function type(text: string) {
  fireEvent.focus(input());
  fireEvent.change(input(), { target: { value: text } });
}

function fillPersonal(over: Partial<Record<"first" | "last" | "email" | "dob", string>> = {}) {
  fireEvent.change(byLabel(/^First name/), { target: { value: over.first ?? "Jo" } });
  fireEvent.change(byLabel(/^Last name/), { target: { value: over.last ?? "Owner" } });
  fireEvent.change(byLabel(/^Personal email/), { target: { value: over.email ?? "jo.owner@gmail.com" } });
  fireEvent.change(byLabel(/^Date of birth/), { target: { value: over.dob ?? "1990-01-01" } });
}

async function submit(label = "Create Manufacturer account") {
  const agree = screen.getByRole("checkbox") as HTMLInputElement;
  if (!agree.checked) fireEvent.click(agree);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: label })); });
}

function fillNewCompany(over: Partial<Record<"type" | "country" | "phone" | "capacity", string>> = {}) {
  fireEvent.change(byLabel(CATEGORY), { target: { value: over.type ?? "Other" } });
  fireEvent.change(byLabel(COUNTRY), { target: { value: over.country ?? "India" } });
  fireEvent.change(byLabel(PHONE), { target: { value: over.phone ?? "98765 43210" } });
  fireEvent.change(byLabel(CAPACITY), { target: { value: over.capacity ?? "500 units" } });
}

describe("original layout", () => {
  it("personal info first, then company info, with the original fields", () => {
    setup();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Personal info", "Company info", "Terms & conditions"]);
    for (const label of [/^First name/, /^Last name/, /^Personal email/, /^Date of birth/, /^Company name/,
                         CATEGORY, COUNTRY, PHONE, CAPACITY]) {
      expect(byLabel(label)).toBeInTheDocument();
    }
    expect(byLabel(CATEGORY).tagName).toBe("SELECT");
    expect(byLabel(COUNTRY).tagName).toBe("SELECT");
    expect(screen.queryByText(/Suggest a correction/)).not.toBeInTheDocument();
  });
});

describe("company search and selection", () => {
  it("shows every matching record with its location (same names are not merged)", async () => {
    const { search } = setup();
    await type("  nova ");
    expect(screen.getByText("Searching companies...")).toBeInTheDocument();
    await screen.findByText("Pune, Maharashtra, India");
    expect(screen.getByText("Nagpur, India")).toBeInTheDocument();
    expect(screen.getAllByText("Nova Metals")).toHaveLength(2);
    expect(search).toHaveBeenLastCalledWith("nova");
  });

  it("shows associated users only as far as the backend allows (a count, or the primary user to members)", async () => {
    setup({ search: async () => [{ ...PUNE, registeredUsers: 3 }, { ...NAGPUR, registeredUsers: 1, primaryUser: "Asha Rao" }] });
    await type("nova");
    expect(await screen.findByText("Pune, Maharashtra, India · 3 registered users")).toBeInTheDocument();
    expect(screen.getByText("Nagpur, India · Primary user: Asha Rao")).toBeInTheDocument();
  });

  it("selecting loads that exact record by id, fills the saved details and disables them", async () => {
    const { load, submitted } = setup();
    await type("nova");
    fireEvent.click((await screen.findByText("Pune, Maharashtra, India")).closest("button")!);
    await waitFor(() => expect(load).toHaveBeenCalledWith("id-pune"));
    await waitFor(() => expect(byLabel(CATEGORY).value).toBe("Automotive & Machinery"));
    expect(byLabel(COUNTRY).value).toBe("India");
    expect(byLabel(PHONE).value).toBe("9999900000");                     // shown after the fixed +91
    expect(byLabel(CAPACITY).value).toBe("900 t");
    for (const label of [CATEGORY, COUNTRY, PHONE, CAPACITY]) expect(byLabel(label).disabled).toBe(true);
    // personal information is never taken from the company
    for (const label of [/^First name/, /^Last name/, /^Personal email/]) expect(byLabel(label).value).toBe("");
    fillPersonal();
    await submit();
    expect(submitted).toEqual([{
      firstName: "Jo", lastName: "Owner", personalEmail: "jo.owner@gmail.com", dob: "1990-01-01",
      companyId: "id-pune", companyName: "Nova Metals", companyType: "", country: "", companyPhone: "", capacity: "",
      companyCorrections: null,
    }]);
  });

  it("missing details stay editable; the phone is required and sent with +91 (saved ones are not sent)", async () => {
    const { submitted } = setup();
    await type("nova");
    fireEvent.click((await screen.findByText("Nagpur, India")).closest("button")!);
    await waitFor(() => expect(byLabel(CATEGORY).value).toBe("Other"));
    expect(byLabel(CATEGORY).disabled).toBe(true);
    expect(byLabel(COUNTRY).disabled).toBe(true);
    expect(byLabel(PHONE).disabled).toBe(false);
    expect(byLabel(PHONE).value).toBe("");
    expect(byLabel(CAPACITY).disabled).toBe(false);
    fillPersonal();
    await submit();
    expect(submitted).toHaveLength(0);
    expect(screen.getByText("Enter the company phone number.")).toBeInTheDocument();
    fireEvent.change(byLabel(PHONE), { target: { value: "98765" } });
    await submit();
    expect(screen.getByText(/Enter a valid Indian phone number/)).toBeInTheDocument();
    fireEvent.change(byLabel(PHONE), { target: { value: "98765 43210" } });
    fireEvent.change(byLabel(CAPACITY), { target: { value: "700 t" } });
    await submit();
    expect(submitted[0]).toMatchObject({ companyId: "id-nagpur", companyType: "", country: "",
                                         companyPhone: "+919876543210", capacity: "700 t" });
  });

  it("a saved value of numeric zero is a value (disabled), not missing", async () => {
    setup({ load: async () => ({ ...PUNE_DETAILS, capacity: "0", phone: "" }) });
    await type("nova");
    fireEvent.click((await screen.findByText("Pune, Maharashtra, India")).closest("button")!);
    await waitFor(() => expect(byLabel(CAPACITY).value).toBe("0"));
    expect(byLabel(CAPACITY).disabled).toBe(true);
    expect(byLabel(PHONE).disabled).toBe(false);
  });

  it("a saved category or country outside the form's lists is still shown", async () => {
    setup({ load: async () => ({ ...PUNE_DETAILS, companyType: "Metal Fabrication", country: "Japan" }) });
    await type("nova");
    fireEvent.click((await screen.findByText("Pune, Maharashtra, India")).closest("button")!);
    await waitFor(() => expect(byLabel(CATEGORY).value).toBe("Metal Fabrication"));
    expect(byLabel(COUNTRY).value).toBe("Japan");
  });

  it("editing the name forgets the selection and its values: a new company is editable", async () => {
    const { submitted } = setup();
    await type("nova");
    fireEvent.click((await screen.findByText("Pune, Maharashtra, India")).closest("button")!);
    await waitFor(() => expect(byLabel(CAPACITY).value).toBe("900 t"));
    await type("Nova Metals Ltd");                    // editing the text forgets the selection
    expect(byLabel(CATEGORY).value).toBe("");
    expect(byLabel(COUNTRY).value).toBe("");
    expect(byLabel(PHONE).value).toBe("");
    expect(byLabel(CAPACITY).value).toBe("");
    for (const label of [CATEGORY, COUNTRY, PHONE, CAPACITY]) expect(byLabel(label).disabled).toBe(false);
    fillNewCompany();
    fillPersonal();
    await submit();
    expect(submitted[0]).toMatchObject({ companyId: null, companyName: "Nova Metals Ltd", companyType: "Other",
                                         country: "India", companyPhone: "+919876543210", capacity: "500 units" });
  });

  it("switching companies replaces the details; a late response for the old one is ignored", async () => {
    let releasePune: (d: CompanyDetails) => void = () => undefined;
    const { submitted } = setup({
      load: (id) => id === "id-pune" ? new Promise((resolve) => { releasePune = resolve; }) : Promise.resolve(NAGPUR_DETAILS),
    });
    await type("nova");
    fireEvent.click((await screen.findByText("Pune, Maharashtra, India")).closest("button")!);
    await type("nova");
    fireEvent.click((await screen.findByText("Nagpur, India")).closest("button")!);
    await waitFor(() => expect(byLabel(CATEGORY).value).toBe("Other"));
    await act(async () => releasePune(PUNE_DETAILS));
    expect(byLabel(CATEGORY).value).toBe("Other");
    expect(byLabel(CAPACITY).value).toBe("");
    expect(byLabel(CAPACITY).disabled).toBe(false);
    fillPersonal();
    fireEvent.change(byLabel(PHONE), { target: { value: "9876543210" } });
    await submit();
    expect(submitted[0].companyId).toBe("id-nagpur");
  });

  it("details that fail to load are not kept: error shown, selection dropped", async () => {
    const { submitted } = setup({ load: async () => { throw new Error("500"); } });
    await type("nova");
    fireEvent.click((await screen.findByText("Pune, Maharashtra, India")).closest("button")!);
    await screen.findByText("Couldn’t load this company’s saved details. Select it again to retry.");
    fillPersonal();
    await submit();
    expect(submitted).toHaveLength(0);                 // category, country and phone still required
    expect(screen.getByText("Select a company category.")).toBeInTheDocument();
  });

  it("no matches and search errors use the existing message area", async () => {
    setup({ search: async (q) => (q === "zz" ? [] : Promise.reject(new Error("down"))) });
    await type("zz");
    await screen.findByText("No matching companies found.");
    await type("qq");
    await screen.findByText("Unable to search companies.");
    expect(screen.queryByText("No matching companies found.")).not.toBeInTheDocument();
  });

  it("previous results are not shown for new text while it is being searched", async () => {
    setup({ search: async (q) => (q.startsWith("nova") ? [PUNE] : [ZETA]) });
    await type("nova");
    await screen.findByText("Pune, Maharashtra, India");
    fireEvent.change(input(), { target: { value: "zeta" } });
    expect(screen.queryByText("Pune, Maharashtra, India")).not.toBeInTheDocument();
    await screen.findByText("Berlin, Germany");
  });

  it("cannot submit while the selected company's details are still loading", async () => {
    const { submitted } = setup({ load: () => new Promise(() => undefined) });
    await type("nova");
    fireEvent.click((await screen.findByText("Pune, Maharashtra, India")).closest("button")!);
    fillPersonal();
    await submit();
    expect(submitted).toHaveLength(0);
    expect(screen.getByText("Loading the selected company's details…")).toBeInTheDocument();
  });
});

describe("validation", () => {
  it("company phone and personal email are required and validated separately; capacity is optional", async () => {
    const { submitted } = setup({ search: async () => [] });
    await type("Brand New Works");
    fillNewCompany({ phone: "0000000000", capacity: "" });
    fillPersonal({ email: "not-an-email" });
    await submit();
    expect(submitted).toHaveLength(0);
    expect(screen.getByText(/Enter a valid Indian phone number/)).toBeInTheDocument();
    expect(screen.getByText("Enter a valid personal email address.")).toBeInTheDocument();
    fireEvent.change(byLabel(/^Personal email/), { target: { value: "" } });
    await submit();
    expect(screen.getByText("Enter your personal email address.")).toBeInTheDocument();
    fireEvent.change(byLabel(/^Personal email/), { target: { value: "me@mail.in" } });
    await submit();
    expect(screen.queryByText(/personal email address/)).not.toBeInTheDocument();
    expect(screen.getByText(/Enter a valid Indian phone number/)).toBeInTheDocument();
    fireEvent.change(byLabel(PHONE), { target: { value: "98765-43210" } });   // digits only are kept
    await submit();
    expect(submitted[0]).toMatchObject({ companyPhone: "+919876543210", personalEmail: "me@mail.in", capacity: "" });
  });

  it("first name, last name, date of birth, category and country stay required", async () => {
    const { submitted } = setup({ search: async () => [] });
    await type("Brand New Works");
    await submit();
    expect(submitted).toHaveLength(0);
    for (const text of ["First name is required.", "Last name is required.", "Enter your date of birth.",
                        "Select a company category.", "Select your country.", "Enter the company phone number."]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it("the phone field keeps digits only (max 10) after the fixed +91; landlines with area code are valid", async () => {
    const { submitted } = setup({ search: async () => [] });
    await type("Landline Works");
    fillNewCompany({ phone: "44-2345-6789 ext" });
    expect(byLabel(PHONE).value).toBe("4423456789");
    expect(screen.getByText("+91")).toBeInTheDocument();
    fillPersonal();
    await submit();
    expect(submitted[0].companyPhone).toBe("+914423456789");
  });

  it("Indian phone numbers are normalized like the backend does", () => {
    expect(normalizeIndianPhone("9876543210")).toEqual({ phone: "+919876543210" });
    expect(normalizeIndianPhone("044 2345 6789")).toEqual({ phone: "+914423456789" });
    expect(normalizeIndianPhone("(011) 2345-6789")).toEqual({ phone: "+911123456789" });
    for (const bad of ["", "12345", "0000000000", "+44 20 7946 0000", "+91 98765"]) {
      expect("error" in normalizeIndianPhone(bad)).toBe(true);
    }
  });

  it("an error from the server is shown next to the field it names", async () => {
    setup({
      search: async () => [],
      create: async () => { throw new ApiError(422, "Company type / category is already saved for this company.",
                                               "company_read_only", { field: "companyType" }); },
    });
    await type("Brand New Works");
    fillNewCompany();
    fillPersonal();
    await submit();
    expect(await screen.findByText("Company type / category is already saved for this company.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Manufacturer account" })).not.toBeDisabled();
  });
});

describe("corrections requested by XfactorY", () => {
  it("shows the message and lets only the requested fields change", async () => {
    const { submitted } = setup({
      props: {
        initial: { firstName: "Ravi", lastName: "Kumar", personalEmail: "ravi@gmail.com", dob: "1991-03-03",
                   companyId: null, companyName: "Kumar Tools", companyType: "Other", country: "India",
                   companyPhone: "+919876543210", capacity: "50 t" },
        corrections: { fields: ["companyPhone", "dob"], feedback: "Please check the phone and date of birth." },
      },
    });
    expect(screen.getByText("Please check the phone and date of birth.")).toBeInTheDocument();
    expect(byLabel(/^First name/).disabled).toBe(true);
    expect(byLabel(/^Personal email/).disabled).toBe(true);
    expect(byLabel(CAPACITY).disabled).toBe(true);
    expect(byLabel(CATEGORY).disabled).toBe(true);
    expect(input().disabled).toBe(true);
    expect(byLabel(PHONE).disabled).toBe(false);
    expect(byLabel(/^Date of birth/).disabled).toBe(false);
    fireEvent.change(byLabel(PHONE), { target: { value: "91234 56789" } });
    await submit("Send corrections");
    expect(submitted[0]).toMatchObject({ companyId: null, companyName: "Kumar Tools", companyPhone: "+919123456789",
                                         firstName: "Ravi", dob: "1991-03-03", capacity: "50 t" });
  });

  it("existing company: saved values stay disabled even when a correction is requested", async () => {
    setup({
      props: {
        initial: { firstName: "Ravi", lastName: "Kumar", personalEmail: "ravi@gmail.com", dob: "1991-03-03",
                   companyId: "id-nagpur", companyName: "Nova Metals", companyType: "Other", country: "India",
                   companyPhone: "+919876543210", capacity: "" },
        corrections: { fields: ["companyPhone", "companyType"], feedback: "Phone does not answer." },
      },
    });
    await waitFor(() => expect(byLabel(CATEGORY).value).toBe("Other"));
    expect(byLabel(CATEGORY).disabled).toBe(true);           // saved on the company: never editable here
    expect(byLabel(PHONE).disabled).toBe(false);             // missing on the company + asked for
    expect(byLabel(PHONE).value).toBe("9876543210");         // what the applicant sent before
  });
});

describe("draft", () => {
  it("the unsent form is kept (debounced) and nothing else happens", async () => {
    vi.useFakeTimers();
    const saveDraft = vi.fn();
    setup({ search: async () => [], props: { onSaveDraft: saveDraft } });
    fireEvent.change(byLabel(/^First name/), { target: { value: "Dee" } });
    fireEvent.change(byLabel(/^Personal email/), { target: { value: "dee@mail.in" } });
    expect(saveDraft).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1300); });
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(saveDraft.mock.calls[0][0]).toMatchObject({ firstName: "Dee", personalEmail: "dee@mail.in", companyId: null });
  });
});
