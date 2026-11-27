/**
 * Admin "Add manufacturer" page (meeting 27 Nov 2026): company name and contact first, machine
 * names in one field with sector and products, Save at the bottom, then Send by Email / WhatsApp.
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

describe("required fields (27 Nov: only the company name and how to reach the person)", () => {
  it("names what is missing", () => {
    expect(formProblems(EMPTY_FORM)).toEqual(["Company name", "Contact person", "Email or WhatsApp number"]);
    const onlyPhone = { ...EMPTY_FORM, company: { ...EMPTY_FORM.company, name: "Acme" },
                        contact: { personName: "Ravi", email: "", phone: "+91 98400 11223" } };
    expect(formProblems(onlyPhone)).toEqual([]);
    expect(formProblems({ ...onlyPhone, contact: { ...onlyPhone.contact, email: "not-an-email" } })).toEqual(["A valid email"]);
  });
});

describe("new manufacturer", () => {
  it("company name outlined; machines as names; Save at the bottom; then the invite options right here", async () => {
    serve((c) => {
      if (c.method === "POST") return [{ ...SAVED, id: "org-new", machines: [
        { id: "m-a", type: "Lace Braiding", industry: "Footwear", subcategory: "Shoe laces", capacity: "", technical: "", status: "Published" },
        { id: "m-b", type: "CNC Machining", industry: "Footwear", subcategory: "Shoe laces", capacity: "", technical: "", status: "Published" }] }, 201];
      if (c.url.endsWith("/invitations")) return [INVITES, 200];
      return [{ ...SAVED, id: "org-new" }, 200];
    });
    const h = host();
    render(<AdminHostContext.Provider value={h}><OnboardManufacturer /></AdminHostContext.Provider>);
    expect(screen.getByLabelText(/Company name/)).toHaveClass("adm-key-field");
    expect(screen.queryByLabelText(/^Category/)).toBeNull();               // optional details are folded away
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save manufacturer" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Please fill in: Company name, Contact person, Email or WhatsApp number.");
    expect(calls).toEqual([]);

    fireEvent.change(screen.getByLabelText(/Company name/), { target: { value: "Bharat Laces" } });
    fireEvent.change(screen.getByLabelText(/^Contact person/), { target: { value: "Ravi Kumar" } });
    fireEvent.change(screen.getByLabelText(/^WhatsApp number/), { target: { value: "+91 98400 11223" } });
    // several machine names in one field: one typed (not in the list), one picked from the list
    const names = screen.getByLabelText("Machine names");
    fireEvent.change(names, { target: { value: "Lace Braiding" } });
    fireEvent.keyDown(names, { key: "Enter" });
    fireEvent.change(names, { target: { value: "cnc mach" } });
    fireEvent.click(screen.getByRole("option", { name: "CNC Machining" }));
    expect(screen.getByRole("button", { name: "Remove Lace Braiding" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove CNC Machining" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Industry sector"), { target: { value: "Footwear & Leather" } });
    fireEvent.change(screen.getByLabelText("Production / products"), { target: { value: "Shoe laces" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save manufacturer" })));

    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toMatch(/\/admin\/manufacturers\/onboarding$/);
    expect(post.body).toMatchObject({
      company: { name: "Bharat Laces" },
      contact: { personName: "Ravi Kumar", email: "", phone: "+91 98400 11223" },
      machines: [
        { id: null, type: "Lace Braiding", industry: "Footwear & Leather", subcategory: "Shoe laces", remove: false },
        { id: null, type: "CNC Machining", industry: "Footwear & Leather", subcategory: "Shoe laces", remove: false },
      ],
    });
    expect(h.went).toEqual(["/admin/manufacturers/org-new/onboard?invite=1"]);
    // the invite options show straight away on this page (no reload needed)
    expect(await screen.findByRole("button", { name: "Send by WhatsApp" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Send by Email" })).toBeEnabled();
  });

  it("a duplicate offers to open the existing company", async () => {
    serve(() => [{ detail: "This company already exists.", code: "duplicate_company", existingId: "org-9" }, 409]);
    const h = host();
    render(<AdminHostContext.Provider value={h}><OnboardManufacturer /></AdminHostContext.Provider>);
    fireEvent.change(screen.getByLabelText(/Company name/), { target: { value: "Sahyadri Plastics" } });
    fireEvent.change(screen.getByLabelText(/^Contact person/), { target: { value: "Rahul" } });
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

  it("unsaved changes block the link; after saving, Send by Email / WhatsApp are prefilled", async () => {
    serveExisting();
    render(<AdminHostContext.Provider value={host()}><OnboardManufacturer id="org-1" /></AdminHostContext.Provider>);
    expect(await screen.findByDisplayValue("Sahyadri Plastics")).toBeInTheDocument();
    const byEmail = await screen.findByRole("button", { name: "Send by Email" });
    expect(byEmail).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /More company details/ }));
    fireEvent.change(screen.getByLabelText(/About the company/), { target: { value: "Containers and caps." } });
    fireEvent.click(screen.getByRole("button", { name: "Remove Injection Moulding" }));
    expect(screen.getByRole("button", { name: "Send by Email" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send by WhatsApp" })).toBeDisabled();
    expect(screen.getByText("Save your changes before sending the link.")).toBeInTheDocument();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save changes" })));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toMatch(/\/admin\/manufacturers\/org-1\/onboarding$/);
    expect(put.body).toMatchObject({ company: { about: "Containers and caps." },
                                     machines: [{ id: "m-1", remove: true }] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Send by Email" })).not.toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "Send by WhatsApp" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByLabelText(/^Name/)).toHaveValue("Rahul Deshmukh");
    expect(dialog.getByLabelText(/WhatsApp number/)).toHaveValue("+91 98220 99001");
    expect(dialog.getByLabelText(/Email \(their login\)/)).toHaveValue("rahul@sahyadri.in");
  });
});
