// Visionary data (profile, idea, stage, requirements, manufacturers, requests and request
// drafts) is stored in the database through the backend API: see ./api.ts and ./store.ts.

export const TIMELINE_LABELS: Record<string, string> = {
  immediately: "Immediately",
  within_1_month: "Within 1 month",
  "1_3_months": "1–3 months",
  "3_6_months": "3–6 months",
};

/** Shown when a selected manufacturer has not listed their own machines yet
 * (the backend accepts the same list: app/visionary/schemas.py MACHINE_CATALOG). */
export const MACHINE_CATALOG = [
  "Injection Moulding",
  "CNC Machining",
  "CNC Milling",
  "CNC Turning / Lathe",
  "3D Printing (FDM)",
  "3D Printing (SLA / Resin)",
  "Laser Cutting",
  "Laser Engraving",
  "Sheet Metal Bending",
  "Sheet Metal Punching",
  "Die Casting",
  "Vacuum Casting",
  "Blow Moulding",
  "Extrusion",
  "Thermoforming",
  "Compression Moulding",
  "Welding",
  "Powder Coating",
  "Screen Printing",
  "Sublimation Printing",
  "Embroidery",
  "Sewing / Stitching",
  "Packaging & Labelling",
  "Assembly Line",
];
export const SELECTED_MANUFACTURER_KEY = "xy-selected-manufacturer";

export type VisionaryProfile = {
  name: string;
  role: string;
  org: string;
  location: string;
  intro: string;
};

export type VisionaryIdea = {
  project: string;
  idea: string;
  product: string;
  industry: string;
};

export type VisionaryRequirements = {
  manufacturing_location: string;
  quantity: { value: number; unit: "units" };
  budget: { amount: number; currency: "INR" };
  timeline: string;
  additional_requirements: string;
};

export type ManufacturerRecord = {
  id: string;
  name: string;
  location: string;
  category: string;
  capabilities: string;
  about: string;
  machines: string[];
  products: string[];
  capacity: number;
  moq: number;
  availability: string;
  logo: string | null;
  verified: boolean;
  status: "active";
};

export type SelectedManufacturer = {
  id: string;
  name: string;
  location: string;
  machines: string[];
  logo: string | null;
};

export type ManufacturingRequest = {
  manufacturer_id: string;
  manufacturer_name: string;
  project_name: string;
  visionary: string;
  machine: string;
  quantity: { value: number; unit: "units" };
  required_duration: string;
  manufacturing_location: string;
  budget: { amount: number; currency: "INR" };
  timeline: string;
  additional_requirements: string;
  status: string;
  /** Server id (UUID) of the request. */
  id?: string;
  request_id?: string;
  created_at?: string;
};

export function digitsOnly(value: string): string {
  return String(value || "").replace(/[^\d]/g, "");
}

export function formatIndianNumber(value: string): string {
  const digits = digitsOnly(value);
  return digits ? Number(digits).toLocaleString("en-IN") : "";
}

/** The manufacturer chosen on "Find a Manufacturer" (a UI selection only; the server
 * checks the id again when the request is sent). */
export function readSelectedManufacturerId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SELECTED_MANUFACTURER_KEY) || null;
  } catch {
    return null;
  }
}

export function writeSelectedManufacturerId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(SELECTED_MANUFACTURER_KEY, id);
    else window.localStorage.removeItem(SELECTED_MANUFACTURER_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
}
