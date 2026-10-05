import type { PersonaId } from "@/types/personas";

export const MANUFACTURER_ROLE: PersonaId = "manufacturer";

/** Public Manufacturer overview (signed-out Explore entry). */
export const MANUFACTURER_OVERVIEW_PATH = "/manufacturer";

/** Manufacturer profile setup form (after Clerk auth). */
export const MANUFACTURER_ACCOUNT_PATH = "/manufacturer/account";

/** Private Manufacturer dashboard. */
export const MANUFACTURER_DASHBOARD_PATH = "/manufacturer/dashboard";

/** Marks that the Manufacturer profile setup form was completed (not used for auth). */
export const MANUFACTURER_PROFILE_COMPLETE_KEY = "xy-manufacturer-profile-complete";

export function hasManufacturerRole(roles: PersonaId[]): boolean {
  return roles.includes(MANUFACTURER_ROLE);
}

export function hasAnyRole(roles: PersonaId[]): boolean {
  return roles.length > 0;
}

export function isManufacturerOverviewPath(pathname: string): boolean {
  return pathname === MANUFACTURER_OVERVIEW_PATH || pathname === `${MANUFACTURER_OVERVIEW_PATH}/`;
}

export function isManufacturerAccountPath(pathname: string): boolean {
  return (
    pathname === MANUFACTURER_ACCOUNT_PATH ||
    pathname.startsWith(`${MANUFACTURER_ACCOUNT_PATH}/`)
  );
}

export function isManufacturerDashboardPath(pathname: string): boolean {
  return (
    pathname === MANUFACTURER_DASHBOARD_PATH ||
    pathname.startsWith(`${MANUFACTURER_DASHBOARD_PATH}/`)
  );
}

/** Join Our Ecosystem → existing X!Y Create Account, then return to profile setup. */
export function manufacturerCreateAccountHref(): string {
  return `/sign-up?redirect_url=${encodeURIComponent(MANUFACTURER_ACCOUNT_PATH)}`;
}

export function readManufacturerProfileComplete(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(MANUFACTURER_PROFILE_COMPLETE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markManufacturerProfileComplete(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(MANUFACTURER_PROFILE_COMPLETE_KEY, "1");
  } catch {
    // Ignore storage failures.
  }
}
