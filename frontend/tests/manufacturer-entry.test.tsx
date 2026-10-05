import "./setup";
import { describe, it, afterEach } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { ManufacturerApp } from "@/components/manufacturer/ManufacturerApp";
import existing from "./fixtures/bootstrap-existing.json";
import { clerkCalls, session } from "./mocks/clerk";
import { nav } from "./mocks/navigation";

afterEach(() => {
  cleanup();
});

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const joinShown = () =>
  !!screen.queryByText("Join Our Ecosystem");

const loadingShown = () =>
  !!screen.queryByText(/Loading your manufacturer account/i);

type Reply = {
  status: number;
  body: unknown;
};

let replies: Reply[] = [];
const calls: string[] = [];
let releaseFetch: (() => void) | null = null;

(globalThis as any).fetch = async (url: string) => {
  calls.push(String(url));

  if (String(url).includes("/manufacturer/notifications")) {
    return new Response(
      JSON.stringify({
        items: [],
        unread: 0,
        popup: null,
        correction: null,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (releaseFetch === null) {
    await new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
  }

  const reply = replies.shift() ?? {
    status: 200,
    body: existing,
  };

  return new Response(JSON.stringify(reply.body), {
    status: reply.status,
    headers: { "Content-Type": "application/json" },
  });
};

async function answer() {
  releaseFetch?.();
  releaseFetch = () => undefined;
  await flush();
  await flush();
}

function reset(path: string, signedIn = true) {
  session.isSignedIn = signedIn;
  session.userId = signedIn ? `user_${Math.random()}` : null;
  session.tokens = [];

  clerkCalls.length = 0;

  nav.pathname = path;
  nav.pushed.length = 0;
  nav.replaced.length = 0;

  calls.length = 0;
  replies = [];
  releaseFetch = null;
}

describe("Manufacturer portal entry", () => {
  it("loads an existing account without flashing the Join page", async () => {
    reset("/manufacturer");
    render(<ManufacturerApp />);

    await flush();

    assert(loadingShown(), "No loading indicator while checking");
    assert(!joinShown(), "Join page flashed before checking finished");

    await answer();

    assert(!joinShown(), "Join page shown for an existing account");
    assert(
      nav.replaced.includes("/manufacturer/dashboard"),
      `Not sent to the dashboard: ${nav.replaced}`,
    );

    await act(async () => {
      nav.go("/manufacturer/dashboard");
    });
    await flush();

    assert(
      screen.getByText(/Welcome, Meera/),
      "Dashboard not shown with saved data",
    );

    const loads = calls.filter((url) =>
      url.includes("/manufacturer/bootstrap"),
    );

    assert(
      loads.length === 1,
      `Expected one bootstrap load, got ${loads.length}`,
    );
  });

  it("shows saved areas, certifications and machinery on the first open", async () => {
    reset("/manufacturer");
    render(<ManufacturerApp />);

    await answer();

    await act(async () => {
      nav.go("/manufacturer/dashboard");
    });
    await flush();

    const availabilityButton = screen
      .getAllByRole("button")
      .find((button) =>
        /availability/i.test(button.textContent ?? ""),
      );

    assert(availabilityButton, "Availability button missing");
    fireEvent.click(availabilityButton!);
    await flush();

    const select = document.getElementById(
      "cap-machine",
    ) as HTMLSelectElement | null;

    assert(select, "Machinery selector missing");

    const options = Array.from(select!.options)
      .map((option) => option.value)
      .filter(Boolean);

    assert(
      JSON.stringify(options) ===
        '["Thermoforming","Injection Moulding"]',
      `Unexpected machinery options: ${options}`,
    );

    assert(
      select!.value === "Injection Moulding",
      `Saved plan not selected: ${select!.value}`,
    );

    const backButton = document.querySelector(".panel-back");
    assert(backButton, "Back button missing");
    fireEvent.click(backButton!);
    await flush();

    const profileButton = screen
      .getAllByRole("button")
      .find((button) =>
        /company profile/i.test(button.textContent ?? ""),
      );

    assert(profileButton, "Company profile button missing");
    fireEvent.click(profileButton!);
    await flush();

    fireEvent.click(
      screen.getByRole("button", { name: "Open profile setup" }),
    );
    await flush();

    fireEvent.click(
      screen.getByRole("button", { name: "Get started" }),
    );
    await flush();
    await flush();

    fireEvent.click(
      screen.getByRole("button", { name: "Save & Next" }),
    );
    await flush();
    await flush();

    assert(
      screen.getByText("Tamil Nadu") &&
        screen.getByText("South India"),
      "Saved serviceable areas not shown",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save & Next" }),
    );
    await flush();
    await flush();

    assert(
      screen.getByText("ISO 9001:2015"),
      "Saved certification not shown",
    );
  });

  it("shows the Join page after confirming no account exists", async () => {
    reset("/manufacturer");

    replies = [
      {
        status: 200,
        body: { ...existing, accountExists: false },
      },
    ];

    render(<ManufacturerApp />);
    await flush();

    assert(
      loadingShown() && !joinShown(),
      "Join page shown before checking finished",
    );

    await answer();

    assert(joinShown(), "Join page missing for a user without an account");
    assert(
      nav.replaced.length === 0,
      `Unexpected redirect: ${nav.replaced}`,
    );

    fireEvent.click(screen.getByText("Join Our Ecosystem"));

    assert(
      nav.pushed.includes("/manufacturer/account"),
      `Join did not open the account form: ${nav.pushed}`,
    );
  });

  it("shows the Join page for signed-out users without calling the backend", async () => {
    reset("/manufacturer", false);
    render(<ManufacturerApp />);
    await flush();

    assert(
      joinShown() && calls.length === 0,
      "Expected the signed-out Join page without a backend call",
    );
  });

  it("retries when the authentication token is not ready", async () => {
    reset("/manufacturer");
    session.tokens = [null];

    render(<ManufacturerApp />);

    await act(async () => {
      releaseFetch = () => undefined;
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    await flush();

    assert(!joinShown(), "Join page shown after a token delay");
    assert(
      nav.replaced.includes("/manufacturer/dashboard"),
      `Not sent to the dashboard: ${nav.replaced}`,
    );
  });

  it("redirects an existing account away from the account form", async () => {
    reset("/manufacturer/account");
    render(<ManufacturerApp />);
    await flush();

    assert(
      loadingShown() && !screen.queryByText(/Date of birth/i),
      "Account form flashed before checking finished",
    );

    await answer();

    assert(
      nav.replaced.includes("/manufacturer/dashboard"),
      `Not redirected to the dashboard: ${nav.replaced}`,
    );
  });

  it("opens the user menu and supports Manage account, Escape and Sign out", async () => {
    reset("/manufacturer/dashboard");
    render(<ManufacturerApp />);
    await answer();

    const chip = document.querySelector(
      ".avatar-chip",
    ) as HTMLButtonElement | null;

    assert(chip, "User menu button missing");
    assert(!screen.queryByRole("menu"), "Menu open before clicking");

    fireEvent.click(chip!);
    await flush();

    assert(screen.getByRole("menu"), "Menu did not open");
    assert(
      screen.getByText("test user22") &&
        screen.getByText("testuser22@example.com"),
      "User details missing",
    );
    assert(
      !screen.queryByText(/demo only/),
      "Old demo message still shown",
    );

    fireEvent.click(
      screen.getByRole("menuitem", { name: "Manage account" }),
    );
    await flush();

    assert(
      clerkCalls.includes("openUserProfile") &&
        !screen.queryByRole("menu"),
      "Manage account did not open the profile or close the menu",
    );

    fireEvent.click(chip!);
    await flush();

    fireEvent.keyDown(document, { key: "Escape" });
    await flush();

    assert(!screen.queryByRole("menu"), "Escape did not close the menu");

    fireEvent.click(chip!);
    await flush();

    fireEvent.click(
      screen.getByRole("menuitem", { name: "Sign out" }),
    );
    await flush();

    assert(
      clerkCalls.includes("signOut:/"),
      `Sign out not called: ${clerkCalls}`,
    );
  });
});