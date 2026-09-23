import type { NeedType, RequirementCategoryDef } from "@/lib/needs/types";

export const MANUFACTURING_CATEGORIES: RequirementCategoryDef[] = [
  {
    id: "product",
    label: "Product / Component",
    description: "Product or component requirements.",
  },
  {
    id: "process",
    label: "Process",
    description: "Manufacturing process requirements.",
  },
  {
    id: "material",
    label: "Material",
    description: "Required or preferred material information.",
  },
  {
    id: "machinery",
    label: "Machinery",
    description: "Required machinery or machine capabilities.",
  },
  {
    id: "volume",
    label: "Volume",
    description: "Production quantity requirements.",
  },
  {
    id: "dimensions",
    label: "Dimensions / Tolerance",
    description: "Physical and technical specifications.",
  },
  {
    id: "certifications",
    label: "Certifications",
    description: "Required certifications or compliance.",
  },
  {
    id: "geography",
    label: "Geography",
    description: "Location and serviceable geography.",
  },
  {
    id: "timing",
    label: "Timing",
    description: "Schedule and lead-time requirements.",
  },
  {
    id: "confidentiality",
    label: "Confidentiality",
    description: "Information-sharing requirements.",
  },
  {
    id: "supporting",
    label: "Supporting Services",
    description: "Additional ecosystem requirements.",
  },
];

const VENDOR_CATEGORIES: RequirementCategoryDef[] = [
  { id: "material_type", label: "Material type", description: "Material category and grade." },
  { id: "quantity", label: "Quantity", description: "Order quantity and cadence." },
  { id: "quality", label: "Quality", description: "Quality and acceptance criteria." },
  { id: "geography", label: "Geography", description: "Supply and delivery geography." },
  { id: "timing", label: "Timing", description: "Lead time and delivery windows." },
  { id: "pricing", label: "Pricing", description: "Budget and commercial terms." },
  { id: "certifications", label: "Certifications", description: "Required certifications." },
  { id: "confidentiality", label: "Confidentiality", description: "Information-sharing rules." },
];

const LABOUR_CATEGORIES: RequirementCategoryDef[] = [
  { id: "skill", label: "Skill type", description: "Required skills and roles." },
  { id: "workforce", label: "Workforce quantity", description: "Headcount and crew size." },
  { id: "experience", label: "Experience", description: "Experience level expectations." },
  { id: "shift", label: "Shift / timing", description: "Shift patterns and availability." },
  { id: "geography", label: "Geography", description: "Work location requirements." },
  { id: "duration", label: "Duration", description: "Engagement length." },
  { id: "certification", label: "Certification", description: "Workforce certifications." },
  { id: "confidentiality", label: "Confidentiality", description: "Information-sharing rules." },
];

const LOGISTICS_CATEGORIES: RequirementCategoryDef[] = [
  { id: "pickup", label: "Pickup location", description: "Origin location." },
  { id: "delivery", label: "Delivery location", description: "Destination location." },
  { id: "product_type", label: "Product type", description: "Goods being moved." },
  { id: "storage", label: "Storage requirements", description: "Warehousing needs." },
  { id: "packaging", label: "Packaging", description: "Packaging requirements." },
  { id: "quantity", label: "Quantity", description: "Shipment volume." },
  { id: "timing", label: "Timing", description: "Pickup and delivery windows." },
  { id: "geography", label: "Geography", description: "Service corridor." },
  { id: "handling", label: "Special handling", description: "Special handling needs." },
];

const INVESTOR_CATEGORIES: RequirementCategoryDef[] = [
  { id: "capital", label: "Capital requirement", description: "Funding amount needed." },
  { id: "purpose", label: "Funding purpose", description: "Use of funds." },
  { id: "stage", label: "Stage", description: "Company or project stage." },
  { id: "timeline", label: "Timeline", description: "Fundraising timeline." },
  { id: "geography", label: "Geography", description: "Investment geography." },
  { id: "structure", label: "Investment structure", description: "Deal structure preferences." },
  { id: "confidentiality", label: "Confidentiality", description: "Information-sharing rules." },
];

const LEGAL_CATEGORIES: RequirementCategoryDef[] = [
  { id: "service", label: "Service type", description: "Legal or audit service needed." },
  { id: "document", label: "Document type", description: "Documents involved." },
  { id: "compliance", label: "Compliance requirement", description: "Compliance scope." },
  { id: "jurisdiction", label: "Geography / jurisdiction", description: "Applicable jurisdiction." },
  { id: "timeline", label: "Timeline", description: "Delivery timeline." },
  { id: "confidentiality", label: "Confidentiality", description: "Information-sharing rules." },
];

const MARKET_CATEGORIES: RequirementCategoryDef[] = [
  { id: "market", label: "Target market", description: "Market focus." },
  { id: "segment", label: "Customer segment", description: "Audience segment." },
  { id: "geography", label: "Geography", description: "Market geography." },
  { id: "demand", label: "Demand information", description: "Demand signals." },
  { id: "marketing", label: "Marketing requirement", description: "Go-to-market needs." },
  { id: "timeline", label: "Timeline", description: "Campaign or launch timing." },
  { id: "confidentiality", label: "Confidentiality", description: "Information-sharing rules." },
];

export function categoriesForNeedType(needType: NeedType): RequirementCategoryDef[] {
  switch (needType) {
    case "manufacturing":
      return MANUFACTURING_CATEGORIES;
    case "vendor":
      return VENDOR_CATEGORIES;
    case "labour":
      return LABOUR_CATEGORIES;
    case "logistics":
      return LOGISTICS_CATEGORIES;
    case "investor":
      return INVESTOR_CATEGORIES;
    case "legal":
      return LEGAL_CATEGORIES;
    case "market_lead":
      return MARKET_CATEGORIES;
    case "supporting":
      return VENDOR_CATEGORIES;
  }
}

export function needTypeLabel(needType: NeedType): string {
  switch (needType) {
    case "manufacturing":
      return "Manufacturing need";
    case "vendor":
      return "Vendor / materials";
    case "labour":
      return "Labour supplier";
    case "logistics":
      return "Logistics provider";
    case "investor":
      return "Investor / capital";
    case "legal":
      return "Legal writer / auditor";
    case "market_lead":
      return "Market lead";
    case "supporting":
      return "Supporting need";
  }
}
