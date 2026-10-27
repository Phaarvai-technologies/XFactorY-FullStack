/**
 * Manufacturer details form (AccountScreen): company search, selecting an existing company record,
 * new companies, validation and corrections. Matches the current form: personal info (first and
 * last name, email address, optional date of birth), then company info (company name with live
 * search, category, country, +91 mobile number, optional capacity).
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountScreen, type AccountSubmission } from "@/components/manufacturer/AccountScreen";
import type { CompanyDetails, CompanySearchResult } from "@/lib/api";

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
// Saved category and country only; phone and capacity are missing on the record
// (a whitespace-only phone counts as missing).
const NAGPUR_DETAILS = details({ id: "id-nagpur", companyName: "Nova Metals", companyType: "Other", country: "India",
                                 city: "Nagpur", location: "Nagpur, India", phone: "   ",
                                 missing: ["companyPhone", "capacity"] });

function setup(opts: {
  search?: (q: string) => Promise<CompanySearchResult[]>;
  load?: (id: string) => Promise<CompanyDetails>;
  props?: Partial<Parameters<typeof AccountScreen>[0]>;
} = {}) {
  const submitted: AccountSubmission[] = [];
  const search = vi.fn(opts.search ?? (async () => [PUNE, NAGPUR]));
  const load = vi.fn(opts.load ?? (async (id: string) => (id === "id-pune" ? PUNE_DETAILS : NAGPUR_DETAILS)));
  render(<AccountScreen onBack={() => undefined} onAccountCreated={(s) => { submitted.push(s); }}
                        onSearchCompanies={search} onLoadCompany={load} {...opts.props} />);
  return { submitted, search, load };
}

const input = () => screen.getByLabelText(/^Company name/) as HTMLInputElement;
const byLabel = (label: string | RegExp) => screen.getByLabelText(label) as HTMLInputElement & HTMLSelectElement;
const CATEGORY = /^Company type \/ category/;
const COUNTRY = /^Country \/ location/;
const PHONE = /^Phone number/;
const CAPACITY = /^Production capacity/;
const EMAIL = /^Email address/;

async function type(text: string) {
  fireEvent.focus(input());
  fireEvent.change(input(), { target: { value: text } });
}

function fillPersonal(over: Partial<Record<"first" | "last" | "email" | "dob", string>> = {}) {
  fireEvent.change(byLabel(/^First name/), { target: { value: over.first ?? "Jo" } });
  fireEvent.change(byLabel(/^Last name/), { target: { value: over.last ?? "Owner" } });
  fireEvent.change(byLabel(EMAIL), { target: { value: over.email ?? "jo.owner@gmail.com" } });
  if (over.dob !== undefined) fireEvent.change(byLabel(/^Date of birth/), { target: { value: over.dob } });
}

async function submit() {
  const agree = screen.getByRole("checkbox") as HTMLInputElement;
  if (!agree.checked) fireEvent.click(agree);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create Manufacturer account" })); });
}

/** The form waits briefly ("Creating account…") before handing the details over. */
async function submitted(list: AccountSubmission[], count = 1) {
  await waitFor(() => expect(list).toHaveLength(count), { timeout: 2000 });
}

function fillNewCompany(over: Partial<Record<"type" | "country" | "phone" | "capacity", string>> = {}) {
  fireEvent.change(byLabel(CATEGORY), { target: { value: over.type ?? "Other" } });
  fireEvent.change(byLabel(COUNTRY), { target: { value: over.country ?? "India" } });
  fireEvent.change(byLabel(PHONE), { target: { value: over.phone ?? "98765 43210" } });
  fireEvent.change(byLabel(CAPACITY), { target: { value: over.capacity ?? "500 units" } });
}

async function pick(location: string) {
  fireEvent.click((await screen.findByText(location)).closest("button")!);
}

describe("layout", () => {
  it("personal info first, then company info, with the current fields", () => {
    setup();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Personal info", "Company info", "Terms & conditions"]);
    for (const label of [/^First name/, /^Last name/, EMAIL, /^Date of birth/, /^Company name/,
                         CATEGORY, COUNTRY, PHONE, CAPACITY]) {
      expect(byLabel(label)).toBeInTheDocument();
    }
    expect(byLabel(CATEGORY).tagName).toBe("SELECT");
    expect(byLabel(COUNTRY).tagName).toBe("SELECT");
    expect(screen.getByText("+91")).toBeInTheDocument();
  });
});

