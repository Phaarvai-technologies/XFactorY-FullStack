import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { StepStage } from "@/components/visionary/StepStage";
import { StepGuide } from "@/components/visionary/StepGuide";
import { StepNeeds } from "@/components/visionary/StepNeeds";
import { setVisionaryData } from "@/lib/visionary/store";
import type { VisionarySlide } from "@/lib/visionary/paths";

const mockSaveStage = vi.fn().mockResolvedValue({});
const mockSaveRequirements = vi.fn().mockResolvedValue({});

vi.mock("@/lib/visionary/api", () => ({
  useVisionaryApi: () => ({
    saveStage: mockSaveStage,
    saveRequirements: mockSaveRequirements,
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
});
