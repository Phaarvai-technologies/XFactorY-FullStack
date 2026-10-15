/** Admin Entry ("Add company"): who sees the button, what is sent, retries and duplicates. */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddCompanyModal } from "@/components/admin/AddCompany";
import { Manufacturers } from "@/components/admin/Manufacturers";
import { AdminHostContext, type AdminHost } from "@/lib/admin/api";

const me = vi.hoisted(() => ({ current: null as null | { roles: string[] } }));
const toasts = vi.hoisted(() => [] as string[]);
vi.mock("@/components/admin/AdminShell", () => ({
  useToast: () => (m: string) => { toasts.push(m); },
  useAdminMe: () => me.current,
}));

beforeEach(() => { toasts.length = 0; });
afterEach(() => vi.unstubAllGlobals());

function host(): AdminHost & { went: string[] } {
  const went: string[] = [];
  return {
    ready: true, path: "/admin/manufacturers", search: new URLSearchParams(), go: (h: string) => { went.push(h); },
    getClerkToken: async () => "t", clerkEmail: null, clerkSignIn: async () => ({ ok: true }),
    clerkVerifyCode: async () => ({ ok: true }), clerkSignOut: async () => undefined, went,
  } as unknown as AdminHost & { went: string[] };
}

type Call = { url: string; method: string; body: Record<string, unknown> | null; headers: Record<string, string> };
function serve(reply: (c: Call) => [unknown, number]) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const c = { url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null,
                headers: (init.headers ?? {}) as Record<string, string> };
    calls.push(c);
    const [body, status] = reply(c);
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}

const LIST = { total: 0, page: 1, pageSize: 25, rows: [], facets: { industries: [], countries: [] } };

describe("Add company button", () => {
  it.each([
    [["platform_administrator"], true],
    [["platform_operator"], true],
    [["support_specialist"], false],
    [["verification_analyst"], false],
  ])("roles %j -> visible %s", async (roles, visible) => {
    me.current = { roles };
    serve(() => [LIST, 200]);
    render(<AdminHostContext.Provider value={host()}><Manufacturers /></AdminHostContext.Provider>);
    await screen.findByText(/No manufacturers|match/i).catch(() => undefined);
    expect(!!screen.queryByRole("button", { name: /Add company/ })).toBe(visible);
  });

  it("opens the form", async () => {
    me.current = { roles: ["platform_administrator"] };
    serve(() => [LIST, 200]);
    render(<AdminHostContext.Provider value={host()}><Manufacturers /></AdminHostContext.Provider>);
    fireEvent.click(await screen.findByRole("button", { name: /Add company/ }));
    expect(screen.getByLabelText(/Company name/)).toBeInTheDocument();
    expect(screen.getByText(/recorded as/)).toHaveTextContent("Admin Entry");
  });
});

describe("Add company form", () => {
  it("requires a name and a valid email before calling the API", async () => {
    const calls = serve(() => [{}, 500]);
    render(<AdminHostContext.Provider value={host()}><AddCompanyModal onClose={() => undefined} /></AdminHostContext.Provider>);
    fireEvent.click(screen.getByRole("button", { name: "Add company" }));
    expect(screen.getByText("Enter the company name.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Company name/), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText(/Contact email/), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Add company" }));
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it("sends the details (no source field), one idempotency key for retries, then opens the company", async () => {
    let attempt = 0;
    const calls = serve(() => (++attempt === 1 ? [{ detail: "Database unavailable" }, 503]
                                               : [{ manufacturer: { id: "new-org" } }, 201]));
    const h = host();
    render(<AdminHostContext.Provider value={h}><AddCompanyModal onClose={() => undefined} /></AdminHostContext.Provider>);
    fireEvent.change(screen.getByLabelText(/Company name/), { target: { value: "  Acme Castings " } });
    fireEvent.change(screen.getByLabelText(/^City/), { target: { value: "Hosur" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add company" })));
    expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add company" })));
    await waitFor(() => expect(h.went).toEqual(["/admin/manufacturers/new-org"]));
    expect(calls.map((c) => [c.method, c.url.endsWith("/admin/manufacturers")])).toEqual([["POST", true], ["POST", true]]);
    expect(calls[0].body).toEqual({ name: "Acme Castings", city: "Hosur" });
    expect(Object.keys(calls[0].body!).some((k) => /source/i.test(k))).toBe(false);
    expect(calls[0].headers["Idempotency-Key"]).toBeTruthy();
    expect(calls[1].headers["Idempotency-Key"]).toBe(calls[0].headers["Idempotency-Key"]);
    expect(toasts).toEqual(["Company added — source: Admin Entry"]);
  });

  it("duplicate: shows the message and opens the existing company", async () => {
    serve(() => [{ detail: "This company already exists: Acme. Open it instead of adding it again.",
                   code: "duplicate_company", existingId: "org-1" }, 409]);
    const h = host();
    render(<AdminHostContext.Provider value={h}><AddCompanyModal onClose={() => undefined} /></AdminHostContext.Provider>);
    fireEvent.change(screen.getByLabelText(/Company name/), { target: { value: "Acme" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add company" })));
    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open the existing company" }));
    expect(h.went).toEqual(["/admin/manufacturers/org-1"]);
  });

  it("ambiguous name or no permission: message only, no link", async () => {
    serve(() => [{ detail: "Only administrators and operators can add companies.", code: "forbidden", existingId: null }, 403]);
    render(<AdminHostContext.Provider value={host()}><AddCompanyModal onClose={() => undefined} /></AdminHostContext.Provider>);
    fireEvent.change(screen.getByLabelText(/Company name/), { target: { value: "Acme" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add company" })));
    expect(await screen.findByText(/Only administrators and operators/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open the existing company" })).toBeNull();
  });

  it("Cancel closes without calling the API", () => {
    const calls = serve(() => [{}, 500]);
    const onClose = vi.fn();
    render(<AdminHostContext.Provider value={host()}><AddCompanyModal onClose={onClose} /></AdminHostContext.Provider>);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});