describe("company search and selection", () => {
  it("shows every matching record with its location (same names are not merged)", async () => {
    const { search } = setup();
    await type("  nova ");
    await screen.findByText("Pune, Maharashtra, India");
    expect(screen.getByText("Nagpur, India")).toBeInTheDocument();
    expect(screen.getAllByText("Nova Metals")).toHaveLength(2);
    expect(search).toHaveBeenLastCalledWith("nova");
  });

  it("selecting loads that exact record by id, fills the saved details and disables them", async () => {
    const { load, submitted: sent } = setup();
    await type("nova");
    await pick("Pune, Maharashtra, India");
    await waitFor(() => expect(load).toHaveBeenCalledWith("id-pune"));
    await waitFor(() => expect(byLabel(CATEGORY).value).toBe("Automotive & Machinery"));
    expect(byLabel(COUNTRY).value).toBe("India");
    expect(byLabel(PHONE).value).toBe("9999900000");                     // shown after the fixed +91
    expect(byLabel(CAPACITY).value).toBe("900 t");
    for (const label of [CATEGORY, COUNTRY, PHONE, CAPACITY]) expect(byLabel(label).disabled).toBe(true);
    // personal information is never taken from the company
    for (const label of [/^First name/, /^Last name/, EMAIL]) expect(byLabel(label).value).toBe("");
    fillPersonal();
    await submit();
    await submitted(sent);
    expect(sent[0]).toEqual({
      firstName: "Jo", lastName: "Owner", email: "jo.owner@gmail.com", dob: null,
      companyId: "id-pune", companyName: "Nova Metals", companyType: "Automotive & Machinery", country: "India",
      phone: "+919999900000", capacity: "900 t",                         // the saved phone is sent unchanged
    });
  });

  it("missing details stay editable; the mobile number is required and sent with +91", async () => {
    const { submitted: sent } = setup();
    await type("nova");
    await pick("Nagpur, India");
    await waitFor(() => expect(byLabel(CATEGORY).value).toBe("Other"));
    expect(byLabel(CATEGORY).disabled).toBe(true);
    expect(byLabel(COUNTRY).disabled).toBe(true);
    expect(byLabel(PHONE).disabled).toBe(false);
    expect(byLabel(PHONE).value).toBe("");
    expect(byLabel(CAPACITY).disabled).toBe(false);
    fillPersonal();
    await submit();
    expect(screen.getByText("Mobile number is required.")).toBeInTheDocument();
    fireEvent.change(byLabel(PHONE), { target: { value: "98765" } });
    await submit();
    expect(screen.getByText(/Enter a valid 10-digit Indian mobile number/)).toBeInTheDocument();
    fireEvent.change(byLabel(PHONE), { target: { value: "98765 43210" } });
    fireEvent.change(byLabel(CAPACITY), { target: { value: "700 t" } });
    await submit();
    await submitted(sent);
    expect(sent[0]).toMatchObject({ companyId: "id-nagpur", phone: "+919876543210", capacity: "700 t" });
  });

  it("a saved value of numeric zero is a value (disabled), not missing", async () => {
    setup({ load: async () => ({ ...PUNE_DETAILS, capacity: "0", phone: "" }) });
    await type("nova");
    await pick("Pune, Maharashtra, India");
    await waitFor(() => expect(byLabel(CAPACITY).value).toBe("0"));
    expect(byLabel(CAPACITY).disabled).toBe(true);
    expect(byLabel(PHONE).disabled).toBe(false);
  });

  it("a saved category or country outside the form's lists is still shown", async () => {
    setup({ load: async () => ({ ...PUNE_DETAILS, companyType: "Metal Fabrication", country: "Japan" }) });
    await type("nova");
    await pick("Pune, Maharashtra, India");
    await waitFor(() => expect(byLabel(CATEGORY).value).toBe("Metal Fabrication"));
    expect(byLabel(COUNTRY).value).toBe("Japan");
  });

  it("editing the name forgets the selection and its values: a new company is editable", async () => {
    const { submitted: sent } = setup();
    await type("nova");
    await pick("Pune, Maharashtra, India");
    await waitFor(() => expect(byLabel(CAPACITY).value).toBe("900 t"));
    await type("Nova Metals Ltd");                    // editing the text forgets the selection
    for (const label of [CATEGORY, COUNTRY, PHONE, CAPACITY]) {
      expect(byLabel(label).value).toBe("");
      expect(byLabel(label).disabled).toBe(false);
    }
    fillNewCompany();
    fillPersonal();
    await submit();
    await submitted(sent);
    expect(sent[0]).toMatchObject({ companyId: null, companyName: "Nova Metals Ltd", companyType: "Other",
                                    country: "India", phone: "+919876543210", capacity: "500 units" });
  });

  it("switching companies replaces the details; a late response for the old one is ignored", async () => {
    let releasePune: (d: CompanyDetails) => void = () => undefined;
    const { submitted: sent } = setup({
      load: (id) => id === "id-pune" ? new Promise((resolve) => { releasePune = resolve; }) : Promise.resolve(NAGPUR_DETAILS),
    });
    await type("nova");
    await pick("Pune, Maharashtra, India");
    await type("nova");
    await pick("Nagpur, India");
    await waitFor(() => expect(byLabel(CATEGORY).value).toBe("Other"));
    await act(async () => releasePune(PUNE_DETAILS));
    expect(byLabel(CATEGORY).value).toBe("Other");
    expect(byLabel(CAPACITY).value).toBe("");
    expect(byLabel(CAPACITY).disabled).toBe(false);
    fillPersonal();
    fireEvent.change(byLabel(PHONE), { target: { value: "9876543210" } });
    await submit();
    await submitted(sent);
    expect(sent[0].companyId).toBe("id-nagpur");
  });

  it("details that fail to load are not kept: error shown, selection dropped", async () => {
    const { submitted: sent } = setup({ load: async () => { throw new Error("500"); } });
    await type("nova");
    await pick("Pune, Maharashtra, India");
    await screen.findByText("Couldn’t load this company’s saved details. Select it again to retry.");
    fillPersonal();
    await submit();
    expect(sent).toHaveLength(0);                     // category, country and phone still required
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
    const { submitted: sent } = setup({ load: () => new Promise(() => undefined) });
    await type("nova");
    await pick("Pune, Maharashtra, India");
    fillPersonal();
    await submit();
    expect(sent).toHaveLength(0);
    expect(screen.getByText("Loading the selected company's details…")).toBeInTheDocument();
  });
});

