/**
 * "Find a Manufacturer": the cards come from the backend's match of the Visionary's SAVED
 * requirements (GET /visionary/manufacturers/matches), never an unfiltered list. The chips show
 * the requirements the backend matched with; search narrows the matches by name, product or
 * machine; empty results, loading and errors are separate; an answer for older requirements is
 * never shown.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManufacturerResults } from "@/components/visionary/ManufacturerResults";
import type { ManufacturerMatches } from "@/lib/visionary/api";
import type { VisionaryRequirements } from "@/lib/visionary/storage";
import { getVisionaryData, setVisionaryData } from "@/lib/visionary/store";

const matches = vi.fn<() => Promise<ManufacturerMatches>>();
vi.mock("@/lib/visionary/api", () => ({
  useVisionaryApi: () => ({ matches, manufacturers: vi.fn() }),
  errorMessage: (_e: unknown, fallback: string) => fallback,
}));

const REQ: VisionaryRequirements = {
  manufacturing_location: "Chennai",
  quantity: { value: 1000, unit: "units" },
  budget: { amount: 2000, currency: "INR" },
  timeline: "immediately",
  additional_requirements: "",
  machines: ["Injection Moulding", "CNC Machining"],
};

function card(id: string, name: string, extra: Partial<ManufacturerMatches["manufacturers"][number]> = {}) {
  return {
    id, name, location: "Chennai, Tamil Nadu", category: "Automotive & Machinery", capabilities: "", about: "",
    machines: ["CNC Machining"], products: ["Brackets"], capacity: 0, moq: 0, availability: "Available",
    logo: null, verified: false, status: "active" as const, matchedMachines: ["CNC Machining"], ...extra,
  };
}

const NOT_COMPARED: ManufacturerMatches["notCompared"] = [
  { field: "quantity", reason: "q" }, { field: "budget", reason: "b" }, { field: "timeline", reason: "t" },
];

function answer(manufacturers: ManufacturerMatches["manufacturers"], requirements: VisionaryRequirements | null = REQ): ManufacturerMatches {
  return { requirements, applied: requirements ? ["location", "machines"] : [], notCompared: requirements ? NOT_COMPARED : [], manufacturers };
}

function save(requirements: VisionaryRequirements | null) {
  setVisionaryData({ profile: null, idea: null, stage: "Idea Stage", requirements, requests: [] });
}

function page() {
  return render(<ManufacturerResults onContinue={() => {}} onSelect={() => {}} onChoose={() => {}} selectedId={null} />);
}

beforeEach(() => {
  matches.mockReset();
  window.sessionStorage.clear();
  save(REQ);
});

describe("Find a Manufacturer", () => {
  it("shows only the backend's matches, with the requirement chips it matched with", async () => {
    matches.mockResolvedValue(answer([card("a", "Alpha CNC", { matchedMachines: ["Injection Moulding", "CNC Machining"] }), card("b", "Beta Tools")]));
    await act(async () => { page(); });
    expect(matches).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Alpha CNC")).toBeInTheDocument();
    expect(screen.getByText("Beta Tools")).toBeInTheDocument();
    expect(screen.queryByText("Tec Info")).toBeNull();
    const chips = Array.from(document.querySelectorAll(".reqs span.c")).map((c) => c.textContent);
    expect(chips).toEqual(["Chennai", "1,000 units", "₹2,000", "Immediately", "Injection Moulding", "CNC Machining"]);
    expect(screen.getByText("Matched on location and machines. Quantity, budget and timeline are shown for reference only: manufacturer profiles don't record the data to compare them with.")).toBeInTheDocument();
  });

  it("no match → 'No matching manufacturers found' (no fallback to other manufacturers)", async () => {
    matches.mockResolvedValue(answer([]));
    await act(async () => { page(); });
    expect(screen.getByText("No matching manufacturers found")).toBeInTheDocument();
    expect(screen.getByText(/No manufacturer matches your requirements yet/)).toBeInTheDocument();
    expect(document.querySelectorAll("article.mcard")).toHaveLength(0);
  });

  it("no saved requirements → asks for them, lists nothing", async () => {
    save(null);
    matches.mockResolvedValue(answer([], null));
    await act(async () => { page(); });
    expect(screen.getByText("No matching manufacturers found")).toBeInTheDocument();
    expect(screen.getByText(/Add your manufacturing requirements/)).toBeInTheDocument();
  });

  it("search narrows the matches by company name, product or machine (not location / category)", async () => {
    matches.mockResolvedValue(answer([
      card("a", "Alpha CNC", { products: ["Gears"], machines: ["CNC Machining"] }),
      card("b", "Beta Plastics", { products: ["Bottle caps"], machines: ["Injection Moulding"], matchedMachines: ["Injection Moulding"] }),
    ]));
    await act(async () => { page(); });
    const search = screen.getByPlaceholderText("Search by name, product or machine");
    const names = () => Array.from(document.querySelectorAll("article.mcard h3")).map((h) => h.textContent);
    fireEvent.change(search, { target: { value: "beta" } });
    expect(names()).toEqual(["Beta Plastics"]);
    fireEvent.change(search, { target: { value: "gears" } });
    expect(names()).toEqual(["Alpha CNC"]);
    fireEvent.change(search, { target: { value: "injection" } });
    expect(names()).toEqual(["Beta Plastics"]);
    fireEvent.change(search, { target: { value: "tamil nadu" } }); // location is not a search field
    expect(names()).toEqual([]);
    expect(screen.getByText("No matching manufacturers found")).toBeInTheDocument();
    expect(screen.getByText("Try changing your search.")).toBeInTheDocument();
  });

  it("loading, then an API error is shown separately, and Try Again asks the server again", async () => {
    let fail!: (e: Error) => void;
    matches.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    page();
    expect(document.querySelector("section.grid")?.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("No matching manufacturers found")).toBeNull();
    await act(async () => fail(new Error("500")));
    expect(screen.getByText("Unable to load manufacturers")).toBeInTheDocument();
    expect(screen.queryByText("No matching manufacturers found")).toBeNull();
    matches.mockResolvedValueOnce(answer([card("a", "Alpha CNC")]));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try Again" })));
    expect(matches).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Alpha CNC")).toBeInTheDocument();
  });

  it("requirements changed while an older answer is on its way → only the new answer is shown", async () => {
    let old!: (v: ManufacturerMatches) => void;
    matches.mockImplementationOnce(() => new Promise((resolve) => { old = resolve; }));
    const NEW = { ...REQ, manufacturing_location: "Coimbatore", machines: ["Laser Cutting"] };
    matches.mockResolvedValueOnce(answer([card("n", "New Laser Co", { location: "Coimbatore, Tamil Nadu", machines: ["Laser Cutting"], matchedMachines: ["Laser Cutting"] })], NEW));
    const view = page();
    save(NEW); // saved on the requirements step (store replaced by the server's answer)
    await act(async () => {
      view.rerender(<ManufacturerResults onContinue={() => {}} onSelect={() => {}} onChoose={() => {}} selectedId={null} />);
    });
    await waitFor(() => expect(screen.getByText("New Laser Co")).toBeInTheDocument());
    await act(async () => old(answer([card("o", "Old Chennai Co")]))); // late answer for the old requirements
    expect(screen.queryByText("Old Chennai Co")).toBeNull();
    expect(Array.from(document.querySelectorAll(".reqs span.c")).map((c) => c.textContent)).toContain("Coimbatore");
  });

  it("machines from an earlier browser session never mix into the saved requirements", () => {
    window.sessionStorage.setItem("xy-visionary-machines", JSON.stringify(["Welding"]));
    save({ ...REQ, machines: [] });
    expect(getVisionaryData().requirements?.machines).toEqual([]);
  });
});
