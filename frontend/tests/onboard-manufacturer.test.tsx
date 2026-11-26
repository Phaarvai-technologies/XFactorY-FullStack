/**
 * Admin "Add manufacturer" page: one form for company, contact person and machines. Save first,
 * then invite (prefilled from the contact person); unsaved changes block the invite.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardManufacturer, formProblems, EMPTY_FORM } from "@/components/admin/OnboardManufacturer";
import { AdminHostContext, type AdminHost } from "@/lib/admin/api";

const toasts = vi.hoisted(() => [] as string[]);
vi.mock("@/components/admin/AdminShell", () => ({
  useToast: () => (m: string) => { toasts.push(m); },
  useAdminMe: () => ({ roles: ["platform_administrator"] }),
}));

function host(): AdminHost & { went: string[] } {
  const went: string[] = [];
  return {
    ready: true, path: "/admin/manufacturers/new", search: new URLSearchParams(), go: (h: string) => { went.push(h); },
    getClerkToken: async () => "t", clerkEmail: null, clerkSignIn: async () => ({ ok: true }),
    clerkVerifyCode: async () => ({ ok: true }), clerkSignOut: async () => undefined, went,
  } as unknown as AdminHost & { went: string[] };
}

type Call = { url: string; method: string; body: Record<string, unknown> | null };
let calls: Call[];
function serve(reply: (c: Call) => [unknown, number]) {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const c = { url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null };
    calls.push(c);
    const [body, status] = reply(c);
    return new Response(JSON.stringify(body), { status });
  });
}

const SAVED = {
  id: "org-1",
  company: { name: "Sahyadri Plastics", category: "Chemicals & Plastics", about: "Containers.", estYear: "2012",
             employees: "40", businessType: "", orgSize: "", capacity: "" },
  location: { address: "Plot 4, MIDC", city: "Pune", state: "Maharashtra", country: "India", zip: "411026" },
  contact: { personName: "Rahul Deshmukh", email: "rahul@sahyadri.in", phone: "+91 98220 99001" },
  machines: [{ id: "m-1", type: "Injection Moulding", industry: "Chemicals & Plastics", subcategory: "", capacity: "",
               technical: "", status: "Published" }],
  recordType: "REAL", hasOwner: false,
};
const INVITES = { invitations: [], details: { source: "entered_by_xfactory", at: null, by: "", reviewedAt: null,
                  reviewedBy: "", approvalStatus: null }, canInvite: true };

beforeEach(() => { toasts.length = 0; });
afterEach(() => vi.unstubAllGlobals());

describe("required fields", () => {
  it("names what is missing", () => {
    expect(formProblems(EMPTY_FORM)).toEqual(["Company name", "Category", "City", "Contact person", "Contact email"]);
  });
});

describe("new manufacturer", () => {
  it("checks the required fields, then creates it and opens its page to invite", async () => {
    serve((c) => (c.method === "POST" ? [{ ...SAVED, id: "org-new" }, 201] : [{}, 200]));
    const h = host();
    render(<AdminHostContext.Provider value={h}><OnboardManufacturer /></AdminHostContext.Provider>);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save manufacturer" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Please fill in: Company name, Category, City, Contact person, Contact email.");
    expect(calls).toEqual([]);

    fireEvent.change(screen.getByLabelText(/Company name/), { target: { value: "Sahyadri Plastics" } });
    fireEvent.change(screen.getByLabelText(/^Category/), { target: { value: "Chemicals & Plastics" } });
    fireEvent.change(screen.getByLabelText(/^City/), { target: { value: "Pune" } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Rahul Deshmukh" } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "rahul@sahyadri.in" } });
    fireEvent.click(screen.getByRole("button", { name: /Add machine/ }));
    fireEvent.change(screen.getByLabelText("Machine name"), { target: { value: "Injection Moulding" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save manufacturer" })));

    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toMatch(/\/admin\/manufacturers\/onboarding$/);
    expect(post.body).toMatchObject({
      company: { name: "Sahyadri Plastics", category: "Chemicals & Plastics" },
      location: { city: "Pune", country: "India" },
      contact: { personName: "Rahul Deshmukh", email: "rahul@sahyadri.in" },
      machines: [{ id: null, type: "Injection Moulding", remove: false }],
      record_type: "REAL",
    });
    expect(h.went).toEqual(["/admin/manufacturers/org-new/onboard"]);
  });

  it("a duplicate offers to open the existing company", async () => {
    serve(() => [{ detail: "This company already exists.", code: "duplicate_company", existingId: "org-9" }, 409]);
    const h = host();
    render(<AdminHostContext.Provider value={h}><OnboardManufacturer /></AdminHostContext.Provider>);
    fireEvent.change(screen.getByLabelText(/Company name/), { target: { value: "Sahyadri Plastics" } });
    fireEvent.change(screen.getByLabelText(/^Category/), { target: { value: "Chemicals & Plastics" } });
    fireEvent.change(screen.getByLabelText(/^City/), { target: { value: "Pune" } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Rahul" } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "rahul@sahyadri.in" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save manufacturer" })));
    fireEvent.click(await screen.findByRole("button", { name: "Open the existing company" }));
    expect(h.went).toEqual(["/admin/manufacturers/org-9/onboard"]);
  });
});

describe("existing manufacturer", () => {
  function serveExisting() {
    serve((c) => {
      if (c.url.endsWith("/invitations")) return [INVITES, 200];
      if (c.method === "PUT") return [{ ...SAVED, company: { ...SAVED.company, about: "Containers and caps." },
                                          machines: [] }, 200];
      return [SAVED, 200];
    });
  }

  it("unsaved changes block the invite; after saving, the invite is prefilled from the contact person", async () => {
    serveExisting();
    render(<AdminHostContext.Provider value={host()}><OnboardManufacturer id="org-1" /></AdminHostContext.Provider>);
    expect(await screen.findByDisplayValue("Containers.")).toBeInTheDocument();
    const invite = await screen.findByRole("button", { name: "Invite manufacturer" });
    expect(invite).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/About the company/), { target: { value: "Containers and caps." } });
    fireEvent.click(screen.getByRole("button", { name: /Remove Injection Moulding/ }));
    expect(screen.getByRole("button", { name: "Invite manufacturer" })).toBeDisabled();
    expect(screen.getByText("Save your changes before sending the invite.")).toBeInTheDocument();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save changes" })));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toMatch(/\/admin\/manufacturers\/org-1\/onboarding$/);
    expect(put.body).toMatchObject({ company: { about: "Containers and caps." },
                                     machines: [{ id: "m-1", remove: true }] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Invite manufacturer" })).not.toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "Invite manufacturer" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByLabelText(/^Name/)).toHaveValue("Rahul Deshmukh");
    expect(dialog.getByLabelText(/Email \(their login\)/)).toHaveValue("rahul@sahyadri.in");
    expect(dialog.getByLabelText(/Phone \(WhatsApp\)/)).toHaveValue("+91 98220 99001");
  });
});
