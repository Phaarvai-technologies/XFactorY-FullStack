import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { StepStage } from "@/components/visionary/StepStage";
import { StepGuide } from "@/components/visionary/StepGuide";
import { StepNeeds } from "@/components/visionary/StepNeeds";
import { ManufacturerResults } from "@/components/visionary/ManufacturerResults";
import { VisionaryFlow } from "@/components/visionary/VisionaryFlow";
import { setVisionaryData } from "@/lib/visionary/store";
import type { VisionarySlide } from "@/lib/visionary/paths";

const mockSaveStage = vi.fn().mockResolvedValue({});
const mockSaveRequirements = vi.fn().mockResolvedValue({});
const mockSaveProfile = vi.fn().mockResolvedValue({});
const mockLoad = vi.fn().mockResolvedValue({});
const mockManufacturers = vi.fn().mockResolvedValue([
  {
    id: "1",
    name: "Alpha Works",
    location: "Chennai",
    category: "Electronics",
    capabilities: "Assembly",
    about: "Top manufacturing",
    machines: ["CNC Machining"],
    products: ["PCB"],
    capacity: 1000,
    moq: 10,
    availability: "Immediate",
  },
]);

const mockMatches = vi.fn(async () => ({
  requirements: {
    manufacturing_location: "Chennai",
    quantity: { value: 1000, unit: "units" },
    budget: { amount: 200000, currency: "INR" },
    timeline: "immediately",
    additional_requirements: "",
    machines: ["CNC Machining", "Laser Cutting"],
  },
  applied: ["location", "machines"],
  notCompared: [],
  manufacturers: (await mockManufacturers()).map((m: object) => ({ ...m, matchedMachines: ["CNC Machining"] })),
  listings: [],
  listingsTotal: 0,
}));

vi.mock("@/lib/visionary/api", () => ({
  useVisionaryApi: () => ({
    load: mockLoad,
    saveProfile: mockSaveProfile,
    saveStage: mockSaveStage,
    saveRequirements: mockSaveRequirements,
    manufacturers: mockManufacturers,
    matches: mockMatches,
  }),
  errorMessage: (_e: unknown, fallback: string) => fallback,
}));

