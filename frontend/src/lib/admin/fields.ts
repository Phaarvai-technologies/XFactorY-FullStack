/**
 * How each editable manufacturer response is edited in the admin (XY-ADMIN-06).
 * Option lists mirror the manufacturer onboarding forms so admins pick from the
 * same choices; the backend re-validates with the onboarding rules.
 */

const BUSINESS_TYPES = ["Proprietorship", "Partnership", "Private Limited", "Public Limited", "LLP", "Other"];
const ORG_SIZES = [
  "Micro (1–9 employees)",
  "Small (10–49 employees)",
  "Medium (50–249 employees)",
  "Large (250+ employees)",
];
const LOCATION_COUNTRIES = ["India", "United States", "United Kingdom", "United Arab Emirates", "Germany", "China", "Other"];
const SEZ_OPTIONS = ["Not in SEZ", "Within SEZ", "SEZ pending approval"];
const COMPANY_TYPES = [
  "Textile & Apparel",
  "Electronics & Hardware",
  "Food & Beverage",
  "Automotive & Machinery",
  "Furniture & Woodwork",
  "Chemicals & Plastics",
  "Pharmaceuticals & Healthcare",
  "Packaging & Printing",
  "Other",
];
const ACCOUNT_COUNTRIES = [
  "India",
  "United States",
  "United Kingdom",
  "United Arab Emirates",
  "Germany",
  "China",
  "Vietnam",
  "Bangladesh",
  "Other",
];
const MACHINE_INDUSTRIES = [
  "Textile & Apparel",
  "Electronics & Hardware",
  "Food & Beverage",
  "Automotive & Machinery",
  "Furniture & Woodwork",
  "Chemicals & Plastics",
  "Other",
];
const CONDITIONS = ["New", "Excellent", "Good", "Fair"];
const RAW_MATERIAL = ["Available", "Not Available", "Partial"];
const LABOR = ["Skilled", "Unskilled", "Both"];
export const LOGISTICS = ["Local", "Outstation", "International"];
export const PRICING_KEYS: [string, string][] = [
  ["hour", "Per hour"],
  ["day", "Per day"],
  ["month", "Per month"],
  ["unit", "Per unit"],
  ["batch", "Per batch"],
];

export type FieldKind = "text" | "textarea" | "select" | "tags" | "certifications" | "faqs" | "pricing" | "logistics";
export type FieldSpec = { kind: FieldKind; options?: string[]; placeholder?: string };

const PROFILE: Record<string, FieldSpec> = {
  "company.name": { kind: "text" },
  "company.about": { kind: "textarea" },
  "company.vision": { kind: "textarea" },
  "company.estYear": { kind: "text", placeholder: "e.g. 2008" },
  "company.employees": { kind: "text", placeholder: "e.g. 120" },
  "company.businessType": { kind: "select", options: BUSINESS_TYPES },
  "company.orgSize": { kind: "select", options: ORG_SIZES },
  "location.address": { kind: "textarea" },
  "location.city": { kind: "text" },
  "location.state": { kind: "text" },
  "location.country": { kind: "select", options: LOCATION_COUNTRIES },
  "location.zip": { kind: "text" },
  "location.sez": { kind: "select", options: SEZ_OPTIONS },
  "location.serviceableAreas": { kind: "tags", placeholder: "Type an area and press Enter" },
  "infra.electricity": { kind: "textarea" },
  "infra.water": { kind: "textarea" },
  "infra.storage": { kind: "textarea" },
  "infra.packaging": { kind: "textarea" },
  "infra.waste": { kind: "textarea" },
  "infra.qa": { kind: "textarea" },
  certifications: { kind: "certifications" },
  faqs: { kind: "faqs" },
  "account.companyType": { kind: "select", options: COMPANY_TYPES },
  "account.country": { kind: "select", options: ACCOUNT_COUNTRIES },
  "account.capacity": { kind: "text" },
  "contact.email": { kind: "text", placeholder: "name@company.com" },
  "contact.phone": { kind: "text", placeholder: "10-digit phone number" },
};

const MACHINE: Record<string, FieldSpec> = {
  industry: { kind: "select", options: MACHINE_INDUSTRIES },
  subcategory: { kind: "text" },
  type: { kind: "text" },
  capacity: { kind: "text" },
  age: { kind: "text" },
  condition: { kind: "select", options: CONDITIONS },
  technical: { kind: "textarea" },
  rawMatStatus: { kind: "select", options: RAW_MATERIAL },
  materialDetails: { kind: "textarea" },
  laborType: { kind: "select", options: LABOR },
  workerCount: { kind: "text" },
  workerRoles: { kind: "textarea" },
  logistics: { kind: "logistics" },
  logisticsPartner: { kind: "text" },
  pricing: { kind: "pricing" },
  insurance: { kind: "textarea" },
};

export function fieldSpec(field: string): FieldSpec {
  if (field.startsWith("machinery.")) return MACHINE[field.split(".")[2]] ?? { kind: "text" };
  return PROFILE[field] ?? { kind: "text" };
}

type Cert = { name: string; body: string; fileName: string; status: string };
type Faq = { q: string; a: string };

/** Readable text for any response value (current value, list cells). */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    if (typeof value[0] === "string") return value.join(", ");
    if (value[0] && "q" in (value[0] as object)) return (value as Faq[]).map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n\n");
    if (value[0] && "name" in (value[0] as object))
      return (value as Cert[]).map((c) => `${c.name}${c.body ? ` (${c.body})` : ""} — ${c.status}`).join("\n");
    return JSON.stringify(value);
  }
  if (typeof value === "object") {
    return PRICING_KEYS.map(([k, label]) => {
      const v = (value as Record<string, string>)[k];
      return v ? `${label}: ${v}` : "";
    })
      .filter(Boolean)
      .join(" · ");
  }
  return String(value);
}
