"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PersonaIcons } from "@/components/home/PersonaIcons";
import { Button } from "@/components/ui/Button";
import { toggleRole } from "@/lib/auth/roles";
import { api } from "@/lib/api";
import { PERSONAS, type PersonaId } from "@/types/personas";

export function RoleSelection() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [selected, setSelected] = useState<PersonaId[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadRoles() {
      try {
        const token = await getToken();
        const result = await api<{ roles: PersonaId[] }>("/identity/me", token);
        if (!cancelled) setSelected(result.roles);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Unable to load roles.");
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    }
    void loadRoles();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  function handleSelect(roleId: PersonaId) {
    setSelected((current) => toggleRole(current, roleId));
  }

  async function handleContinue() {
    setSaving(true);
    setError("");
    try {
      const token = await getToken();
      await api("/identity/me/roles", token, {
        method: "PUT",
        body: JSON.stringify({ roles: selected }),
      });
      router.push("/onboarding/organization");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save roles.");
    } finally {
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
            {saving ? "Saving…" : "Continue"}
          </Button>
          <p className="role-status" aria-live="polite">
            {error || (selected.length === 0
              ? "Select at least one role to continue."
              : `${selected.length} role${selected.length === 1 ? "" : "s"} selected.`)}
          </p>
        </div>
      </div>
    </div>
  );
}