describe("Visionary stage and AI guide flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setVisionaryData({
      profile: null,
      idea: {
        project: "Eco Flask",
        idea: "A smart insulated flask with temperature display",
        product: "Smart Bottle",
        industry: "Consumer Products",
      },
      stage: "Idea Stage",
      requirements: null,
      requests: [],
    });
  });

  it("StepStage: selecting Idea Stage and clicking Save & Next routes to guide", async () => {
    let nextSlide: VisionarySlide | null = null;
    render(
      <StepStage
        onContinue={(slide) => {
          nextSlide = slide;
        }}
        onToast={() => {}}
      />,
    );

    const ideaRadio = screen.getByDisplayValue("Idea Stage");
    fireEvent.click(ideaRadio);

    const submitBtn = screen.getByRole("button", { name: /save & next/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(mockSaveStage).toHaveBeenCalledWith("Idea Stage");
    expect(nextSlide).toBe("guide");
  });

  it("StepStage: selecting Design Stage routes to guide", async () => {
    let nextSlide: VisionarySlide | null = null;
    render(
      <StepStage
        onContinue={(slide) => {
          nextSlide = slide;
        }}
        onToast={() => {}}
      />,
    );

    const designRadio = screen.getByDisplayValue("Design Stage");
    fireEvent.click(designRadio);

    const submitBtn = screen.getByRole("button", { name: /save & next/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(mockSaveStage).toHaveBeenCalledWith("Design Stage");
    expect(nextSlide).toBe("guide");
  });

  it("StepStage: selecting Prototype Stage routes to guide", async () => {
    let nextSlide: VisionarySlide | null = null;
    render(
      <StepStage
        onContinue={(slide) => {
          nextSlide = slide;
        }}
        onToast={() => {}}
      />,
    );

    const protoRadio = screen.getByDisplayValue("Prototype Stage");
    fireEvent.click(protoRadio);

    const submitBtn = screen.getByRole("button", { name: /save & next/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(mockSaveStage).toHaveBeenCalledWith("Prototype Stage");
    expect(nextSlide).toBe("guide");
  });

  it("StepStage: selecting Ready for Manufacturing goes straight to step4", async () => {
    let nextSlide: VisionarySlide | null = null;
    render(
      <StepStage
        onContinue={(slide) => {
          nextSlide = slide;
        }}
        onToast={() => {}}
      />,
    );

    const readyRadio = screen.getByDisplayValue("Ready for Manufacturing");
    fireEvent.click(readyRadio);

    const submitBtn = screen.getByRole("button", { name: /save & next/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(mockSaveStage).toHaveBeenCalledWith("Ready for Manufacturing");
    expect(nextSlide).toBe("step4");
  });

  it("StepGuide: renders project summary and navigates to step4 on Save & Next", async () => {
    let nextSlide: VisionarySlide | null = null;
    render(
      <StepGuide
        onContinue={(slide) => {
          nextSlide = slide;
        }}
      />,
    );

    expect(screen.getAllByText("Eco Flask").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Smart Bottle").length).toBeGreaterThan(0);
    expect(screen.getByText("Consumer Products")).toBeInTheDocument();
    expect(screen.getAllByText("Idea Stage").length).toBeGreaterThan(0);

    const nextBtn = screen.getByRole("button", { name: /save & next/i });
    fireEvent.click(nextBtn);
    expect(nextSlide).toBe("step4");
  });

  it("StepGuide: navigates to step3 on Previous", async () => {
    let nextSlide: VisionarySlide | null = null;
    render(
      <StepGuide
        onContinue={(slide) => {
          nextSlide = slide;
        }}
      />,
    );

    const prevBtn = screen.getByRole("button", { name: /previous/i });
    fireEvent.click(prevBtn);
    expect(nextSlide).toBe("step3");
  });

  it("StepNeeds: Previous goes back to guide if stage is not ready", async () => {
    setVisionaryData({
      profile: null,
      idea: null,
      stage: "Design Stage",
      requirements: null,
      requests: [],
    });

    let nextSlide: VisionarySlide | null = null;
    render(
      <StepNeeds
        onContinue={(slide) => {
          nextSlide = slide;
        }}
        onToast={() => {}}
      />,
    );

    const prevBtn = screen.getByRole("button", { name: /previous/i });
    fireEvent.click(prevBtn);
    expect(nextSlide).toBe("guide");
  });

  it("StepNeeds: Previous goes back to step3 if stage is Ready for Manufacturing", async () => {
    setVisionaryData({
      profile: null,
      idea: null,
      stage: "Ready for Manufacturing",
      requirements: null,
      requests: [],
    });

    let nextSlide: VisionarySlide | null = null;
    render(
      <StepNeeds
        onContinue={(slide) => {
          nextSlide = slide;
        }}
        onToast={() => {}}
      />,
    );

    const prevBtn = screen.getByRole("button", { name: /previous/i });
    fireEvent.click(prevBtn);
    expect(nextSlide).toBe("step3");
  });

  it("StepNeeds: allows selecting multiple machines and includes them in payload", async () => {
    setVisionaryData({
      profile: null,
      idea: null,
      stage: "Idea Stage",
      requirements: null,
      requests: [],
    });

    render(
      <StepNeeds
        onContinue={() => {}}
        onToast={() => {}}
      />,
    );

    expect(screen.getByText("Machine")).toBeInTheDocument();
    expect(
      screen.getByText("Choose from the machines this manufacturer has available."),
    ).toBeInTheDocument();

    const cncPill = screen.getByRole("button", { name: /CNC Machining/i });
    const printPill = screen.getByRole("button", { name: /3D Printing \(FDM\)/i });

    fireEvent.click(cncPill);
    fireEvent.click(printPill);

    expect(screen.getByText("Clear all (2)")).toBeInTheDocument();

    const locInput = screen.getByLabelText(/Manufacturing location/i);
    fireEvent.change(locInput, { target: { value: "Chennai" } });

    const qtyInput = screen.getByLabelText(/Quantity/i);
    fireEvent.change(qtyInput, { target: { value: "500" } });

    const budgetInput = screen.getByLabelText(/Budget/i);
    fireEvent.change(budgetInput, { target: { value: "100000" } });

    const timelineRadio = screen.getByDisplayValue("immediately");
    fireEvent.click(timelineRadio);

    const submitBtn = screen.getByRole("button", { name: /find a manufacturer/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(mockSaveRequirements).toHaveBeenCalledWith(
      expect.objectContaining({
        manufacturing_location: "Chennai",
        machines: ["CNC Machining", "3D Printing (FDM)"],
      }),
      true,
    );
  });

  it("ManufacturerResults: displays chosen machines in Your requirements and only Search in filters", async () => {
    setVisionaryData({
      profile: null,
      idea: null,
      stage: "Idea Stage",
      requirements: {
        manufacturing_location: "Chennai",
        quantity: { value: 1000, unit: "units" },
        budget: { amount: 200000, currency: "INR" },
        timeline: "immediately",
        additional_requirements: "",
        machines: ["CNC Machining", "Laser Cutting"],
      },
      requests: [],
    });

    await act(async () => {
      render(
        <ManufacturerResults
          onContinue={() => {}}
          onSelect={() => {}}
          onChoose={() => {}}
          selectedId={null}
        />,
      );
    });

    expect(screen.getByText("Your requirements")).toBeInTheDocument();
    expect(screen.getAllByText("Chennai").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CNC Machining").length).toBeGreaterThan(0);
    expect(screen.getByText("Laser Cutting")).toBeInTheDocument();

    expect(
      screen.getByPlaceholderText("Search by name, product or machine"),
    ).toBeInTheDocument();

    expect(screen.queryByLabelText("Location")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Industry / Category")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Capacity")).not.toBeInTheDocument();
  });

  it("VisionaryFlow: handles browser back arrow (popstate) to go back slide by slide", async () => {
    sessionStorage.clear();

    await act(async () => {
      render(<VisionaryFlow />);
    });

    // Initial slide is step1
    expect(
      screen.getByRole("heading", { name: /let’s start with you/i }),
    ).toBeInTheDocument();

    // Fill step1 and continue to step2
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Abinav/i), {
      target: { value: "John Doe" },
    });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Entrepreneur/i), {
      target: { value: "Designer" },
    });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Chennai/i), {
      target: { value: "Chennai" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    });

    // Should now be on step2
    expect(
      screen.getByRole("heading", { name: /what is the idea you want to bring to life/i }),
    ).toBeInTheDocument();
    expect(window.history.state).toEqual({ slide: "step2", manufacturerId: null });

    // Now simulate user clicking the browser back arrow (which fires popstate with previous state)
    await act(async () => {
      window.dispatchEvent(
        new PopStateEvent("popstate", {
          state: { slide: "step1", manufacturerId: null },
        }),
      );
    });

    // Should be back on step1
    expect(
      screen.getByRole("heading", { name: /let’s start with you/i }),
    ).toBeInTheDocument();

    // Now simulate clicking the browser forward arrow
    await act(async () => {
      window.dispatchEvent(
        new PopStateEvent("popstate", {
          state: { slide: "step2", manufacturerId: null },
        }),
      );
    });

    expect(
      screen.getByRole("heading", { name: /what is the idea you want to bring to life/i }),
    ).toBeInTheDocument();
  });
});
