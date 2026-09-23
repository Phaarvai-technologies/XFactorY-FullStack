import type {
  EngagementFieldDef,
  EngagementRequestType,
} from "@/lib/engagements/types";

export const REQUEST_TYPE_OPTIONS: {
  id: EngagementRequestType;
  label: string;
  description: string;
}[] = [
  {
    id: "inquiry",
    label: "Inquiry",
    description: "Start a general business conversation.",
  },
  {
    id: "availability",
    label: "Availability",
    description:
      "Ask whether the recipient can support the requirement within a specified period.",
  },
  {
    id: "quote",
    label: "Quote",
    description: "Request indicative pricing or commercial information.",
  },
  {
    id: "material_tooling",
    label: "Material / Tooling",
    description:
      "Request material, tooling, or related manufacturing support.",
  },
  {
    id: "workforce",
    label: "Workforce",
    description: "Request skilled/unskilled workforce support.",
  },
  {
    id: "logistics",
    label: "Logistics",
    description:
      "Request transportation, storage, packaging, or delivery support.",
  },
  {
    id: "market_channel",
    label: "Market / Channel",
    description:
      "Request market access, customer insight, distribution, or channel support.",
  },
  {
    id: "investment_interest",
    label: "Investment Interest",
    description:
      "Express nonbinding interest in discussing potential investment/funding.",
  },
  {
    id: "legal_audit",
    label: "Legal / Audit Service",
    description:
      "Request professional legal, compliance, documentation, or audit support.",
  },
];

export const RESPONSE_QUESTIONS: Record<EngagementRequestType, string[]> = {
  inquiry: ["Would you be open to discussing this requirement further?"],
  availability: ["Are you currently available for this requirement?"],
  quote: [
    "Can you provide indicative pricing based on the information shared?",
  ],
  material_tooling: [
    "Can you support the material or tooling requirements described?",
  ],
  workforce: ["What workforce capacity is currently available?"],
  logistics: [
    "Can you support pickup and delivery within the requested timeframe?",
  ],
  market_channel: [
    "Can you support market or channel access for this product?",
  ],
  investment_interest: [
    "Would you be open to discussing this project further?",
  ],
  legal_audit: [
    "Can you support the compliance or documentation scope described?",
  ],
};

