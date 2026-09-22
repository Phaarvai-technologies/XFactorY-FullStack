import Link from "next/link";
import { ManufacturerExploreCard } from "@/components/home/ManufacturerExploreCard";

type HomePersona = {
  title: string;
  job: string;
  iconId: string;
  href: string;
};

const MANUFACTURER_PERSONA = {
  title: "Manufacturer",
  job: "Discover qualified production opportunities and connect with buyers, suppliers, and production partners.",
  iconId: "ico-manufacturer",
} as const;

const HOME_PERSONAS: HomePersona[] = [
  {
    title: "Visionary",
    job: "Turn bold ideas into manufacturable products with the right design, technology, and production partners.",
    iconId: "ico-visionary",
    href: "/sign-up",
  },
  {
    title: "Vendor",
    job: "Connect with manufacturers and businesses that need the materials, components, and services you provide.",
    iconId: "ico-vendor",
    href: "/sign-up",
  },
  {
    title: "Investor",
    job: "Discover promising manufacturing opportunities, businesses, and emerging market potential.",
    iconId: "ico-investor",
    href: "/sign-up",
  },
  {
    title: "Labour Supplier",
    job: "Connect skilled workers and labour teams with manufacturers that need reliable production support.",
    iconId: "ico-labour",
    href: "/sign-up",
  },
  {
    title: "Logistics Supplier",
    job: "Move materials and finished goods efficiently across the manufacturing and supply chain network.",
    iconId: "ico-logistics",
    href: "/sign-up",
  },
  {
    title: "Legal Auditor",
    job: "Support manufacturing businesses with contracts, legal documentation, compliance, and audit requirements.",
    iconId: "ico-legal",
    href: "/sign-up",
  },
  {
    title: "Market Lead",
    job: "Connect products and manufacturing capabilities with buyers, markets, and distribution opportunities.",
    iconId: "ico-market",
    href: "/sign-up",
  },
];

export function PersonasSection() {
  return (
    <section className="personas" id="personas">
      <div className="wrap">
        <div className="section-head">
          <h2>One ecosystem. Eight ways to participate.</h2>
          <p className="desc">
            Choose the role that best describes how you use X!Y. You can work across
            multiple roles with
            <br className="desc-break" /> one account.
          </p>
        </div>

        <div className="persona-grid">
          <ManufacturerExploreCard
            title={MANUFACTURER_PERSONA.title}
            job={MANUFACTURER_PERSONA.job}
            iconId={MANUFACTURER_PERSONA.iconId}
          />
          {HOME_PERSONAS.map((persona) => (
            <Link
              key={persona.title}
              href={persona.href}
              className="p-card"
              aria-label={`${persona.title} — ${persona.job}`}
            >
              <div className="p-illustration-wrap">
                <svg className="p-illustration" aria-hidden="true">
                  <use href={`#${persona.iconId}`} />
                </svg>
              </div>
              <div className="p-title">{persona.title}</div>
              <div className="p-job">{persona.job}</div>
              <div className="p-link">Explore role →</div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
