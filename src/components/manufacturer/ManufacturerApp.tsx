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
import {
  isManufacturerAccountPath,
  isManufacturerDashboardPath,
  MANUFACTURER_ACCOUNT_PATH,
  MANUFACTURER_DASHBOARD_PATH,
  MANUFACTURER_OVERVIEW_PATH,
  manufacturerCreateAccountHref,
  markManufacturerProfileComplete,
  readManufacturerProfileComplete,
} from "@/lib/auth/manufacturerAccess";
import {
  createInitialManufacturerState,
  type ManufacturerState,
  type RecurringAvailability,
} from "@/lib/manufacturer/types";

type Screen = "landing" | "account" | "dashboard";

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
  const { isLoaded, isSignedIn } = useAuth();
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

    // After profile is complete, don't show the setup form again.
    if (isManufacturerAccountPath(pathname) && readManufacturerProfileComplete()) {
      router.replace(MANUFACTURER_DASHBOARD_PATH);
    }
  }, [isLoaded, isSignedIn, pathname, router]);

  const flags = {
    companyDetailsDone: profileData.company.name.trim() !== "" && state.epic2.companyDetailsDone,
    locationDone: state.epic2.locationDone,
    certsDone: profileData.certifications.length > 0,
    infraDone: state.epic2.infraDone,
    faqDone: profileData.faqs.length > 0,
  };
  const doneCount = Object.values(flags).filter(Boolean).length;
  const pct = Math.round(15 + (doneCount / 5) * 85);

  function handleAccountCreated(submission: AccountSubmission) {
    applyAccountSubmission(submission, setState, setProfileData);
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
  }

  function handleMachineryPublish(draft: MachineryDraft, status: "Draft" | "Published") {
    setState((current) => ({
      ...current,
      machinery: [
        {
          ...draft,
          id: (current.machinery[0]?.id ?? 0) + 1,
          status,
        },
        ...current.machinery,
      ],
    }));
    setMachineryWizardOpen(false);
    showToast(status === "Published" ? "Listing published." : "Saved as draft.");
  }

  function handleSetMachineryStatus(id: number, status: ManufacturerState["machinery"][number]["status"]) {
    setState((current) => ({
      ...current,
      machinery: current.machinery.map((m) => (m.id === id ? { ...m, status } : m)),
    }));
    showToast(`Listing status: ${status}.`);
  }

  function handleCycleDay(key: string) {
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
    setState((current) => ({ ...current, capacity: plan }));
    showToast("Capacity saved.");
  }

  function handleSaveRecurring(recurring: RecurringAvailability) {
    if (!recurring.days.length || !recurring.start || !recurring.end) {
      showToast("Pick at least one day and a start/end time.");
      return;
    }
    setState((current) => ({ ...current, recurring }));
    setRecurringOpen(false);
    showToast("Recurring availability saved.");
  }

  function handleAcceptBooking(id: number) {
    setState((current) => ({
      ...current,
      bookings: current.bookings.map((b) => (b.id === id ? { ...b, status: "Booked" } : b)),
    }));
    showToast("Booking confirmed.");
  }

  function handleDeclineBooking(id: number) {
    setState((current) => ({
      ...current,
      bookings: current.bookings.map((b) => (b.id === id ? { ...b, status: "Cancelled" } : b)),
    }));
    showToast("Declined — capacity released back to Available.");
  }

  if (!isLoaded) {
    return <div className="mfg-root" aria-busy="true" />;
  }

  // Avoid flashing the wrong screen while redirects settle.
  if (!isSignedIn && (screen === "dashboard" || screen === "account")) {
    return <div className="mfg-root" aria-busy="true" />;
  }

  if (
    isSignedIn &&
    screen === "account" &&
    readManufacturerProfileComplete()
  ) {
    return <div className="mfg-root" aria-busy="true" />;
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
              onExit={() => setProfileWizardOpen(false)}
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
