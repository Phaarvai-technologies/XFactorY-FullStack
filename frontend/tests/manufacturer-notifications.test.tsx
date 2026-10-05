// Manufacturer dashboard bell: messages from the X!Y team. The popup appears once for anything
// new; "Open notifications" shows the correction note, shared notes and edits and marks them read;
// "Later" only hides the popup. Backend answers are shaped like GET /manufacturer/notifications.
import { describe, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { NotificationBell } from "@/components/manufacturer/NotificationBell";

function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }
const flush = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });

const NOW = "2026-10-03T15:00:00Z";
const withNews = {
  items: [
    { id: "n3", kind: "profile_edit", title: "The X!Y team updated your profile", body: "About: “Old” → “Injection moulded food containers”\nReason: Typo", createdAt: NOW, read: false },
    { id: "n2", kind: "admin_note", title: "Message from the X!Y team", body: "The certificate must show the expiry date.", createdAt: NOW, read: false },
    { id: "n1", kind: "needs_correction", title: "Your profile needs a few corrections", body: "Upload a clearer ISO certificate", createdAt: NOW, read: true },
  ],
  unread: 2,
  popup: { count: 2, needsCorrection: true },
  correction: {
    reason: "Upload a clearer ISO certificate",
    requestedAt: NOW,
    notes: [{ id: "a1", note: "The certificate must show the expiry date.", createdAt: NOW }],
  },
};
const allRead = { ...withNews, items: withNews.items.map((i) => ({ ...i, read: true })), unread: 0, popup: null };
const quiet = { items: [], unread: 0, popup: null, correction: null };

let answer: unknown = withNews;
const sent: { url: string; method: string; body: string }[] = [];
(globalThis as unknown as { fetch: (url: string, init?: RequestInit) => Promise<Response> }).fetch = async (url, init) => {
  sent.push({ url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") });
  const body = (init?.method ?? "GET") === "GET" ? answer : allRead;
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
};
function reset(next: unknown) { answer = next; sent.length = 0; }
const bell = () => screen.getByRole("button", { name: /Notifications/ });

describe("Manufacturer notification bell", () => {
  it("Needs correction: popup on arrival, red dot on the bell", async () => {
    reset(withNews);
    render(<NotificationBell onOpenProfile={() => undefined} />);
    await flush();
    assert(sent[0]?.url.endsWith("/manufacturer/notifications") && sent[0].method === "GET", `first call: ${sent[0]?.url}`);
    assert(screen.getByRole("alertdialog"), "no popup");
    assert(screen.getByText("Your profile needs a few corrections", { selector: "h3" }), "popup title");
    assert(bell().getAttribute("aria-label") === "Notifications, 2 unread", bell().getAttribute("aria-label"));
    assert(bell().querySelector(".dot"), "no unread dot");
  });

  it("Open notifications: shows the correction note, shared notes and edits, then marks read", async () => {
    reset(withNews);
    let opened = 0;
    render(<NotificationBell onOpenProfile={() => { opened++; }} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Open notifications" }));
    await flush();
    assert(!screen.queryByRole("alertdialog"), "popup still open");
    const panel = screen.getByRole("dialog", { name: "Notifications" });
    assert(panel.textContent?.includes("Needs correction"), "correction box missing");
    assert(panel.querySelector(".notif-reason")?.textContent === "Upload a clearer ISO certificate", "reason missing");
    assert(panel.querySelector(".notif-correction li p")?.textContent === "The certificate must show the expiry date.", "shared note missing");
    assert(panel.textContent?.includes("Injection moulded food containers"), "edit missing");
    assert(panel.querySelectorAll(".notif-item.is-new").length === 2, "new items not highlighted");
    const read = sent.find((s) => s.url.endsWith("/notifications/read"));
    assert(read && read.method === "POST" && read.body === "{}", `read call: ${JSON.stringify(read)}`);
    assert(!bell().querySelector(".dot"), "dot still shown after reading");
    fireEvent.click(screen.getByRole("button", { name: "Update my profile" }));
    assert(opened === 1 && !screen.queryByRole("dialog", { name: "Notifications" }), "Update my profile did not open the profile");
  });

  it("Later: hides the popup and keeps the messages unread", async () => {
    reset(withNews);
    render(<NotificationBell />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    await flush();
    assert(!screen.queryByRole("alertdialog"), "popup still open");
    assert(sent.some((s) => s.url.endsWith("/notifications/popup-seen") && s.method === "POST"), "popup-seen not sent");
    assert(!sent.some((s) => s.url.endsWith("/notifications/read")), "Later marked them read");
  });

  it("Nothing new: no popup, no dot, empty panel says so", async () => {
    reset(quiet);
    render(<NotificationBell />);
    await flush();
    assert(!screen.queryByRole("alertdialog") && !bell().querySelector(".dot"), "popup or dot without news");
    fireEvent.click(bell());
    await flush();
    assert(screen.getByText("No messages from the X!Y team yet."), "empty state missing");
    assert(!sent.some((s) => s.method === "POST"), "posted without anything to mark");
    fireEvent.keyDown(document, { key: "Escape" });
    assert(!screen.queryByRole("dialog", { name: "Notifications" }), "Escape did not close");
  });

  it("A bad answer from the server leaves the bell quiet", async () => {
    reset({ detail: "Internal Server Error" });
    render(<NotificationBell />);
    await flush();
    assert(!screen.queryByRole("alertdialog") && !bell().querySelector(".dot"), "bad answer shown");
  });

});
