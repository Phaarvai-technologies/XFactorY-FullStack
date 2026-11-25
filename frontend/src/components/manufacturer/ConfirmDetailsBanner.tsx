"use client";

import { useClerk } from "@clerk/nextjs";
import { useState } from "react";
import { ApiError } from "@/lib/api";

/** Where a company's details came from and where their approval stands (backend app/invitations.py). */
export type DetailsState = {
  source: "entered_by_xfactory" | "confirmed_by_manufacturer" | null;
  at: string | null;
  by: string;
  reviewedAt: string | null;
  reviewedBy: string;
  /** manufacturer_onboarding.status: in_progress, submitted, changes_requested, approved, rejected… */
  approvalStatus?: string | null;
  /** The admin's correction note, while corrections are requested. */
  feedback?: string | null;
};

/** Which card the dashboard shows for a company the XfactorY team set up (null = none). */
export function confirmCardMode(details: DetailsState | null | undefined): "confirm" | "corrections" | "submitted" | null {
  if (!details) return null;
  if (details.approvalStatus === "changes_requested" && details.source) return "corrections";
  if (details.source === "entered_by_xfactory" && details.approvalStatus !== "approved") return "confirm";
  if (details.source === "confirmed_by_manufacturer" && details.approvalStatus === "submitted") return "submitted";
  return null;
}

/**
 * Magic-link flow on the manufacturer dashboard. The XfactorY team filled in this company's details
 * after a call: the owner checks them (Company Profile, Machinery), changes what is wrong and presses
 * "Confirm details", which sends the profile to XfactorY for approval (a separate step).
 */
export function ConfirmDetailsBanner({
  details,
  confirm,
  onConfirmed,
}: {
  details: DetailsState;
  confirm: () => Promise<DetailsState>;
  onConfirmed: (details: DetailsState) => void;
}) {
  const clerk = useClerk();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mode = confirmCardMode(details);
  if (!mode) return null;

  async function handleConfirm() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onConfirmed(await confirm());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We couldn't save that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "submitted") {
    return (
      <div className="card" role="status" style={{ marginBottom: 20 }}>
        <h3>Details sent for approval</h3>
        <p>
          Thank you for confirming your details. XfactorY is reviewing your profile; you will be notified when it is
          approved. You can keep adding to your profile meanwhile.
        </p>
      </div>
    );
  }

  return (
    <div className="card" role="status" style={{ marginBottom: 20 }}>
      {mode === "corrections" ? (
        <>
          <h3>XfactorY asked for a few corrections</h3>
          {details.feedback ? <p>{details.feedback}</p> : null}
          <p>Update your Company Profile or Machinery, then press Confirm details again.</p>
        </>
      ) : (
        <>
          <h3>Please check your details</h3>
          <p>
            The XfactorY team filled in your company details after speaking with you. Check your Company Profile and
            Machinery, change anything that is not right, then press Confirm details to send them for approval.
          </p>
        </>
      )}
      {error ? (
        <p role="alert" style={{ color: "var(--danger, #b91c1c)" }}>
          {error}
        </p>
      ) : null}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn-primary" onClick={handleConfirm} disabled={busy}>
          {busy ? "Sending…" : "Confirm details"}
        </button>
        {/* Clerk's account page: set a password or connect Google for later sign-ins. */}
        <button type="button" className="btn-ghost" onClick={() => clerk.openUserProfile()}>
          Sign-in options
        </button>
      </div>
    </div>
  );
}
