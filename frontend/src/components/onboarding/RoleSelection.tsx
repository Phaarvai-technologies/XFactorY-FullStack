"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PersonaIcons } from "@/components/home/PersonaIcons";
import { Button } from "@/components/ui/Button";
import { api, ApiError } from "@/lib/api";
import {
  MANUFACTURER_ACCOUNT_PATH,
  MANUFACTURER_DASHBOARD_PATH,
  MANUFACTURER_ROLE,
} from "@/lib/auth/manufacturerAccess";
import {
  readSelectedRoles,
  toggleRole,
  writeSelectedRoles,
} from "@/lib/auth/roles";
import { PERSONAS, type PersonaId } from "@/types/personas";

/** GET /identity/me and PUT /identity/me/roles (backend). */
type IdentitySummary = { roles: PersonaId[]; manufacturerAccountExists: boolean };

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

export function RoleSelection() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [selected, setSelected] = useState<PersonaId[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Selected roles are stored in the database, so they are still there after
  // signing out or closing the browser. localStorage is only a fallback.
  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;

    async function loadRoles() {
      try {
        const token = isSignedIn ? await getToken() : null;
        if (!token) throw new Error("Please sign in to save your roles.");
        const identity = await api<IdentitySummary>("/identity/me", token);
        if (cancelled) return;
        setSelected(identity.roles);
        writeSelectedRoles(identity.roles);
      } catch (caught) {
        if (cancelled) return;
        setSelected(readSelectedRoles());
        setError(errorText(caught, "Couldn’t load your saved roles."));
      } finally {
        if (!cancelled) setHydrated(true);
      }
    }

    void loadRoles();
    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn]);

  function handleSelect(roleId: PersonaId) {
    setSelected((current) => toggleRole(current, roleId));
  }

  async function handleContinue() {
    setSaving(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session has expired. Please sign in again.");
      const identity = await api<IdentitySummary>("/identity/me/roles", token, {
        method: "PUT",
        body: JSON.stringify({ roles: selected }),
      });
      writeSelectedRoles(identity.roles);
      if (identity.roles.includes(MANUFACTURER_ROLE)) {
        // Details already saved -> straight to the dashboard; otherwise fill them once.
        router.push(
          identity.manufacturerAccountExists ? MANUFACTURER_DASHBOARD_PATH : MANUFACTURER_ACCOUNT_PATH,
        );
      } else {
        router.push("/onboarding/organization");
      }
    } catch (caught) {
      setError(errorText(caught, "Couldn’t save your roles. Please try again."));
      setSaving(false);
    }
  }

  return (
    <div className="app-shell">
      <PersonaIcons />
      <div className="wrap">
        <div className="section-head">
          <h2>Select how you participate</h2>
          <p className="desc">
            Choose one or more roles that describe how you will use X!Y. You can
            update this later.
          </p>
        </div>

        <div className="persona-grid">
          {PERSONAS.map((persona) => {
            const isSelected = selected.includes(persona.id);
            return (
              <button
                key={persona.id}
                type="button"
                className={`p-card${isSelected ? " selected" : ""}`}
                aria-pressed={isSelected}
                aria-label={`${persona.name} — ${persona.description}`}
                onClick={() => handleSelect(persona.id)}
              >
                <div className="p-illustration-wrap">
                  <svg className="p-illustration" aria-hidden="true">
                    <use href={`#${persona.iconId}`} />
                  </svg>
                </div>
                <div className="p-title">{persona.name}</div>
                <div className="p-job">{persona.description}</div>
                <div className="p-link">
                  {isSelected ? "Selected ✓" : "Select role →"}
                </div>
              </button>
            );
          })}
        </div>

        <div className="role-actions">
          <Button
            variant="primary"
            disabled={!hydrated || saving || selected.length === 0}
            onClick={() => void handleContinue()}
          >
            Continue
          </Button>
          <p className="role-status" aria-live="polite">
            {error ||
              (selected.length === 0
              ? "Select at least one role to continue."
              : `${selected.length} role${selected.length === 1 ? "" : "s"} selected.`)}
          </p>
        </div>
      </div>
    </div>
  );
}
