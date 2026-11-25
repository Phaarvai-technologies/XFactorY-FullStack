/**
 * "Send on WhatsApp" on the admin Magic link card: WhatsApp's free click-to-chat link opens with the
 * manufacturer's number and the invitation message (same content as the email); the team presses Send.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invitationMessage, respondByLabel, whatsappNumber, whatsappUrl } from "@/lib/admin/whatsapp";

const h = vi.hoisted(() => ({ data: null as unknown, toasts: [] as string[] }));
vi.mock("@/lib/admin/api", () => ({
  useAdminApi: () => vi.fn(),
  useResource: () => ({ data: h.data, reload: () => undefined }),
  jsonBody: (method: string, body: unknown) => ({ method, body: JSON.stringify(body) }),
}));
vi.mock("@/components/admin/AdminShell", () => ({ useToast: () => (m: string) => h.toasts.push(m) }));

import { InvitationPanel } from "@/components/admin/InvitationPanel";

const LINK = "https://phaarvai.com/projects/xfactory/invite/AbC123";
function invitation(phone: string) {
  return {
    id: "inv-1", companyName: "Nilgiri Food Packaging", email: "lakshmi@nilgiri.in", contactName: "Lakshmi Narayanan",
    phone, status: "invited", expiresAt: "2026-12-09T10:00:00Z", openedAt: null, openCount: 0, acceptedAt: null,
    remindersSent: 0, lastSentAt: "2026-11-25T10:00:00Z", sendCount: 1, createdBy: "Priya", link: LINK,
  };
}
const details = { source: "entered_by_xfactory", at: null, by: "", reviewedAt: null, reviewedBy: "" };

let opened: string[];
beforeEach(() => {
  opened = [];
  h.toasts = [];
  vi.stubGlobal("open", (url: string) => { opened.push(url); return null; });
});
afterEach(() => vi.unstubAllGlobals());

describe("WhatsApp helpers", () => {
  it.each([
    ["+91 98430 23456", "919843023456"],
    ["98430 23456", "919843023456"],
    ["098430-23456", "919843023456"],
    ["0091 9843023456", "919843023456"],
    ["+1 (415) 555-0101", "14155550101"],
    ["", null],
    ["12345", null],
  ])("%s → %s", (input, expected) => {
    expect(whatsappNumber(input)).toBe(expected);
  });

  it("message: same content as the invitation email, with name, company and link", () => {
    const text = invitationMessage("Lakshmi Narayanan", "Nilgiri Food Packaging", LINK);
    expect(text).toBe([
      "Hello Lakshmi,",
      "Thank you for speaking with the XfactorY team. Your account for *Nilgiri Food Packaging* is ready.",
      "",
      "Open it here (no password needed):",
      LINK,
      "",
    "Please check your details, add anything missing and press *Confirm details* within 7 days.",
    "The link works for 14 days.",
      "",
      "– XfactorY Team",
    ].join("\n"));
  });

  it("message: shows the confirm-by date in Indian time, like the email", () => {
    // sent 25 Nov 2026 20:00 UTC = 26 Nov 01:30 IST → confirm by 3 Dec 2026
    const text = invitationMessage("Lakshmi", "Nilgiri", LINK, "2026-12-02T20:00:00+00:00");
    expect(text).toContain("press *Confirm details* within 7 days (by 3 Dec 2026).");
    expect(text).toContain("The link works for 14 days.");
    expect(respondByLabel("not a date")).toBeNull();
  });

  it("url: wa.me with the number and the encoded message; no number → WhatsApp asks whom", () => {
    expect(whatsappUrl("+91 98430 23456", "Hi & link")).toBe("https://wa.me/919843023456?text=Hi%20%26%20link");
    expect(whatsappUrl(null, "Hi")).toBe("https://wa.me/?text=Hi");
  });
});

describe("Magic link card", () => {
  it("Send on WhatsApp opens WhatsApp to the manufacturer with the message and link", () => {
    h.data = { invitations: [invitation("+91 98430 23456")], details, canInvite: true };
    render(<InvitationPanel orgId="org-1" hasOwner={false} onChanged={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Send on WhatsApp" }));
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0]);
    expect(url.origin + url.pathname).toBe("https://wa.me/919843023456");
    expect(url.searchParams.get("text")).toContain("Your account for *Nilgiri Food Packaging* is ready.");
    expect(url.searchParams.get("text")).toContain(LINK);
    expect(h.toasts.at(-1)).toBe("WhatsApp opened with the message. Press Send there.");
  });

  it("no phone number: WhatsApp still opens with the message, the team picks the chat", () => {
    h.data = { invitations: [invitation("")], details, canInvite: true };
    render(<InvitationPanel orgId="org-1" hasOwner={false} onChanged={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Send on WhatsApp" }));
    expect(opened[0].startsWith("https://wa.me/?text=")).toBe(true);
    expect(h.toasts.at(-1)).toMatch(/Choose the manufacturer's chat/);
  });

  it("no button once the account is set up (the link no longer works)", () => {
    h.data = { invitations: [{ ...invitation("+91 98430 23456"), status: "accepted", link: null }], details, canInvite: true };
    render(<InvitationPanel orgId="org-1" hasOwner={true} onChanged={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Send on WhatsApp" })).toBeNull();
  });

  it("support staff (cannot invite) do not get the button", () => {
    h.data = { invitations: [invitation("+91 98430 23456")], details, canInvite: false };
    render(<InvitationPanel orgId="org-1" hasOwner={false} onChanged={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Send on WhatsApp" })).toBeNull();
  });
});
