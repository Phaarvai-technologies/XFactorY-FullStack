/**
 * Approval-first onboarding: the admin's application review and the applicant's status screen.
 * The data are real backend responses (tests/fixtures/*.json captured from the API):
 *   admin-detail-new-application.json   GET /admin/manufacturers/{id} - a new company awaiting approval
 *   admin-detail-application.json       GET /admin/manufacturers/{id} - an approved company with one
 *                                       applicant waiting and one approved member
 *   manufacturer-bootstrap-*.json       GET /manufacturer/bootstrap - the applicant, pending / corrections
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import newApp from "./fixtures/admin-detail-new-application.json";
import joinApp from "./fixtures/admin-detail-application.json";
import pendingBoot from "./fixtures/manufacturer-bootstrap-pending.json";
import correctionsBoot from "./fixtures/manufacturer-bootstrap-corrections.json";
import { ManufacturerDetail } from "@/components/admin/ManufacturerDetail";
import { ApplicationStatusScreen } from "@/components/manufacturer/ApplicationStatusScreen";
import { AdminHostContext, type AdminHost } from "@/lib/admin/api";
import type { OnboardingState } from "@/lib/manufacturer/onboarding";

const me = { roles: ["platform_administrator"] as string[] };
vi.mock("@/components/admin/AdminShell", () => ({
  useToast: () => () => undefined,
  useAdminMe: () => ({ id: "admin-1", name: "Priya Admin", email: "priya@x.y", roles: me.roles }),
}));
vi.mock("@/components/manufacturer/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/manufacturer/AccountMenu", () => ({ AccountMenu: () => null }));

function host(org: string): AdminHost {
  return {
    ready: true, path: `/admin/manufacturers/${org}`, search: new URLSearchParams("tab=onboarding"), go: () => undefined,
    getClerkToken: async () => "clerk-token", clerkEmail: "admin@example.com",
    clerkSignIn: async () => ({ ok: true }), clerkVerifyCode: async () => ({ ok: true }),
    clerkSignOut: async () => undefined,
  } as unknown as AdminHost;
}

afterEach(() => {
  vi.unstubAllGlobals();
  me.roles = ["platform_administrator"];
});

function renderDetail(detail: typeof newApp | typeof joinApp, decided?: (body: Record<string, unknown>) => unknown) {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    if ((init.method ?? "GET") === "POST" && u.includes("/admin/applications/")) {
      const body = JSON.parse(String(init.body));
      posts.push({ url: u, body });
      return new Response(JSON.stringify(decided ? decided(body) : detail), { status: 200 });
    }
    if (u.endsWith(`/admin/manufacturers/${detail.manufacturer.id}`)) return new Response(JSON.stringify(detail), { status: 200 });
    return new Response(JSON.stringify({ registeredUsers: [], requests: [], counts: { linkedUsers: 0, openRequests: 0 } }),
                        { status: 200 });
  });
  render(<AdminHostContext.Provider value={host(detail.manufacturer.id)}><ManufacturerDetail id={detail.manufacturer.id} /></AdminHostContext.Provider>);
  return posts;
}

async function applicationCard(name: RegExp) {
  return (await screen.findAllByRole("heading", { name: /^Application/ }))
    .map((h) => h.closest("section")!)
    .find((s) => name.test(s.textContent ?? ""))!;
}

describe("admin: a new company's application", () => {
  it("shows personal and company information next to the record and requires a reason to reject", async () => {
    const posts = renderDetail(newApp);
    const card = await applicationCard(/Asha Rao/);
    expect(within(card).getByText("Awaiting review")).toBeInTheDocument();
    expect(within(card).getByText("asha.rao@gmail.com")).toBeInTheDocument();
    const phone = within(card).getByText("Company phone number").closest("tr")!;
    expect(phone.querySelectorAll("td")[1].textContent).toBe("+914423456789");     // submitted (normalized)
    expect(phone.querySelectorAll("td")[2].textContent).toBe("—");                  // not on the record yet
    fireEvent.click(within(card).getByRole("button", { name: /Reject/ }));
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Reject application" })));
    expect(within(card).getByText("Write the reason the applicant will see.")).toBeInTheDocument();
    expect(posts).toEqual([]);
    fireEvent.change(within(card).getByLabelText(/Reason shown to the applicant/), { target: { value: "Not a manufacturer" } });
    fireEvent.change(within(card).getByLabelText(/Internal note/), { target: { value: "GST number did not match" } });
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Reject application" })));
    await waitFor(() => expect(posts).toHaveLength(1));
    const app = newApp.applications![0];
    expect(posts[0].url).toContain(`/admin/applications/${app.id}/decision`);
    expect(posts[0].body).toEqual({ decision: "reject", feedback: "Not a manufacturer", internalNote: "GST number did not match",
                                    correctionFields: null, makePrimary: false, seen: app.seen });
  });

  it("corrections need at least one field; only the chosen fields are sent", async () => {
    const posts = renderDetail(newApp);
    const card = await applicationCard(/Asha Rao/);
    fireEvent.click(within(card).getByRole("button", { name: /Request corrections/ }));
    fireEvent.change(within(card).getByLabelText(/What needs correcting/), { target: { value: "Check the phone." } });
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Send correction request" })));
    expect(within(card).getByText("Choose at least one field the applicant should correct.")).toBeInTheDocument();
    fireEvent.click(within(card).getByLabelText("Company phone number"));
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Send correction request" })));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toMatchObject({ decision: "request_changes", feedback: "Check the phone.",
                                          correctionFields: ["companyPhone"] });
  });

  it("support specialists can read applications but not decide them", async () => {
    me.roles = ["support_specialist"];
    renderDetail(newApp);
    const card = await applicationCard(/Asha Rao/);
    expect(within(card).queryByRole("button", { name: /Approve/ })).not.toBeInTheDocument();
    expect(within(card).getByText(/Only administrators, operators and verification analysts/)).toBeInTheDocument();
  });
});

describe("admin: an applicant for an existing company", () => {
  it("marks company details the applicant supplied because the company had none", async () => {
    const withSupplied = structuredClone(joinApp);
    const pending = withSupplied.applications.find((x: { status: string }) => x.status === "pending")!;
    pending.company = pending.company.map((f: { key: string }) =>
      f.key === "companyPhone" ? { ...f, submitted: "+919876543210", current: "", supplied: true } : f);
    renderDetail(withSupplied as typeof joinApp);
    const card = await applicationCard(/Ravi Kumar/);
    const row = within(card).getByText("Missing - supplied").closest("tr")!;
    expect(row.textContent).toContain("+919876543210");
    expect(within(card).getAllByText("Missing - supplied")).toHaveLength(1);
  });

  it("is reviewed apart from the company; approval never offers ownership when the company has an owner", async () => {
    const posts = renderDetail(joinApp);
    const card = await applicationCard(/Ravi Kumar/);
    expect(within(card).getByText(/does not change the company’s own approval, owner or other members/)).toBeInTheDocument();
    expect(within(card).getByText(/Saved company details are never changed by this application/)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: /Approve/ }));
    expect(within(card).queryByLabelText(/primary user/)).not.toBeInTheDocument();
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Approve application" })));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toMatchObject({ decision: "approve", makePrimary: false });
    // the already-approved applicant is shown as decided, without decision buttons
    const done = await applicationCard(/Meena/);
    expect(within(done).getByText("Approved")).toBeInTheDocument();
    expect(within(done).queryByRole("button", { name: /Reject/ })).not.toBeInTheDocument();
  });
});

describe("applicant: locked until approval", () => {
  const props = { fullName: "Ravi Kumar", initials: "RK", onCorrect: vi.fn(), onReapply: vi.fn(), onMainDashboard: vi.fn() };

  it("pending: clear status, what was sent, remaining sections locked", () => {
    render(<ApplicationStatusScreen onboarding={pendingBoot.onboarding as OnboardingState} {...props} />);
    expect(screen.getByRole("heading", { name: "Your application is with XfactorY for review" })).toBeInTheDocument();
    expect(screen.getByText("Pending approval")).toBeInTheDocument();
    for (const title of ["Company Profile", "Machinery", "Availability", "Booking Requests"]) {
      const card = screen.getByRole("heading", { name: title }).closest(".nav-card")!;
      expect(card.getAttribute("aria-disabled")).toBe("true");
      expect(card.tagName).not.toBe("BUTTON");                    // nothing to open
    }
    expect(screen.getAllByText("Locked until approval")).toHaveLength(4);
  });

  it("corrections: XfactorY's message and the fields to correct; internal notes never appear", () => {
    render(<ApplicationStatusScreen onboarding={correctionsBoot.onboarding as OnboardingState} {...props} />);
    expect(screen.getByText("Please use your full last name.")).toBeInTheDocument();
    expect(screen.getByText(/Please correct:/).textContent).toContain("Last name");
    expect(document.body.textContent).not.toContain("HR call pending");
    expect(JSON.stringify(correctionsBoot)).not.toContain("HR call pending");     // not in the API response either
    fireEvent.click(screen.getByRole("button", { name: "Correct my details" }));
    expect(props.onCorrect).toHaveBeenCalled();
  });

  it("rejected: the reason, the main dashboard, and no reapplying while the policy is not set", () => {
    const onboarding: OnboardingState = {
      ...(correctionsBoot.onboarding as OnboardingState),
      access: { unlocked: false, status: "rejected" },
      application: { ...(correctionsBoot.onboarding as OnboardingState).application!, status: "rejected",
                     feedback: "We could not verify your employment.", correctionFields: [] },
      reapply: { configured: false, allowed: false, availableFrom: null },
    };
    render(<ApplicationStatusScreen onboarding={onboarding} {...props} />);
    expect(screen.getByText("We could not verify your employment.")).toBeInTheDocument();
    expect(screen.getByText(/Applying again is not available yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply again" })).not.toBeInTheDocument();
    expect(screen.queryByText("Locked until approval")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to my XfactorY dashboard" }));
    expect(props.onMainDashboard).toHaveBeenCalled();
  });
});
