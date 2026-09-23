import type { CompareDimension } from "@/lib/needs/compareTypes";
import type { PersonaId } from "@/types/personas";

const MANUFACTURER_DIMENSIONS: CompareDimension[] = [
  { id: "capabilities", label: "Capabilities" },
  { id: "machinery", label: "Machinery" },
  { id: "process", label: "Process capability" },
  { id: "material", label: "Material capability" },
  { id: "volume", label: "Production volume" },
  { id: "capacity", label: "Available capacity" },
  { id: "availability", label: "Availability" },
  { id: "lead_time", label: "Lead time" },
  { id: "tolerance", label: "Dimensions / tolerance" },
  { id: "certifications", label: "Certifications" },
  { id: "geography", label: "Geography" },
  { id: "evidence", label: "Evidence" },
  { id: "verification", label: "Verification" },
];

const VENDOR_DIMENSIONS: CompareDimension[] = [
  { id: "coverage", label: "Material / product coverage" },
  { id: "quantity", label: "Quantity availability" },
  { id: "quality", label: "Quality / certifications" },
  { id: "geography", label: "Geography" },
  { id: "delivery", label: "Delivery coverage" },
  { id: "availability", label: "Availability" },
  { id: "lead_time", label: "Lead time" },
  { id: "evidence", label: "Evidence" },
  { id: "verification", label: "Verification" },
];

const LABOUR_DIMENSIONS: CompareDimension[] = [
  { id: "skills", label: "Skill coverage" },
  { id: "workforce", label: "Workforce quantity" },
  { id: "experience", label: "Experience" },
  { id: "skill_mix", label: "Skilled / unskilled coverage" },
  { id: "shifts", label: "Shift availability" },
  { id: "geography", label: "Geography" },
  { id: "duration", label: "Duration" },
  { id: "certifications", label: "Certifications" },
  { id: "evidence", label: "Evidence" },
];

const LOGISTICS_DIMENSIONS: CompareDimension[] = [
  { id: "pickup", label: "Pickup coverage" },
  { id: "delivery", label: "Delivery coverage" },
  { id: "storage", label: "Storage" },
  { id: "packaging", label: "Packaging" },
  { id: "product_type", label: "Product type" },
  { id: "geography", label: "Geography" },
  { id: "availability", label: "Availability" },
  { id: "lead_time", label: "Lead time" },
  { id: "handling", label: "Special handling" },
  { id: "evidence", label: "Evidence" },
];

const INVESTOR_DIMENSIONS: CompareDimension[] = [
  { id: "capital", label: "Capital range" },
  { id: "focus", label: "Investment focus" },
  { id: "stage", label: "Project stage" },
  { id: "industry", label: "Industry focus" },
  { id: "geography", label: "Geography" },
  { id: "structure", label: "Funding structure" },
  { id: "availability", label: "Availability" },
  { id: "evidence", label: "Evidence" },
  { id: "verification", label: "Verification" },
];

const LEGAL_DIMENSIONS: CompareDimension[] = [
  { id: "services", label: "Service coverage" },
  { id: "documents", label: "Document type" },
  { id: "compliance", label: "Compliance area" },
  { id: "jurisdiction", label: "Jurisdiction" },
  { id: "industry", label: "Industry coverage" },
  { id: "availability", label: "Availability" },
  { id: "timeline", label: "Timeline" },
  { id: "experience", label: "Relevant experience" },
  { id: "evidence", label: "Evidence" },
];

const MARKET_DIMENSIONS: CompareDimension[] = [
  { id: "market", label: "Market coverage" },
  { id: "segment", label: "Customer segment" },
  { id: "geography", label: "Geography" },
  { id: "demand", label: "Demand information" },
  { id: "distribution", label: "Distribution coverage" },
  { id: "marketing", label: "Marketing capability" },
  { id: "availability", label: "Availability" },
  { id: "experience", label: "Relevant experience" },
  { id: "evidence", label: "Evidence" },
];

export function dimensionsForPersona(persona: PersonaId): CompareDimension[] {
  switch (persona) {
    case "manufacturer":
      return MANUFACTURER_DIMENSIONS;
    case "vendor":
      return VENDOR_DIMENSIONS;
    case "labour_supplier":
      return LABOUR_DIMENSIONS;
    case "logistics_provider":
      return LOGISTICS_DIMENSIONS;
    case "investor":
      return INVESTOR_DIMENSIONS;
    case "legal_writer":
      return LEGAL_DIMENSIONS;
    case "market_lead":
      return MARKET_DIMENSIONS;
    default:
      return MANUFACTURER_DIMENSIONS;
  }
}

/** When comparing mixed personas, use union of selected candidates’ primary persona set (first wins for table). */
export function dimensionsForCandidates(
  personas: PersonaId[],
): CompareDimension[] {
  if (personas.length === 0) return MANUFACTURER_DIMENSIONS;
  const primary = personas[0]!;
  const allSame = personas.every((p) => p === primary);
  if (allSame) return dimensionsForPersona(primary);
  // Mixed set: show shared core dimensions only (transparent, not ranked).
  return [
    { id: "capabilities", label: "Capabilities / coverage" },
    { id: "availability", label: "Availability" },
    { id: "geography", label: "Geography" },
    { id: "lead_time", label: "Lead time / timeline" },
    { id: "certifications", label: "Certifications" },
    { id: "evidence", label: "Evidence" },
    { id: "verification", label: "Verification" },
  ];
}
