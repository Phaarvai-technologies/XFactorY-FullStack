import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountScreen } from "@/components/manufacturer/AccountScreen";
import type { ClaimRequest } from "@/components/manufacturer/CompanyClaimPanel";

type Company = {
  id: string; name: string; city: string | null; state: string | null; postalCode: string | null;
  country: string | null; sector: string | null; products: string | null; website: string | null;
  category?: string | null; capacity?: string | null;
};

const C = (id: string, name: string, extra: Partial<Company> = {}): Company => ({
  id, name, city: null, state: null, postalCode: null, country: "India", sector: null, products: null,
  website: null, ...extra,
});

// "Alpha Castings" existed before the seed; the others were seeded (no owner, no import record).
const DB: Company[] = [
  C("11111111-aaaa-4000-8000-000000000001", "Alpha Castings Pvt Ltd", { city: "Coimbatore", state: "Tamil Nadu" }),
  C("22222222-aaaa-4000-8000-000000000002", "AL AKSAA CNC", { city: "Hosur", state: "Tamil Nadu", postalCode: "635109",
    category: "Automotive & Machinery", capacity: "500 parts/month" }),
  C("33333333-aaaa-4000-8000-000000000003", "Precision Engineering", { city: "Chennai", state: "Tamil Nadu" }),
  C("44444444-aaaa-4000-8000-000000000004", "Precision Engineering", { city: "Tiruchirappalli", state: "Tamil Nadu" }),
  C("55555555-aaaa-4000-8000-000000000005", "Aero Precision Engineering", { city: "Hosur", country: "Germany" }),
];

/** Fake backend: same matching rules as the API (trimmed, case-insensitive, starts-with first). */
function backend(options: { failSearch?: boolean; delays?: Record<string, number> } = {}) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === "/manufacturer/claims" && !init?.method) return { claims: [] };
    if (path.startsWith("/manufacturer/claims/search")) {
      const q = new URL(path, "http://x").searchParams.get("q")!.trim().toLowerCase();
      if (options.delays?.[q]) await new Promise((r) => setTimeout(r, options.delays![q]));
      if (options.failSearch) throw new Error("API request failed");
      const starts = DB.filter((c) => c.name.toLowerCase().startsWith(q));
      const contains = DB.filter((c) => !starts.includes(c) && c.name.toLowerCase().includes(q));
      return { query: q, hasMore: false, results: [...starts, ...contains].map((c) => ({ ...c, exactName: false })) };
    }
    const detail = path.match(/^\/manufacturer\/claims\/companies\/(.+)$/);
    if (detail) {
      const c = DB.find((x) => x.id === decodeURIComponent(detail[1]))!;
      return { category: null, capacity: null, ...c };
    }
    if (path === "/manufacturer/claims" && init?.method === "POST") {
      const id = JSON.parse(String(init.body)).organizationId;
      const c = DB.find((x) => x.id === id)!;
      return { id: "claim-1", status: "pending", method: "admin_review", reason: null,
               company: { id, name: c.name, city: c.city, state: c.state } };
    }
    throw new Error(`unexpected ${path}`);
  }) as unknown as ClaimRequest;
  return { request, calls };
}

function setup(api = backend()) {
  const onAccountCreated = vi.fn();
  render(
    <div className="mfg-root">
      <AccountScreen onBack={() => undefined} onAccountCreated={onAccountCreated} request={api.request} />
    </div>,
  );
  const input = screen.getByLabelText("Company name") as HTMLInputElement;
  return { ...api, input, onAccountCreated };
}

// dropdown entries only (the form's <select> boxes also contain role="option" elements)
const items = () => Array.from(document.querySelectorAll<HTMLElement>(".company-dd [role=option]"));
const names = () => items().map((o) => o.querySelector(".company-dd-name")?.textContent);
const metas = () => items().map((o) => o.querySelector(".company-dd-meta")?.textContent);
const selectedId = () =>
  document.querySelector("[data-selected-company-id]")?.getAttribute("data-selected-company-id") ?? null;
const field = (label: string | RegExp) => screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement;

