import type { ProfileWizardData } from "@/components/manufacturer/ProfileWizard";

/**
 * Body of PATCH /manufacturer/profile: only the fields the user changed.
 *   field absent      -> the backend leaves the saved value (or NULL) untouched
 *   field "" / null   -> the user cleared it -> saved as NULL
 *   field value       -> saved, replacing the old value or NULL
 * Lists (certifications, FAQs, serviceable areas) are sent whole when changed,
 * because the wizard edits them as a list (add / remove).
 */
export type ProfilePatch = {
  company?: Partial<ProfileWizardData["company"]>;
  location?: Partial<ProfileWizardData["location"]>;
  certifications?: ProfileWizardData["certifications"];
  infra?: Partial<ProfileWizardData["infra"]>;
  faqs?: ProfileWizardData["faqs"];
};

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function changedFields<T extends object>(before: T, after: T): Partial<T> | undefined {
  const changes: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (!same(before[key], after[key])) changes[key] = after[key];
  }
  return Object.keys(changes).length > 0 ? changes : undefined;
}

/**
 * Changed top-level fields of any flat form (e.g. a machinery draft) for a PATCH,
 * or an empty object when nothing changed. Lists and objects are compared whole.
 */
export function diffFields<T extends object>(before: T, after: T): Partial<T> {
  return changedFields(before, after) ?? {};
}

/**
 * Compares the last saved/loaded profile with the current one and returns the
 * PATCH body, or null when nothing changed.
 */
export function diffProfile(before: ProfileWizardData, after: ProfileWizardData): ProfilePatch | null {
  const patch: ProfilePatch = {};
  const company = changedFields(before.company, after.company);
  const location = changedFields(before.location, after.location);
  const infra = changedFields(before.infra, after.infra);
  if (company) patch.company = company;
  if (location) patch.location = location;
  if (infra) patch.infra = infra;
  if (!same(before.certifications, after.certifications)) patch.certifications = after.certifications;
  if (!same(before.faqs, after.faqs)) patch.faqs = after.faqs;
  return Object.keys(patch).length > 0 ? patch : null;
}