describe("validation", () => {
  it("email is required and validated; capacity and date of birth are optional", async () => {
    const { submitted: sent } = setup({ search: async () => [] });
    await type("Brand New Works");
    fillNewCompany({ capacity: "" });
    fillPersonal({ email: "not-an-email" });
    await submit();
    expect(sent).toHaveLength(0);
    expect(screen.getByText("Please enter a valid email address.")).toBeInTheDocument();
    fireEvent.change(byLabel(EMAIL), { target: { value: "" } });
    await submit();
    expect(screen.getByText("Email address is required.")).toBeInTheDocument();
    fireEvent.change(byLabel(EMAIL), { target: { value: "me@mail.in" } });
    await submit();
    await submitted(sent);
    expect(sent[0]).toMatchObject({ email: "me@mail.in", phone: "+919876543210", capacity: "", dob: null });
  });

  it("first name, last name, email, category, country and mobile number are required", async () => {
    const { submitted: sent } = setup({ search: async () => [] });
    await type("Brand New Works");
    await submit();
    expect(sent).toHaveLength(0);
    for (const text of ["First name is required.", "Last name is required.", "Email address is required.",
                        "Select a company category.", "Select your country.", "Mobile number is required."]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it("the mobile field keeps digits only (max 10) after the fixed +91 and must start with 6-9", async () => {
    const { submitted: sent } = setup({ search: async () => [] });
    await type("Mobile Works");
    fillNewCompany({ phone: "98-7654-3210 ext 12" });
    expect(byLabel(PHONE).value).toBe("9876543210");
    fireEvent.change(byLabel(PHONE), { target: { value: "" } });
    fireEvent.change(byLabel(PHONE), { target: { value: "4423456789" } });   // not a mobile number
    expect(byLabel(PHONE).value).toBe("");
    fireEvent.change(byLabel(PHONE), { target: { value: "9123456789" } });
    fillPersonal({ dob: "1990-01-01" });
    await submit();
    await submitted(sent);
    expect(sent[0]).toMatchObject({ phone: "+919123456789", dob: "1990-01-01" });
  });
});

describe("corrections requested by XfactorY", () => {
  it("only the requested fields can change; the rest is sent as before", async () => {
    const { submitted: sent } = setup({
      props: {
        initial: { firstName: "Ravi", lastName: "Kumar", email: "ravi@gmail.com", dob: "1991-03-03",
                   companyId: null, companyName: "Kumar Tools", companyType: "Other", country: "India",
                   phone: "+919876543210", capacity: "50 t" },
        correctionFields: ["companyPhone", "dob"],
      },
    });
    expect(byLabel(/^First name/).disabled).toBe(true);
    expect(byLabel(EMAIL).disabled).toBe(true);
    expect(byLabel(CAPACITY).disabled).toBe(true);
    expect(byLabel(CATEGORY).disabled).toBe(true);
    expect(input().disabled).toBe(true);
    expect(byLabel(PHONE).disabled).toBe(false);
    expect(byLabel(PHONE).value).toBe("9876543210");
    expect(byLabel(/^Date of birth/).disabled).toBe(false);
    fireEvent.change(byLabel(PHONE), { target: { value: "91234 56789" } });
    await submit();
    await submitted(sent);
    expect(sent[0]).toMatchObject({ companyId: null, companyName: "Kumar Tools", phone: "+919123456789",
                                    firstName: "Ravi", dob: "1991-03-03", capacity: "50 t" });
  });

  it("existing company: saved values stay disabled even when a correction is requested", async () => {
    setup({
      props: {
        initial: { firstName: "Ravi", lastName: "Kumar", email: "ravi@gmail.com", dob: "1991-03-03",
                   companyId: "id-nagpur", companyName: "Nova Metals", companyType: "Other", country: "India",
                   phone: "+919876543210", capacity: "" },
        correctionFields: ["companyPhone", "companyType"],
      },
    });
    await waitFor(() => expect(byLabel(CATEGORY).value).toBe("Other"));
    expect(byLabel(CATEGORY).disabled).toBe(true);           // saved on the company: never editable here
    expect(byLabel(PHONE).disabled).toBe(false);             // missing on the company + asked for
  });
});
