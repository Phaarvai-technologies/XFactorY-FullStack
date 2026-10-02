"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { XyMark } from "@/components/visionary/XyLogo";
import {
  VISIONARY_FLOW_PATH,
  visionarySignInHref,
} from "@/lib/visionary/paths";

const FEATURES = [
  {
    title: "Bring your idea to life",
    body: "Turn your product idea into a clear project and start exploring the path toward manufacturing.",
  },
  {
    title: "Find manufacturing",
    body: "Discover manufacturers with the capabilities and machinery needed to help bring your product to life.",
  },
  {
    title: "Build your ecosystem",
    body: "Connect with vendors, labour, logistics, investors and other supporting roles around your project.",
  },
  {
    title: "Grow your opportunity",
    body: "Move from idea to manufacturing while discovering the right opportunities and connections for your project.",
  },
];

export function VisionaryOverview() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  function startProject() {
    if (!isLoaded) return;
    router.push(isSignedIn ? VISIONARY_FLOW_PATH : visionarySignInHref());
  }

  return (
    <div className="view active" id="v-ov">
      <header className="site-header">
        <Link className="logo" href="/" aria-label="X!Y home">
          <XyMark />
          <span className="logo-text">X!Y</span>
        </Link>
        <Link className="btn-back" href="/">
          Back to landing page
        </Link>
      </header>

      <main className="container">
        <section className="ov-hero">
          <div className="hero-copy">
            <span className="badge">Visionary</span>
            <h1>Turn your ideas into reality.</h1>
            <p>
              Bring your product idea to life by connecting with manufacturers, resources, and the
              right ecosystem through X!Y.
            </p>
            <button
              type="button"
              className="btn-primary"
              id="startProject"
              onClick={startProject}
              disabled={!isLoaded}
            >
              Start Your Project
            </button>
          </div>
          <div className="hero-visual">
            <svg
              viewBox="0 0 526 325"
              role="img"
              aria-label="Illustration: an idea becomes a design and then gets built"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <radialGradient id="glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0" stopColor="#2563eb" stopOpacity=".22" />
                  <stop offset="1" stopColor="#2563eb" stopOpacity="0" />
                </radialGradient>
                <filter id="tileShadow" x="-20%" y="-20%" width="140%" height="150%">
                  <feDropShadow dx="0" dy="8" stdDeviation="9" floodColor="#1e3a8a" floodOpacity=".18" />
                </filter>
              </defs>
              <g filter="url(#tileShadow)" fill="#fff">
                <rect x="40" y="62" width="130" height="152" rx="18" />
                <rect x="198" y="62" width="130" height="152" rx="18" />
                <rect x="356" y="62" width="130" height="152" rx="18" />
              </g>
              <g fill="none" stroke="#2563eb" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M177 138h14m-5-5 5 5-5 5" />
                <path d="M335 138h14m-5-5 5 5-5 5" />
              </g>
              <circle cx="105" cy="122" r="46" fill="url(#glow)" />
              <g fill="none" stroke="#2563eb" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M105 78v-8M76 92l-6-6M134 92l6-6M64 120h-8M146 120h8" />
                <path d="M92 145c-9-7-14-15-14-25a27 27 0 0 1 54 0c0 10-5 18-14 25v8H92Z" fill="#e8efff" />
                <path d="M94 161h22M97 169h16" />
                <path d="M98 128l7 8 7-8m-7 8v-12" strokeWidth="2.2" />
              </g>
              <g stroke="#2563eb" strokeWidth="2.4" strokeLinejoin="round">
                <path d="M263 100l32 17-32 17-32-17Z" fill="#c5d8fb" />
                <path d="M231 117l32 17v36l-32-17Z" fill="#e8efff" />
                <path d="M295 117l-32 17v36l32-17Z" fill="#9dbcf7" />
              </g>
              <g fill="none" stroke="#2563eb" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="3 4" opacity=".7">
                <path d="M222 121v36M304 121v36M231 186l32 17 32-17" />
              </g>
              <g stroke="#2563eb" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round">
                <g transform="rotate(45 421 138)">
                  <rect x="416" y="112" width="10" height="56" rx="5" fill="#e8efff" />
                  <circle cx="421" cy="108" r="14" fill="#c5d8fb" />
                  <rect x="416" y="88" width="10" height="15" fill="#fff" stroke="none" />
                  <path d="M416 94v10h10V94" fill="none" />
                </g>
                <g transform="rotate(-45 421 138)">
                  <rect x="416" y="110" width="10" height="58" rx="5" fill="#e8efff" />
                  <rect x="401" y="94" width="40" height="20" rx="5" fill="#9dbcf7" />
                </g>
              </g>
              <g transform="translate(464 82)" fill="none" stroke="#2563eb">
                <circle r="9" strokeWidth="5" strokeDasharray="4.2 3.6" opacity=".55" />
                <circle r="6.5" strokeWidth="2.2" fill="#fff" />
              </g>
              <g fontFamily="var(--xy-inter), sans-serif" fontSize="14" fontWeight="700" fill="#1e3a8a" textAnchor="middle">
                <text x="105" y="248">Idea</text>
                <text x="263" y="248">Design</text>
                <text x="421" y="248">Build</text>
              </g>
              <g fill="#2563eb">
                <circle cx="105" cy="270" r="3.5" />
                <circle cx="263" cy="270" r="3.5" opacity=".6" />
                <circle cx="421" cy="270" r="3.5" opacity=".35" />
              </g>
            </svg>
          </div>
        </section>

        <section className="features" aria-label="How X!Y helps Visionaries">
          {FEATURES.map((feature) => (
            <article className="card" key={feature.title}>
              <h2>{feature.title}</h2>
              <p>{feature.body}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