describe("company name dropdown", () => {
  it("shows existing and newly seeded companies from the first letter, starts-with first", async () => {
    const { input, calls } = setup();
    await userEvent.type(input, "A");
    await waitFor(() => expect(names()).toEqual(["Alpha Castings Pvt Ltd", "AL AKSAA CNC", "Aero Precision Engineering"]));
    expect(calls.some((c) => c.path === "/manufacturer/claims/search?q=A")).toBe(true);
    expect(input).toHaveAttribute("autocomplete", "off"); // no stale browser-history list
  });

  it("matches partial and full names regardless of case and outer spaces", async () => {
    const { input } = setup();
    await userEvent.type(input, "  preCISion ");
    await waitFor(() => expect(names()).toHaveLength(3));
    // starts-with matches first, partial match after; same-name companies told apart by location
    expect(metas()[0]).toContain("Chennai");
    expect(metas()[1]).toContain("Tiruchirappalli");
    expect(names()[2]).toBe("Aero Precision Engineering");
    await userEvent.clear(input);
    await userEvent.type(input, "PRECISION ENGINEERING");
    await waitFor(() => expect(names()).toHaveLength(3));
  });

  it("selecting a seeded company keeps its database id and loads that exact record", async () => {
    const { input, calls } = setup();
    await userEvent.type(input, "precision");
    await waitFor(() => expect(names()).toHaveLength(3));
    await userEvent.click(items()[1]); // the Tiruchirappalli one
    expect(input.value).toBe("Precision Engineering");
    await waitFor(() => expect(selectedId()).toBe("44444444-aaaa-4000-8000-000000000004"));
    expect(calls.some((c) => c.path === "/manufacturer/claims/companies/44444444-aaaa-4000-8000-000000000004")).toBe(true);
    expect(screen.getByText(/Tiruchirappalli/)).toBeInTheDocument();
    expect(field("Country / location").value).toBe("India");
    // selecting does not claim anything
    expect(calls.some((c) => c.init?.method === "POST")).toBe(false);
    // the claim is a separate, explicit step and uses the selected id
    await userEvent.click(screen.getByRole("button", { name: "Claim this company" }));
    await waitFor(() => expect(screen.getByText(/waiting for review/)).toBeInTheDocument());
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(JSON.parse(String(post.init!.body))).toEqual({ organizationId: "44444444-aaaa-4000-8000-000000000004" });
  });

  it("changing the selection loads the new company without stale values", async () => {
    const { input } = setup();
    await userEvent.type(input, "al a");
    await waitFor(() => expect(names()).toContain("AL AKSAA CNC"));
    await userEvent.click(items().find((o) => o.textContent?.includes("AL AKSAA CNC"))!);
    await waitFor(() => expect(selectedId()).toBe("22222222-aaaa-4000-8000-000000000002"));
    expect(field("Company type / category").value).toBe("Automotive & Machinery");
    expect(field(/Production capacity/).value).toBe("500 parts/month");

    await userEvent.clear(input);
    await userEvent.type(input, "aero");
    await waitFor(() => expect(names()).toEqual(["Aero Precision Engineering"]));
    await userEvent.click(items()[0]);
    await waitFor(() => expect(selectedId()).toBe("55555555-aaaa-4000-8000-000000000005"));
    // the previous company's category / capacity are gone; the new record has none
    expect(field("Company type / category").value).toBe("");
    expect(field(/Production capacity/).value).toBe("");
    expect(field("Country / location").value).toBe("Germany");
  });

  it("editing the name after selecting clears the selection and its details", async () => {
    const { input } = setup();
    await userEvent.selectOptions(field("Country / location"), "United Kingdom");
    await userEvent.type(input, "al aksaa");
    await waitFor(() => expect(names()).toEqual(["AL AKSAA CNC"]));
    await userEvent.click(items()[0]);
    await waitFor(() => expect(selectedId()).toBe("22222222-aaaa-4000-8000-000000000002"));
    expect(field("Country / location").value).toBe("India");
    await userEvent.type(input, "x");
    expect(selectedId()).toBeNull();
    expect(screen.queryByRole("button", { name: "Claim this company" })).not.toBeInTheDocument();
    // the user's own earlier choice comes back; the company's category / capacity are removed
    expect(field("Country / location").value).toBe("United Kingdom");
    expect(field("Company type / category").value).toBe("");
    expect(field(/Production capacity/).value).toBe("");
  });

  it("an older, slower response never replaces results for newer input", async () => {
    const { input } = setup(backend({ delays: { a: 600 } }));
    await userEvent.type(input, "A");
    await act(() => new Promise((r) => setTimeout(r, 250))); // the "a" request is in flight
    await userEvent.type(input, "ero");
    await waitFor(() => expect(names()).toEqual(["Aero Precision Engineering"]));
    await act(() => new Promise((r) => setTimeout(r, 700))); // the slow "a" answer arrives late
    expect(names()).toEqual(["Aero Precision Engineering"]);
  });

  it("shows a loading state, then no-match", async () => {
    const { input } = setup(backend({ delays: { zzz: 300 } }));
    await userEvent.type(input, "zzz");
    expect(await screen.findByText(/Searching listed companies/)).toBeInTheDocument();
    expect(await screen.findByText(/No listed company matches “zzz”/)).toBeInTheDocument();
  });

  it("shows a failure state with retry", async () => {
    const { input } = setup(backend({ failSearch: true }));
    await userEvent.type(input, "al");
    expect(await screen.findByText(/Couldn’t load companies/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("keyboard: arrows + Enter pick a company without submitting the form", async () => {
    const { input, onAccountCreated } = setup();
    await userEvent.type(input, "precision");
    await waitFor(() => expect(names()).toHaveLength(3));
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    await waitFor(() => expect(selectedId()).toBe("44444444-aaaa-4000-8000-000000000004"));
    expect(onAccountCreated).not.toHaveBeenCalled();
  });
});


it("retains selected ID while details load and after a detail failure", async () => {
  const normal = backend();
  let rejectDetail: (error: Error) => void = () => undefined;
  const request: ClaimRequest = <T,>(path: string, init?: RequestInit): Promise<T> => {
    if (path.includes("/claims/companies/")) {
      return new Promise<T>((_resolve, reject) => { rejectDetail = reject; });
    }
    return normal.request<T>(path, init);
  };
  const { input } = setup({ request, calls: normal.calls });
  await userEvent.type(input, "al aksaa");
  await waitFor(() => expect(names()).toEqual(["AL AKSAA CNC"]));
  await userEvent.click(items()[0]);
  expect(selectedId()).toBe("22222222-aaaa-4000-8000-000000000002");
  await act(async () => rejectDetail(new Error("Details unavailable")));
  expect(selectedId()).toBe("22222222-aaaa-4000-8000-000000000002");
  await userEvent.type(input, "x");
  expect(selectedId()).toBeNull();
});
