import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { StepStage } from "@/components/visionary/StepStage";
import { StepGuide } from "@/components/visionary/StepGuide";
import { StepNeeds } from "@/components/visionary/StepNeeds";
import { ManufacturerResults } from "@/components/visionary/ManufacturerResults";
import { ProjectList, RequestList } from "@/components/visionary/ProjectBoards";
import { VisionaryFlow } from "@/components/visionary/VisionaryFlow";
import { setVisionaryData } from "@/lib/visionary/store";
import type { VisionarySlide } from "@/lib/visionary/paths";

const mockSaveStage = vi.fn().mockResolvedValue({});
const mockSaveRequirements = vi.fn().mockResolvedValue({});
const mockUpdateProject = vi.fn();
const mockCancelRequest = vi.fn();
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
    updateProject: mockUpdateProject,
    cancelRequest: mockCancelRequest,
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

  it("Add Project opens a blank idea flow from the project page", async () => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/visionaries/flow");

    await act(async () => {
      render(<VisionaryFlow />);
    });

    await act(async () => {
      window.dispatchEvent(
        new PopStateEvent("popstate", {
          state: { slide: "project", manufacturerId: null },
        }),
      );
    });

    expect(screen.getByRole("heading", { name: "My Project" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Eco Flask" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add Project" }));
    });

    expect(
      screen.getByRole("heading", { name: /what is the idea you want to bring to life/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Project / Product name")).toHaveValue("");
    expect(screen.getByText("Step 2 of 4")).toBeInTheDocument();
  });

  it("View Project and View Request open expandable cards", async () => {
    setVisionaryData({
      profile: null,
      idea: { project: "Customized Bottle", idea: "A bottle", product: "Bottle", industry: "Food & Beverage" },
      stage: "Prototype Stage",
      requirements: {
        manufacturing_location: "Chennai",
        quantity: { value: 1000, unit: "units" },
        budget: { amount: 200000, currency: "INR" },
        timeline: "immediately",
        additional_requirements: "",
        machines: [],
      },
      projects: [
        {
          id: "p1",
          project: "Customized Bottle",
          idea: "A refillable bottle for cafés",
          product: "Bottle",
          industry: "Food & Beverage",
          stage: "Prototype Stage",
          requirements: {
            manufacturing_location: "Chennai",
            quantity: { value: 1000, unit: "units" },
            budget: { amount: 200000, currency: "INR" },
            timeline: "immediately",
            additional_requirements: "Food grade",
            machines: ["Blow Moulding"],
          },
          created_at: "2026-10-23T00:00:00.000Z",
        },
        {
          id: "p2",
          project: "Paper Cups",
          idea: "Printed cups",
          product: "Cups",
          industry: "Packaging",
          stage: "Idea Stage",
          requirements: null,
          created_at: "2026-10-22T00:00:00.000Z",
        },
      ],
      requests: [
        {
          id: "r1",
          request_id: "REQ-1",
          manufacturer_id: "m1",
          manufacturer_name: "Tec Info",
          project_name: "Customized Bottle",
          visionary: "Priya",
          machine: "Blow Moulding",
          quantity: { value: 1000, unit: "units" },
          required_duration: "1_month",
          manufacturing_location: "Chennai",
          budget: { amount: 200000, currency: "INR" },
          timeline: "immediately",
          additional_requirements: "",
          status: "submitted",
          created_at: "2026-10-23T00:00:00.000Z",
        },
      ],
    });

    const saved = {
      profile: null,
      idea: { project: "Renamed Bottle", idea: "A refillable bottle for cafés", product: "Bottle", industry: "Food & Beverage" },
      stage: "Prototype Stage",
      requirements: null,
      projects: [
        {
          id: "p1",
          project: "Renamed Bottle",
          idea: "A refillable bottle for cafés",
          product: "Bottle",
          industry: "Food & Beverage",
          stage: "Prototype Stage",
          requirements: {
            manufacturing_location: "Chennai",
            quantity: { value: 1000, unit: "units" as const },
            budget: { amount: 200000, currency: "INR" as const },
            timeline: "immediately",
            additional_requirements: "Food grade",
            machines: ["Blow Moulding"],
          },
          created_at: "2026-10-23T00:00:00.000Z",
        },
      ],
      requests: [
        {
          id: "r1",
          request_id: "REQ-1",
          manufacturer_id: "m1",
          manufacturer_name: "Tec Info",
          project_name: "Renamed Bottle",
          visionary: "Priya",
          machine: "Blow Moulding",
          quantity: { value: 1000, unit: "units" as const },
          required_duration: "1_month",
          manufacturing_location: "Chennai",
          budget: { amount: 200000, currency: "INR" as const },
          timeline: "immediately",
          additional_requirements: "",
          status: "Edited",
          created_at: "2026-10-23T00:00:00.000Z",
        },
      ],
    };
    mockUpdateProject.mockResolvedValue(saved);

    const { unmount } = render(<ProjectList onContinue={() => {}} onToast={() => {}} />);
    expect(screen.getByRole("heading", { name: "View All Projects" })).toBeInTheDocument();
    expect(screen.getByText("Paper Cups")).toBeInTheDocument();
    expect(screen.queryByText("A refillable bottle for cafés")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Customized Bottle/ }));
    expect(screen.getByText("A refillable bottle for cafés")).toBeInTheDocument();
    expect(screen.getByText("Blow Moulding")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Renamed Bottle" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(mockUpdateProject).toHaveBeenCalledWith("p1", expect.objectContaining({ project: "Renamed Bottle" }));
    expect(screen.getByRole("button", { name: /Renamed Bottle/ })).toBeInTheDocument();
    unmount();

    mockCancelRequest.mockResolvedValue({
      ...saved,
      requests: [{ ...saved.requests[0], status: "Cancelled" }],
    });
    render(<RequestList onContinue={() => {}} onToast={() => {}} />);
    expect(screen.getByRole("heading", { name: "View All Requests" })).toBeInTheDocument();
    expect(screen.getByText("Sent to Tec Info")).toBeInTheDocument();
    expect(screen.queryByText("REQ-1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Sent to Tec Info/ }));
    expect(screen.getByText("REQ-1")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo request" }));
    });
    expect(mockCancelRequest).toHaveBeenCalledWith("r1");
    expect(screen.getAllByText("Cancelled").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Undo request" })).not.toBeInTheDocument();
  });
});
