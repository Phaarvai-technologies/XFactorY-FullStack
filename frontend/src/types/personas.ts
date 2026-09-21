/**
 * Marketplace personas supported by X!Y.
 * Frontend-only role model — replace with backend authorization later.
 */
export type PersonaId =
  | "manufacturer"
  | "visionary"
  | "vendor"
  | "logistics_provider"
  | "labour_supplier"
  | "legal_writer"
  | "investor"
  | "market_lead";

export interface PersonaDefinition {
  id: PersonaId;
  name: string;
  description: string;
  /** SVG symbol id from PersonaIcons sprite */
  iconId: string;
}

export interface SelectedRolesState {
  roles: PersonaId[];
  updatedAt: string;
}

export const PERSONAS: readonly PersonaDefinition[] = [
  {
    id: "manufacturer",
    name: "Manufacturer",
    description:
      "Discover qualified production opportunities and connect with buyers, suppliers, and production partners.",
    iconId: "ico-manufacturer",
  },
  {
    id: "visionary",
    name: "Visionary",
    description:
      "Turn bold ideas into manufacturable products with the right design, technology, and production partners.",
    iconId: "ico-visionary",
  },
  {
    id: "vendor",
    name: "Vendor",
    description:
      "Connect with manufacturers and businesses that need the materials, components, and services you provide.",
    iconId: "ico-vendor",
  },
  {
    id: "logistics_provider",
    name: "Logistics Provider",
    description:
      "Move materials and finished goods efficiently across the manufacturing and supply chain network.",
    iconId: "ico-logistics",
  },
  {
    id: "labour_supplier",
    name: "Labour Supplier",
    description:
      "Connect skilled workers and labour teams with manufacturers that need reliable production support.",
    iconId: "ico-labour",
  },
  {
    id: "legal_writer",
    name: "Legal Writer",
    description:
      "Support manufacturing businesses with contracts, legal documentation, compliance, and audit requirements.",
    iconId: "ico-legal",
  },
  {
    id: "investor",
    name: "Investor",
    description:
      "Discover promising manufacturing opportunities, businesses, and emerging market potential.",
    iconId: "ico-investor",
  },
  {
    id: "market_lead",
    name: "Market Lead",
    description:
      "Connect products and manufacturing capabilities with buyers, markets, and distribution opportunities.",
    iconId: "ico-market",
  },
] as const;

export function isPersonaId(value: string): value is PersonaId {
  return PERSONAS.some((persona) => persona.id === value);
}