export function fieldsForRequestType(
  type: EngagementRequestType,
): EngagementFieldDef[] {
  switch (type) {
    case "inquiry":
      return [
        { id: "subject", label: "Subject", kind: "text", required: true },
        { id: "purpose", label: "Purpose", kind: "textarea", required: true },
        { id: "message", label: "Message", kind: "textarea", required: true },
        {
          id: "reference",
          label: "Relevant need / reference",
          kind: "text",
        },
        {
          id: "response_timeframe",
          label: "Preferred response timeframe",
          kind: "text",
          required: true,
          placeholder: "e.g. Within 5 business days",
        },
      ];
    case "availability":
      return [
        {
          id: "service",
          label: "Service / product required",
          kind: "text",
          required: true,
        },
        {
          id: "quantity",
          label: "Required quantity / capacity",
          kind: "text",
          required: true,
        },
        {
          id: "timeframe",
          label: "Required date / timeframe",
          kind: "text",
          required: true,
        },
        { id: "geography", label: "Geography", kind: "text", required: true },
        {
          id: "availability_question",
          label: "Availability question",
          kind: "textarea",
          required: true,
        },
        { id: "notes", label: "Additional notes", kind: "textarea" },
      ];
    case "quote":
      return [
        {
          id: "product",
          label: "Product / service",
          kind: "text",
          required: true,
        },
        { id: "quantity", label: "Quantity", kind: "text", required: true },
        {
          id: "specifications",
          label: "Specifications",
          kind: "textarea",
          required: true,
        },
        {
          id: "delivery_timeframe",
          label: "Required delivery timeframe",
          kind: "text",
          required: true,
        },
        {
          id: "delivery_location",
          label: "Delivery location",
          kind: "text",
          required: true,
        },
        {
          id: "quote_info",
          label: "Quote information requested (indicative / nonbinding)",
          kind: "textarea",
          required: true,
        },
        { id: "notes", label: "Additional notes", kind: "textarea" },
      ];
    case "material_tooling":
      return [
        {
          id: "material_type",
          label: "Material / tooling type",
          kind: "text",
          required: true,
        },
        { id: "quantity", label: "Quantity", kind: "text", required: true },
        {
          id: "specification",
          label: "Specification",
          kind: "textarea",
          required: true,
        },
        {
          id: "required_date",
          label: "Required date",
          kind: "text",
          required: true,
        },
        {
          id: "delivery_location",
          label: "Delivery / location",
          kind: "text",
          required: true,
        },
        {
          id: "certifications",
          label: "Certification requirements",
          kind: "text",
        },
        { id: "notes", label: "Additional notes", kind: "textarea" },
      ];
    case "workforce":
      return [
        { id: "skill", label: "Skill type", kind: "text", required: true },
        {
          id: "quantity",
          label: "Workforce quantity",
          kind: "text",
          required: true,
        },
        {
          id: "experience",
          label: "Experience requirement",
          kind: "text",
        },
        { id: "shift", label: "Shift / timing", kind: "text", required: true },
        { id: "geography", label: "Geography", kind: "text", required: true },
        { id: "duration", label: "Duration", kind: "text", required: true },
        {
          id: "certifications",
          label: "Certification requirement",
          kind: "text",
        },
        { id: "notes", label: "Additional notes", kind: "textarea" },
      ];
    case "logistics":
      return [
        {
          id: "pickup",
          label: "Pickup location",
          kind: "text",
          required: true,
        },
        {
          id: "delivery",
          label: "Delivery location",
          kind: "text",
          required: true,
        },
        {
          id: "product_type",
          label: "Product type",
          kind: "text",
          required: true,
        },
        { id: "quantity", label: "Quantity", kind: "text", required: true },
        {
          id: "packaging",
          label: "Packaging requirements",
          kind: "text",
        },
        {
          id: "storage",
          label: "Storage requirement",
          kind: "text",
        },
        {
          id: "timeframe",
          label: "Required date / time",
          kind: "text",
          required: true,
        },
        {
          id: "handling",
          label: "Special handling",
          kind: "text",
        },
        { id: "notes", label: "Additional notes", kind: "textarea" },
      ];
    case "market_channel":
      return [
        {
          id: "target_market",
          label: "Target market",
          kind: "text",
          required: true,
        },
        {
          id: "segment",
          label: "Customer segment",
          kind: "text",
          required: true,
        },
        { id: "geography", label: "Geography", kind: "text", required: true },
        {
          id: "product",
          label: "Product / service",
          kind: "text",
          required: true,
        },
        {
          id: "requirement",
          label: "Market / channel requirement",
          kind: "textarea",
          required: true,
        },
        {
          id: "timeframe",
          label: "Expected timeframe",
          kind: "text",
          required: true,
        },
        { id: "notes", label: "Additional notes", kind: "textarea" },
      ];
    case "investment_interest":
      return [
        {
          id: "project",
          label: "Project / Need",
          kind: "text",
          required: true,
        },
        {
          id: "funding",
          label: "Funding requirement (discussion only)",
          kind: "text",
          required: true,
        },
        { id: "stage", label: "Project stage", kind: "text", required: true },
        {
          id: "purpose",
          label: "Purpose of funding",
          kind: "textarea",
          required: true,
        },
        {
          id: "timeframe",
          label: "Preferred discussion timeframe",
          kind: "text",
          required: true,
        },
        {
          id: "relevant",
          label: "Relevant information",
          kind: "textarea",
        },
        { id: "notes", label: "Additional notes", kind: "textarea" },
      ];
    case "legal_audit":
      return [
        {
          id: "service_type",
          label: "Service type",
          kind: "text",
          required: true,
        },
        {
          id: "compliance",
          label: "Document / compliance requirement",
          kind: "textarea",
          required: true,
        },
        {
          id: "jurisdiction",
          label: "Jurisdiction",
          kind: "text",
          required: true,
        },
        {
          id: "industry",
          label: "Industry / context",
          kind: "text",
          required: true,
        },
        {
          id: "timeframe",
          label: "Required timeframe",
          kind: "text",
          required: true,
        },
        {
          id: "relevant",
          label: "Relevant information",
          kind: "textarea",
        },
        { id: "notes", label: "Additional notes", kind: "textarea" },
      ];
  }
}

export function defaultRequestTypeForPersona(
  personaLabel: string,
): EngagementRequestType {
  const value = personaLabel.toLowerCase();
  if (value.includes("logistics")) return "logistics";
  if (value.includes("labour") || value.includes("labor")) return "workforce";
  if (value.includes("vendor")) return "material_tooling";
  if (value.includes("investor")) return "investment_interest";
  if (value.includes("legal")) return "legal_audit";
  if (value.includes("market")) return "market_channel";
  return "availability";
}
