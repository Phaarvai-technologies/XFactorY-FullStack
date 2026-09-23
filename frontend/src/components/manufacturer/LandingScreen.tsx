import { FactoryMark } from "@/components/layout/Logo";

type LandingScreenProps = {
  onJoin: () => void;
  onBackToLanding: () => void;
};

const BENEFITS = [
  {
    title: "Get discovered",
    text: "Reach qualified buyers searching for your exact capability.",
  },
  {
    title: "Showcase capabilities",
    text: "List your facility, machinery, and services in one profile.",
  },
  {
    title: "Manage bookings",
    text: "Track availability and requests from a single dashboard.",
  },
  {
    title: "Grow your business",
    text: "Unlock requests across industries you couldn't reach before.",
  },
];

export function LandingScreen({ onJoin, onBackToLanding }: LandingScreenProps) {
  return (
    <div className="ov-wrap">
      <div className="ov-topbar">
        <div className="topbar-logo">
          <FactoryMark className="topbar-factory-mark" />
          X!Y
        </div>
        <button
          className="btn-ghost"
          type="button"
          onClick={onBackToLanding}
        >
          Back to landing page
        </button>
      </div>

      <div className="ov-hero">
        <div className="ov-copy">
          <span className="side-eyebrow">Manufacturer</span>
          <h1>Join our team of manufacturers.</h1>
          <p>
            Create your Manufacturer account, build out your facility profile, and
            start getting matched with buyers looking for exactly what you produce.
          </p>
          <button
            className="btn-primary"
            type="button"
            style={{ padding: "13px 26px" }}
            onClick={onJoin}
          >
            Join Our Ecosystem
          </button>
        </div>
        <div className="ov-visual">
          Build.
          <br />
          Connect.
          <br />
          Grow.
        </div>
      </div>

      <div className="ov-benefits">
        {BENEFITS.map((benefit) => (
          <div className="ov-benefit" key={benefit.title}>
            <h3>{benefit.title}</h3>
            <p>{benefit.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
