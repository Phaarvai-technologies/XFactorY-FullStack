"use client";

import { useAuth } from "@clerk/nextjs";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { AccountScreen, type AccountSubmission } from "@/components/manufacturer/AccountScreen";
import { DashboardScreen } from "@/components/manufacturer/DashboardScreen";
import { LandingScreen } from "@/components/manufacturer/LandingScreen";
import { MachineryWizard, type MachineryDraft } from "@/components/manufacturer/MachineryWizard";
import {
  createBlankProfileData,
  ProfileWizard,
  type ProfileWizardData,
} from "@/components/manufacturer/ProfileWizard";
import { RecurringModal } from "@/components/manufacturer/RecurringModal";
import { CheckIcon } from "@/components/manufacturer/icons";
import { api, ApiError } from "@/lib/api";
import {
  isManufacturerAccountPath,
  isManufacturerDashboardPath,
  MANUFACTURER_ACCOUNT_PATH,
  MANUFACTURER_DASHBOARD_PATH,
  MANUFACTURER_OVERVIEW_PATH,
  manufacturerCreateAccountHref,
  markManufacturerProfileComplete,
} from "@/lib/auth/manufacturerAccess";
import {
  createInitialManufacturerState,
  type BookingRequest,
  type MachineryListing,
  type ManufacturerState,
  type RecurringAvailability,
} from "@/lib/manufacturer/types";

type Screen = "landing" | "account" | "dashboard";

/**
 * Shape returned by every Manufacturer API call (GET /manufacturer/bootstrap and
 * all mutations). Identical to the UI state except that database ids are UUIDs.
 */
type ServerSnapshot = {
  accountExists: boolean;
  state: Omit<ManufacturerState, "machinery" | "bookings"> & {
    machinery: (Omit<MachineryListing, "id"> & { id: string })[];
    bookings: (Omit<BookingRequest, "id"> & { id: string })[];
  };
  profileData: ProfileWizardData;
};

const SAVE_DELAY_MS = 700;

function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

function screenFromPathname(pathname: string): Screen {
  if (isManufacturerDashboardPath(pathname)) return "dashboard";
  if (isManufacturerAccountPath(pathname)) return "account";
  return "landing";
}

function applyAccountSubmission(
  submission: AccountSubmission,
  setState: Dispatch<SetStateAction<ManufacturerState>>,
  setProfileData: Dispatch<SetStateAction<ProfileWizardData>>,
) {
  setState((current) => ({
    ...current,
    account: {
      firstName: submission.firstName,
      lastName: submission.lastName,
      companyName: submission.companyName,
      companyType: submission.companyType,
      country: submission.country,
      dob: submission.dob,
      phone: submission.phone,
      capacity: submission.capacity,
    },
    contact: isValidEmail(submission.contact)
      ? { email: submission.contact, phone: "" }
      : { email: "", phone: submission.contact },
  }));
  setProfileData((current) => ({
    ...current,
    company: { ...current.company, name: submission.companyName },
  }));
}

