/**
 * Visionary AI assistant on the existing screens: the AI Guide step and the optional idea panel.
 * The backend is replaced by mocks; the tests check what is sent, what is shown, and that nothing
 * changes in the form or the saved data until the user confirms a suggestion.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StepGuide } from "@/components/visionary/StepGuide";
import { StepIdea } from "@/components/visionary/StepIdea";
import type { AiHistory, AiMessage, AiSendBody } from "@/lib/visionary/api";
import { ApiError } from "@/lib/api";
import { getVisionaryData, setVisionaryData } from "@/lib/visionary/store";
import type { VisionarySlide } from "@/lib/visionary/paths";

const api = vi.hoisted(() => ({
  aiHistory: vi.fn(),
  aiSend: vi.fn(),
  aiAccepted: vi.fn(async () => ({ accepted: true })),
  saveIdea: vi.fn(async () => ({})),
  saveRequirements: vi.fn(async () => ({})),
}));
vi.mock("@/lib/visionary/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/visionary/api")>()),
  useVisionaryApi: () => api,
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const IDEA = { project: "Eco Flask", idea: "A smart insulated flask", product: "Smart Bottle", industry: "Consumer Products" };

function history(messages: AiMessage[] = [], configured = true, contextChanged: string[] = []): AiHistory {
  return { configured, messages, contextChanged };
}
function reply(id: string, text: string, extra: Partial<AiMessage> = {}): { messages: AiMessage[] } {
  return { messages: [{ id: `u-${id}`, role: "user", text: "" }, { id, role: "assistant", text, ...extra }] };
}
function data(stage = "Prototype Stage", requirements: Parameters<typeof setVisionaryData>[0]["requirements"] = null) {
  setVisionaryData({ profile: null, idea: IDEA, stage, requirements, requests: [] });
}

beforeEach(() => {
  vi.clearAllMocks();
  data();
});

describe("AI Guide step", () => {
  it("first visit: one opening request; reply shown as plain text; real project summary", async () => {
    api.aiHistory.mockResolvedValue(history());
    api.aiSend.mockResolvedValue(reply("a1", "I understand: a smart flask.\n- Test the lid seal\n- Plan a pilot batch\n<img src=x onerror=alert(1)>",
      { chips: ["What should I test?"] }));
    await act(async () => { render(<StepGuide onContinue={() => {}} />); });
    await waitFor(() => expect(api.aiSend).toHaveBeenCalledTimes(1));
    expect((api.aiSend.mock.calls[0] as unknown[])[0]).toBe("guide");
    expect((api.aiSend.mock.calls[0] as [string, AiSendBody])[1]).toMatchObject({ mode: "start", message: "" });
    expect(await screen.findByText("I understand: a smart flask.")).toBeInTheDocument();
    expect(screen.getByText("Test the lid seal").tagName).toBe("LI");
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();   // text, not HTML
    expect(document.querySelector("#v-guide img[src='x']")).toBeNull();
    expect(screen.getAllByText("Prototype Stage").length).toBeGreaterThan(0);
    expect(screen.queryByText("Customized Bottle")).toBeNull();                       // no sample values
  });

  it("missing details are 'Not provided' and the stage is never assumed", async () => {
    setVisionaryData({ profile: null, idea: { ...IDEA, product: "" }, stage: "", requirements: null, requests: [] });
    api.aiHistory.mockResolvedValue(history([{ id: "a0", role: "assistant", text: "Hello again" }]));
    await act(async () => { render(<StepGuide onContinue={() => {}} />); });
    expect(screen.getByText("Not provided")).toBeInTheDocument();
    expect(screen.getAllByText("Not selected").length).toBeGreaterThan(0);
    expect(screen.queryByText("Idea Stage")).toBeNull();
    expect(screen.getByText("Hello again")).toBeInTheDocument();                       // restored, no new call
    expect(api.aiSend).not.toHaveBeenCalled();
  });

  it("'Add to requirements' shows the exact changes and saves only after Apply", async () => {
    data("Ready for Manufacturing", { manufacturing_location: "Chennai", quantity: { value: 500, unit: "units" },
      budget: { amount: 10000, currency: "INR" }, timeline: "", additional_requirements: "Matte finish", machines: ["Welding"] });
    api.aiHistory.mockResolvedValue(history([{ id: "a1", role: "assistant", text: "Two things to add:",
      suggestions: [{ id: "s1", title: "Moulding and PP", summary: "", target_users: "", problem: "", why_it_fits: "",
        materials_or_processes: "", first_step: "", assumptions: "",
        fields: { machines: ["Injection Moulding", "Welding"], additional_requirements: "Food-grade PP" } }] }]));
    await act(async () => { render(<StepGuide onContinue={() => {}} onToast={() => {}} />); });
    fireEvent.click(screen.getByRole("button", { name: "Add to requirements" }));
    const box = within(screen.getByRole("group", { name: "Confirm changes" }));
    expect(box.getByText("Machine: “Welding” → “Welding, Injection Moulding”")).toBeInTheDocument();
    expect(box.getByText(/Additional requirements: “Matte finish” →/)).toBeInTheDocument();
    expect(api.saveRequirements).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(box.getByRole("button", { name: "Apply" })));
    expect(api.saveRequirements).toHaveBeenCalledWith(expect.objectContaining({
      machines: ["Welding", "Injection Moulding"], additional_requirements: "Matte finish\nFood-grade PP",
      manufacturing_location: "Chennai", quantity: { value: 500, unit: "units" } }), false);
    expect(api.aiAccepted).toHaveBeenCalledWith("guide", { message_id: "a1", suggestion_id: "s1",
      fields: ["machines", "additional_requirements"] });
    expect(screen.getByText("Applied ✓")).toBeInTheDocument();
  });

  it("assistant off: says so; Previous / Save & Next work as before", async () => {
    api.aiHistory.mockResolvedValue(history([], false));
    let slide: VisionarySlide | null = null;
    await act(async () => { render(<StepGuide onContinue={(s) => { slide = s; }} />); });
    expect(screen.getByText(/AI guide is not available right now/)).toBeInTheDocument();
    expect(api.aiSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /save & next/i }));
    expect(slide).toBe("step4");
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(slide).toBe("step3");
  });

  it("a failed answer keeps the typed question; Try again re-sends the same request", async () => {
    api.aiHistory.mockResolvedValue(history([{ id: "a0", role: "assistant", text: "Hi" }]));
    api.aiSend.mockRejectedValueOnce(new ApiError(502, "The AI assistant is not available right now. You can continue without it."));
    await act(async () => { render(<StepGuide onContinue={() => {}} />); });
    const input = screen.getByLabelText("Your question") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "What is MOQ?" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(screen.getByRole("alert").textContent).toContain("not available right now");
    expect(input.value).toBe("What is MOQ?");
    api.aiSend.mockResolvedValueOnce(reply("a2", "MOQ means minimum order quantity (it varies)."));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
    const [first, second] = api.aiSend.mock.calls as [string, AiSendBody][];
    expect(second[1].request_id).toBe(first[1].request_id);
    expect(screen.getByText("MOQ means minimum order quantity (it varies).")).toBeInTheDocument();
  });

  it("changed project details are flagged with a way to refresh the guidance", async () => {
    api.aiHistory.mockResolvedValue(history([{ id: "a0", role: "assistant", text: "Old advice" }], true, ["product_to_manufacture"]));
    api.aiSend.mockResolvedValue(reply("a1", "Updated advice"));
    await act(async () => { render(<StepGuide onContinue={() => {}} />); });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Update my guidance" })));
    expect((api.aiSend.mock.calls[0] as [string, AiSendBody])[1].message).toMatch(/details changed/);
    expect(screen.getByText("Updated advice")).toBeInTheDocument();
  });
});

describe("Your idea: optional AI help", () => {
  function renderIdea() {
    const toast = vi.fn();
    const next = vi.fn();
    render(<StepIdea onContinue={next} onToast={toast} />);
    return { next };
  }
  const field = (id: string) => document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;

  it("no idea yet: three ideas; 'Use this idea' fills the fields only after Apply, then saves a draft", async () => {
    setVisionaryData({ profile: null, idea: null, stage: "", requirements: null, requests: [] });
    api.aiHistory.mockResolvedValue(history());
    const idea = (i: number) => ({ id: `s${i}`, title: `Idea ${i}`, summary: "", target_users: "Home cooks", problem: "p",
      why_it_fits: "w", materials_or_processes: "Stainless steel", first_step: "Sketch it", assumptions: "Budget under 2 lakh",
      fields: { project: `Project ${i}`, idea: `Description ${i}`, product: `Product ${i}`, industry: "Food & Beverage" } });
    api.aiSend.mockResolvedValue(reply("a1", "Here are three ideas.", { suggestions: [idea(1), idea(2), idea(3)] }));
    renderIdea();
    expect(screen.queryByLabelText("Your question")).toBeNull();                       // collapsed by default
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Help me find an idea" })));
    expect((api.aiSend.mock.calls[0] as [string, AiSendBody])).toEqual(["idea", expect.objectContaining({
      mode: "explore", form: { project: "", idea: "", product: "", industry: "" } })]);
    expect(screen.getAllByText("Home cooks")).toHaveLength(3);
    fireEvent.click(screen.getAllByRole("button", { name: "Use this idea" })[1]);
    expect(screen.getByText("Project / Product name: “Project 2”")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(field("project").value).toBe("");                                           // nothing applied
    fireEvent.click(screen.getAllByRole("button", { name: "Use this idea" })[1]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Apply" })));
    expect(field("project").value).toBe("Project 2");
    expect(field("idea").value).toBe("Description 2");
    expect(field("product").value).toBe("Product 2");
    expect(document.querySelector("#v-s2 .ms-tags")?.textContent).toBe("Food & Beverage");
    expect(api.saveIdea).toHaveBeenCalledWith({ project: "Project 2", idea: "Description 2", product: "Product 2",
      industry: "Food & Beverage" }, false);
    fireEvent.change(field("project"), { target: { value: "My own name" } });            // still editable
    expect(field("project").value).toBe("My own name");
  });

  it("partial idea: 'Refine my idea' sends the current, unsaved values; 'Apply description' changes only that field", async () => {
    setVisionaryData({ profile: null, idea: null, stage: "", requirements: null, requests: [] });
    api.aiHistory.mockResolvedValue(history());
    api.aiSend.mockResolvedValue(reply("a1", "Sharper description:", { suggestions: [{ id: "s1", title: "Clearer description",
      summary: "", target_users: "", problem: "", why_it_fits: "", materials_or_processes: "", first_step: "", assumptions: "",
      fields: { idea: "Insulated flasks for commuters that keep tea hot for 8 hours." } }] }));
    renderIdea();
    expect((screen.getByRole("button", { name: "Refine my idea" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field("idea"), { target: { value: "flask for commuters" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refine my idea" })));
    expect((api.aiSend.mock.calls[0] as [string, AiSendBody])[1]).toMatchObject({
      mode: "refine", form: { project: "", idea: "flask for commuters", product: "", industry: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply description" }));
    expect(screen.getByText(/Describe your idea: “flask for commuters” →/)).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Apply" })));
    expect(field("idea").value).toBe("Insulated flasks for commuters that keep tea hot for 8 hours.");
    expect(field("project").value).toBe("");
  });

  it("Add Project: blank screen, the next project's conversation; Apply fills the fields without creating a project", async () => {
    // a current project exists; "Add Project" opens the screen blank (fresh)
    api.aiHistory.mockResolvedValue(history());
    api.aiSend.mockResolvedValue(reply("a1", "One idea:", { suggestions: [{ id: "s1", title: "Trays", summary: "",
      target_users: "", problem: "", why_it_fits: "", materials_or_processes: "", first_step: "", assumptions: "",
      fields: { project: "Steel trays", idea: "Stackable trays", product: "Trays", industry: "Food & Beverage" } }] }));
    const next = vi.fn();
    render(<StepIdea onContinue={next} onToast={vi.fn()} fresh />);
    expect(field("project").value).toBe("");                                           // not the current project
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Help me find an idea" })));
    expect(api.aiHistory).toHaveBeenCalledWith("idea", true);
    expect((api.aiSend.mock.calls[0] as [string, AiSendBody])[1]).toMatchObject({
      mode: "explore", new_project: true, form: { project: "", idea: "", product: "", industry: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this idea" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Apply" })));
    expect(field("project").value).toBe("Steel trays");
    expect(api.saveIdea).not.toHaveBeenCalled();                                       // no extra project
    expect(api.aiAccepted).toHaveBeenCalledWith("idea", expect.objectContaining({ new_project: true }));
    // the screen's own Save & Next creates the new project, as before
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /save & next/i })));
    expect(api.saveIdea).toHaveBeenCalledTimes(1);
    expect(api.saveIdea).toHaveBeenCalledWith({ project: "Steel trays", idea: "Stackable trays", product: "Trays",
      industry: "Food & Beverage" }, true, true);
  });

  it("without the assistant the form works and validates exactly as before", async () => {
    setVisionaryData({ profile: null, idea: null, stage: "", requirements: null, requests: [] });
    const { next } = renderIdea();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /save & next/i })));
    expect(next).not.toHaveBeenCalled();
    expect(api.saveIdea).not.toHaveBeenCalled();
    expect(api.aiHistory).not.toHaveBeenCalled();                                       // nothing loaded unasked
    expect(getVisionaryData().idea).toBeNull();
  });
});
