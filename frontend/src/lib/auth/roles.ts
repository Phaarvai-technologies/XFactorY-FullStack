import type { PersonaId } from "@/types/personas";
import { isPersonaId, type SelectedRolesState } from "@/types/personas";

const STORAGE_KEY = "xy.selectedRoles";

/**
 * Client-side role persistence for the MVP.
 * Replace with Clerk metadata / backend claims later — never hardcode permissions here.
 */
export function readSelectedRoles(): PersonaId[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as SelectedRolesState;
    if (!Array.isArray(parsed.roles)) {
      return [];
    }

    return parsed.roles.filter(isPersonaId);
  } catch {
    return [];
  }
}

export function writeSelectedRoles(roles: PersonaId[]): SelectedRolesState {
  const state: SelectedRolesState = {
    roles,
    updatedAt: new Date().toISOString(),
  };

  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  return state;
}

export function toggleRole(roles: PersonaId[], roleId: PersonaId): PersonaId[] {
  return roles.includes(roleId)
    ? roles.filter((id) => id !== roleId)
    : [...roles, roleId];
}
