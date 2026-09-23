"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PersonaIcons } from "@/components/home/PersonaIcons";
import { Button } from "@/components/ui/Button";
import {
  readSelectedRoles,
  toggleRole,
  writeSelectedRoles,
} from "@/lib/auth/roles";
import { PERSONAS, type PersonaId } from "@/types/personas";

export function RoleSelection() {
  const router = useRouter();
  const [selected, setSelected] = useState<PersonaId[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSelected(readSelectedRoles());
    setHydrated(true);
  }, []);

  function handleSelect(roleId: PersonaId) {
    setSelected((current) => toggleRole(current, roleId));
  }

  function handleContinue() {
    writeSelectedRoles(selected);
    router.push("/onboarding/organization");
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
            disabled={!hydrated || selected.length === 0}
            onClick={handleContinue}
          >
            Continue
          </Button>
          <p className="role-status" aria-live="polite">
            {selected.length === 0
              ? "Select at least one role to continue."
              : `${selected.length} role${selected.length === 1 ? "" : "s"} selected.`}
          </p>
        </div>
      </div>
    </div>
  );
}
