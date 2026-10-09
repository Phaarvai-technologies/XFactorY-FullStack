export type PilotRole = {
  slug: string;
  title: string;
  description: string;
};

export const PILOT_ROLES: PilotRole[] = [
  {
    slug: "vendor",
    title: "Vendor",
    description:
      "Vendors will help participants discover and connect with relevant materials and supply capabilities.",
  },
  {
    slug: "investor",
    title: "Investor",
    description:
      "Investors will help identify promising opportunities and support participants as projects develop.",
  },
  {
    slug: "labour-supplier",
    title: "Labour Supplier",
    description:
      "Labour suppliers will help participants connect with relevant skilled and unskilled workforce capabilities.",
  },
  {
    slug: "logistics-supplier",
    title: "Logistics Supplier",
    description:
      "Logistics suppliers will support storage, movement, and delivery capabilities across the X!Y ecosystem.",
  },
  {
    slug: "legal-auditor",
    title: "Legal Auditor",
    description:
      "Legal and audit support will help participants navigate documentation, verification, and trust-related processes.",
  },
  {
    slug: "market-lead",
    title: "Market Lead",
    description:
      "Market leads will help participants understand customer requirements, market demand, and opportunities for reaching customers.",
  },
];

export function pilotRoleBySlug(slug: string): PilotRole | undefined {
  return PILOT_ROLES.find((role) => role.slug === slug);
}