export function ManufacturerApp() {
  const router = useRouter();
  const pathname = usePathname();
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const screen = screenFromPathname(pathname);

  const [state, setState] = useState<ManufacturerState>(createInitialManufacturerState);
  const [profileData, setProfileData] = useState<ProfileWizardData>(() =>
    createBlankProfileData(),
  );
  const [profileWizardOpen, setProfileWizardOpen] = useState(false);
  const [profileWizardStep, setProfileWizardStep] = useState(1);
  const [machineryWizardOpen, setMachineryWizardOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({
    message: "",
    visible: false,
  });
  const toastTimer = useRef<number | null>(null);

  // ---- Backend connection state -------------------------------------------
  /**
   * What the database says about the signed-in user (null = not checked yet).
   * The saved Manufacturer account decides form vs dashboard, so a returning
   * user is never asked for their details again (any device, after sign-out).
   */
  const [server, setServer] = useState<{
    userId: string;
    accountExists: boolean;
    failed: boolean;
  } | null>(null);
  const checked = server !== null && server.userId === userId;
  /** UI components use numeric ids; the database uses UUIDs. */
  const ids = useRef({ toServer: new Map<number, string>(), toLocal: new Map<string, number>(), next: 1 });
  const profileSaveTimer = useRef<number | null>(null);
  const pendingProfile = useRef<ProfileWizardData | null>(null);
  const availabilityTimer = useRef<number | null>(null);
  const availabilityDirty = useRef(false);

  const showToast = useCallback((message: string) => {
    setToast({ message, visible: true });
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
    }
    toastTimer.current = window.setTimeout(() => {
      setToast((current) => ({ ...current, visible: false }));
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) {
        window.clearTimeout(toastTimer.current);
      }
    };
  }, []);

  const request = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const token = await getToken();
      if (!token) throw new ApiError(401, "Your session has expired. Please sign in again.");
      return api<T>(path, token, init);
    },
    [getToken],
  );

  const localId = useCallback((serverId: string): number => {
    const map = ids.current;
    let id = map.toLocal.get(serverId);
    if (id === undefined) {
      id = map.next++;
      map.toLocal.set(serverId, id);
      map.toServer.set(id, serverId);
    }
    return id;
  }, []);

  const toLocalMachinery = useCallback(
    (items: ServerSnapshot["state"]["machinery"]): MachineryListing[] =>
      items.map((m) => ({ ...m, id: localId(m.id) })),
    [localId],
  );

  const toLocalBookings = useCallback(
    (items: ServerSnapshot["state"]["bookings"]): BookingRequest[] =>
      items.map((b) => ({ ...b, id: localId(b.id) })),
    [localId],
  );

  /** Replace the whole UI state with the server's (initial load / after account creation). */
  const applySnapshot = useCallback(
    (snapshot: ServerSnapshot) => {
      setState({
        ...snapshot.state,
        machinery: toLocalMachinery(snapshot.state.machinery),
        bookings: toLocalBookings(snapshot.state.bookings),
      });
      setProfileData(snapshot.profileData);
    },
    [toLocalBookings, toLocalMachinery],
  );

  /** Re-read everything after a failed mutation so the UI never shows unsaved data. */
  const resync = useCallback(async () => {
    try {
      const snapshot = await request<ServerSnapshot>("/manufacturer/bootstrap");
      setState((current) => ({
        ...current,
        machinery: toLocalMachinery(snapshot.state.machinery),
        bookings: toLocalBookings(snapshot.state.bookings),
      }));
    } catch {
      // Keep the current screen; the error toast has already been shown.
    }
  }, [request, toLocalBookings, toLocalMachinery]);

  // Auth + route guards (does not replace Clerk; only keeps screens in sync).
  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      // Dashboard only — account redirects are handled by the server page so we
      // don't race a freshly activated Clerk session after Explore → sign-in/up.
      if (isManufacturerDashboardPath(pathname)) {
        router.replace(MANUFACTURER_OVERVIEW_PATH);
      }
      return;
    }

    if (!checked || server.failed) return;
    // Details already saved -> never show the form again; not saved yet -> fill them first.
    if (isManufacturerAccountPath(pathname) && server.accountExists) {
      router.replace(MANUFACTURER_DASHBOARD_PATH);
    } else if (isManufacturerDashboardPath(pathname) && !server.accountExists) {
      router.replace(MANUFACTURER_ACCOUNT_PATH);
    }
  }, [checked, isLoaded, isSignedIn, pathname, router, server]);

  // Load the manufacturer's saved data from the backend.
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) return;
    if (screen === "landing" || checked) return;
    let cancelled = false;

    request<ServerSnapshot>("/manufacturer/bootstrap")
      .then((snapshot) => {
        if (cancelled) return;
        applySnapshot(snapshot);
        if (snapshot.accountExists) markManufacturerProfileComplete();
        setServer({ userId, accountExists: snapshot.accountExists, failed: false });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Backend unreachable: keep the current screen usable and say why.
        setState((current) => ({ ...current, bookings: [] }));
        setServer({ userId, accountExists: false, failed: true });
        showToast(`Couldn’t load your data — ${errorMessage(error)}`);
      });

    return () => {
      cancelled = true;
    };
  }, [applySnapshot, checked, isLoaded, isSignedIn, request, screen, showToast, userId]);

  const flags = {
    companyDetailsDone: profileData.company.name.trim() !== "" && state.epic2.companyDetailsDone,
    locationDone: state.epic2.locationDone,
    certsDone: profileData.certifications.length > 0,
    infraDone: state.epic2.infraDone,
    faqDone: profileData.faqs.length > 0,
  };
  const doneCount = Object.values(flags).filter(Boolean).length;
  const pct = Math.round(15 + (doneCount / 5) * 85);

  async function handleAccountCreated(submission: AccountSubmission) {
    let snapshot: ServerSnapshot;
    try {
      snapshot = await request<ServerSnapshot>("/manufacturer/account", {
        method: "POST",
        body: JSON.stringify(submission),
      });
    } catch (error) {
      showToast(`Couldn’t create your account — ${errorMessage(error)}`);
      throw error; // lets AccountScreen re-enable the submit button
    }
    applySnapshot(snapshot);
    applyAccountSubmission(submission, setState, setProfileData);
    if (userId) setServer({ userId, accountExists: true, failed: false });
    markManufacturerProfileComplete();
    router.push(MANUFACTURER_DASHBOARD_PATH);
    showToast("Account created — let’s build your profile.");
  }

  function handleOpenProfileWizard(jumpToNextIncomplete: boolean) {
    if (jumpToNextIncomplete) {
      const order: (keyof typeof flags)[] = [
        "companyDetailsDone",
        "locationDone",
        "certsDone",
        "infraDone",
        "faqDone",
      ];
      const idx = order.findIndex((key) => !flags[key]);
      const step = idx === -1 ? 1 : idx + 2;
      setProfileWizardStep(step > 5 ? 1 : step);
    } else {
      setProfileWizardStep(1);
    }
    setProfileWizardOpen(true);
  }

  const flushProfileSave = useCallback(() => {
    if (profileSaveTimer.current !== null) {
      window.clearTimeout(profileSaveTimer.current);
      profileSaveTimer.current = null;
    }
    const data = pendingProfile.current;
    if (!data) return;
    pendingProfile.current = null;
    request<ServerSnapshot>("/manufacturer/profile", {
      method: "PUT",
      body: JSON.stringify(data),
    }).catch((error: unknown) => {
      showToast(`Profile not saved — ${errorMessage(error)}`);
    });
  }, [request, showToast]);

  function handleProfileChange(data: ProfileWizardData) {
    setProfileData(data);
    setState((current) => ({
      ...current,
      epic2: {
        companyDetailsDone: data.company.name.trim() !== "" && data.company.about.trim() !== "",
        locationDone:
          data.location.address.trim() !== "" &&
          data.location.city.trim() !== "" &&
          data.location.country !== "",
        certifications: data.certifications,
        infraDone: Object.values(data.infra).some((value) => value.trim() !== ""),
        faqs: data.faqs,
      },
      serviceableAreas: data.location.serviceableAreas,
    }));
    // Save to the backend (batched so quick successive edits send one request).
    pendingProfile.current = data;
    if (profileSaveTimer.current !== null) window.clearTimeout(profileSaveTimer.current);
    profileSaveTimer.current = window.setTimeout(flushProfileSave, SAVE_DELAY_MS);
  }

  function handleMachineryPublish(draft: MachineryDraft, status: "Draft" | "Published") {
    const tempId = ids.current.next++;
    setState((current) => ({
      ...current,
      machinery: [
        {
          ...draft,
          id: tempId,
          status,
        },
        ...current.machinery,
      ],
    }));
    setMachineryWizardOpen(false);
    showToast(status === "Published" ? "Listing published." : "Saved as draft.");

    request<ServerSnapshot>("/manufacturer/machinery", {
      method: "POST",
      body: JSON.stringify({ ...draft, status }),
    })
      .then((snapshot) => {
        setState((current) => ({ ...current, machinery: toLocalMachinery(snapshot.state.machinery) }));
      })
      .catch((error: unknown) => {
        setState((current) => ({
          ...current,
          machinery: current.machinery.filter((m) => m.id !== tempId),
        }));
        showToast(`Listing not saved — ${errorMessage(error)}`);
      });
  }

  function handleSetMachineryStatus(id: number, status: ManufacturerState["machinery"][number]["status"]) {
    setState((current) => ({
      ...current,
      machinery: current.machinery.map((m) => (m.id === id ? { ...m, status } : m)),
    }));
    showToast(`Listing status: ${status}.`);

    const serverId = ids.current.toServer.get(id);
    // Listing still being created: the create response restores its saved status.
    if (!serverId) return;
    request<ServerSnapshot>(`/manufacturer/machinery/${serverId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }).catch((error: unknown) => {
      showToast(`Status not saved — ${errorMessage(error)}`);
      void resync();
    });
  }

  // Calendar / recurring / capacity: one batched save of all three.
  useEffect(() => {
    if (!availabilityDirty.current) return;
    availabilityDirty.current = false;
    if (availabilityTimer.current !== null) window.clearTimeout(availabilityTimer.current);
    const body = JSON.stringify({
      calendar: state.calendar,
      recurring: state.recurring,
      capacity: state.capacity,
    });
    availabilityTimer.current = window.setTimeout(() => {
      availabilityTimer.current = null;
      request<ServerSnapshot>("/manufacturer/availability", { method: "PUT", body }).catch(
        (error: unknown) => {
          showToast(`Availability not saved — ${errorMessage(error)}`);
        },
      );
    }, SAVE_DELAY_MS);
  }, [request, showToast, state.calendar, state.recurring, state.capacity]);

  // Send any pending profile edits before leaving the page.
  useEffect(() => {
    return () => {
      if (pendingProfile.current) flushProfileSave();
    };
  }, [flushProfileSave]);

  function handleCycleDay(key: string) {
    availabilityDirty.current = true;
    setState((current) => {
      const calendar = { ...current.calendar };
      const currentStatus = calendar[key];
      if (!currentStatus) {
        calendar[key] = "available";
      } else if (currentStatus === "available") {
        calendar[key] = "blocked";
      } else {
        delete calendar[key];
      }
      return { ...current, calendar };
    });
  }

  function handleSaveCapacity(plan: ManufacturerState["capacity"]) {
    availabilityDirty.current = true;
    setState((current) => ({ ...current, capacity: plan }));
    showToast("Capacity saved.");
  }

  function handleSaveRecurring(recurring: RecurringAvailability) {
    if (!recurring.days.length || !recurring.start || !recurring.end) {
      showToast("Pick at least one day and a start/end time.");
      return;
    }
    availabilityDirty.current = true;
    setState((current) => ({ ...current, recurring }));
    setRecurringOpen(false);
    showToast("Recurring availability saved.");
  }

  function decideBooking(id: number, decision: "accepted" | "declined") {
    const serverId = ids.current.toServer.get(id);
    if (!serverId) return;
    request<ServerSnapshot>(`/manufacturer/booking-requests/${serverId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: decision }),
    })
      .then((snapshot) => {
        setState((current) => ({ ...current, bookings: toLocalBookings(snapshot.state.bookings) }));
      })
      .catch((error: unknown) => {
        showToast(`Booking not updated — ${errorMessage(error)}`);
        void resync();
      });
  }

  function handleAcceptBooking(id: number) {
    setState((current) => ({
      ...current,
      bookings: current.bookings.map((b) => (b.id === id ? { ...b, status: "Booked" } : b)),
    }));
    showToast("Booking confirmed.");
    decideBooking(id, "accepted");
  }

  function handleDeclineBooking(id: number) {
    setState((current) => ({
      ...current,
      bookings: current.bookings.map((b) => (b.id === id ? { ...b, status: "Cancelled" } : b)),
    }));
    showToast("Declined — capacity released back to Available.");
    decideBooking(id, "declined");
  }

  if (!isLoaded) {
    return <div className="mfg-root" aria-busy="true" />;
  }

  // Avoid flashing the wrong screen while redirects settle.
  if (!isSignedIn && (screen === "dashboard" || screen === "account")) {
    return <div className="mfg-root" aria-busy="true" />;
  }

  // Wait for the saved data (and any redirect) instead of flashing the wrong screen.
  if (isSignedIn && (screen === "dashboard" || screen === "account")) {
    const redirecting =
      checked &&
      !server.failed &&
      (screen === "account" ? server.accountExists : !server.accountExists);
    if (!checked || redirecting) {
      return <div className="mfg-root" aria-busy="true" />;
    }
  }

  return (
    <div className="mfg-root">
      {screen === "landing" ? (
        <LandingScreen
          onJoin={() => {
            // Signed-in → profile setup. Signed-out → existing Create Account.
            router.push(
              isSignedIn ? MANUFACTURER_ACCOUNT_PATH : manufacturerCreateAccountHref(),
            );
          }}
          onBackToLanding={() => {
            router.push("/");
          }}
        />
      ) : null}

      {screen === "account" ? (
        <AccountScreen
          onBack={() => {
            router.push(MANUFACTURER_OVERVIEW_PATH);
            window.scrollTo(0, 0);
          }}
          onAccountCreated={handleAccountCreated}
        />
      ) : null}

      {screen === "dashboard" ? (
        <>
          <DashboardScreen
            state={state}
            pct={pct}
            flags={flags}
            onOpenProfileWizard={handleOpenProfileWizard}
            onOpenMachineryWizard={() => setMachineryWizardOpen(true)}
            onSetMachineryStatus={handleSetMachineryStatus}
            onSaveCapacity={handleSaveCapacity}
            onCycleDay={handleCycleDay}
            onOpenRecurringModal={() => setRecurringOpen(true)}
            onAcceptBooking={handleAcceptBooking}
            onDeclineBooking={handleDeclineBooking}
            onBackToLanding={() => {
              router.push("/");
            }}
            showToast={showToast}
          />

          {profileWizardOpen ? (
            <ProfileWizard
              firstName={state.account.firstName}
              flags={flags}
              pct={pct}
              initialStep={profileWizardStep}
              data={profileData}
              onChange={handleProfileChange}
              onExit={() => {
                setProfileWizardOpen(false);
                flushProfileSave();
              }}
              onFinish={() => undefined}
              showToast={showToast}
            />
          ) : null}

          {machineryWizardOpen ? (
            <MachineryWizard
              onClose={() => setMachineryWizardOpen(false)}
              onPublish={handleMachineryPublish}
              showToast={showToast}
            />
          ) : null}

          {recurringOpen ? (
            <RecurringModal
              onClose={() => setRecurringOpen(false)}
              onSave={(days, start, end) => handleSaveRecurring({ days, start, end })}
            />
          ) : null}
        </>
      ) : null}

      <div className={`toast${toast.visible ? " show" : ""}`} role="status" aria-live="polite">
        <CheckIcon size={15} stroke="#4ade80" />
        <span>{toast.message}</span>
      </div>
    </div>
  );
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
