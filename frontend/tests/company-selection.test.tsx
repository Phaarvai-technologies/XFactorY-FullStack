/** Manufacturer details form: company search, selection by database id, prefill, stale data. */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountScreen, type AccountSubmission } from "@/components/manufacturer/AccountScreen";
import type { CompanyDetails, CompanySearchResult } from "@/lib/api";

const PUNE: CompanySearchResult = { id: "id-pune", companyName: "Nova Metals", country: "India", city: "Pune", state: "Maharashtra", companyType: "Automotive & Machinery" };
const NAGPUR: CompanySearchResult = { id: "id-nagpur", companyName: "Nova Metals", country: "India", city: "Nagpur", state: null, companyType: "Other" };
const ZETA: CompanySearchResult = { id: "id-zeta", companyName: "Zeta Works", country: "Germany", city: "Berlin", companyType: null };

function details(over: Partial<CompanyDetails>): CompanyDetails {
  return { id: "", companyName: "", companyType: "", country: "", city: "", state: "", capacity: "", phone: "",
           access: "unclaimed", canUpdate: false, ...over };
}

function setup(opts: {
  search?: (q: string) => Promise<CompanySearchResult[]>;
  load?: (id: string) => Promise<CompanyDetails>;
} = {}) {
  const submitted: AccountSubmission[] = [];
  const search = vi.fn(opts.search ?? (async () => [PUNE, NAGPUR]));
  const load = vi.fn(opts.load ?? (async (id: string) =>
    id === "id-pune"
      ? details({ id, companyName: "Nova Metals", companyType: "Automotive & Machinery", country: "India", capacity: "900 t" })
      : details({ id, companyName: "Nova Metals", companyType: "Other", country: "Germany" })));
  render(<AccountScreen onBack={() => undefined} onAccountCreated={(s) => { submitted.push(s); }}
                        onSearchCompanies={search} onLoadCompany={load} />);
  return { submitted, search, load };
}

const input = () => screen.getByLabelText("Company name") as HTMLInputElement;
const select = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;

async function type(text: string) {
  fireEvent.focus(input());
  fireEvent.change(input(), { target: { value: text } });
}

async function fillPersonalAndSubmit() {
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Jo" } });
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Owner" } });
  fireEvent.change(screen.getByLabelText("Email or phone number"), { target: { value: "jo@example.com" } });
  fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: "1990-01-01" } });
  const agree = screen.getByRole("checkbox") as HTMLInputElement;
  if (!agree.checked) fireEvent.click(agree);
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Create Manufacturer account" }));
  await act(async () => { vi.advanceTimersByTime(800); });
  vi.useRealTimers();
}

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

  it("selecting keeps the database id, loads that exact record and submits the id", async () => {
    const { load, submitted } = setup();
    await type("nova");
    fireEvent.click((await screen.findByText("Nagpur, India")).closest("button")!);
    await waitFor(() => expect(load).toHaveBeenCalledWith("id-nagpur"));
    await waitFor(() => expect(select("Company type / category").value).toBe("Other"));
    expect(select("Country / location").value).toBe("Germany");
    expect(input().value).toBe("Nova Metals");
    await fillPersonalAndSubmit();
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ companyId: "id-nagpur", companyName: "Nova Metals", companyType: "Other", country: "Germany" });
  });

  it("editing the text clears the selection and the details copied from it", async () => {
    const { submitted } = setup();
    await type("nova");
    fireEvent.click((await screen.findByText("Pune, Maharashtra, India")).closest("button")!);
    await waitFor(() => expect((screen.getByLabelText(/Production capacity/) as HTMLInputElement).value).toBe("900 t"));
    fireEvent.change(input(), { target: { value: "Nova Metals Ltd" } });
    expect(select("Company type / category").value).toBe("");
    expect(select("Country / location").value).toBe("");
    expect((screen.getByLabelText(/Production capacity/) as HTMLInputElement).value).toBe("");
    fireEvent.change(select("Company type / category"), { target: { value: "Other" } });
    fireEvent.change(select("Country / location"), { target: { value: "India" } });
    await fillPersonalAndSubmit();
    expect(submitted[0]).toMatchObject({ companyId: null, companyName: "Nova Metals Ltd" });
  });

  it("switching companies replaces the details; a late response for the old one is ignored", async () => {
    let releasePune: (d: CompanyDetails) => void = () => undefined;
    const { submitted } = setup({
      load: (id) => id === "id-pune"
        ? new Promise((resolve) => { releasePune = resolve; })
        : Promise.resolve(details({ id, companyName: "Nova Metals", companyType: "Other", country: "Germany" })),
    });
    await type("nova");
    fireEvent.click((await screen.findByText("Pune, Maharashtra, India")).closest("button")!);
    await type("nova");
    fireEvent.click((await screen.findByText("Nagpur, India")).closest("button")!);
    await waitFor(() => expect(select("Country / location").value).toBe("Germany"));
    await act(async () => releasePune(details({ id: "id-pune", companyType: "Automotive & Machinery", country: "India", capacity: "900 t" })));
    expect(select("Country / location").value).toBe("Germany");
    expect((screen.getByLabelText(/Production capacity/) as HTMLInputElement).value).toBe("");
    await fillPersonalAndSubmit();
    expect(submitted[0].companyId).toBe("id-nagpur");
  });

  it("details that fail to load are not kept: error shown, selection dropped", async () => {
    const { submitted } = setup({ load: async () => { throw new Error("500"); } });
    await type("nova");
    fireEvent.click((await screen.findByText("Pune, Maharashtra, India")).closest("button")!);
    await screen.findByText("Couldn’t load this company’s saved details. Select it again to retry.");
    fireEvent.change(select("Company type / category"), { target: { value: "Other" } });
    fireEvent.change(select("Country / location"), { target: { value: "India" } });
    await fillPersonalAndSubmit();
    expect(submitted[0].companyId).toBeNull();
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
    await fillPersonalAndSubmit();
    expect(submitted).toHaveLength(0);
    expect(screen.getByText("Loading the selected company's details…")).toBeInTheDocument();
  });
});
