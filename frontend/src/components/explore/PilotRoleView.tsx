import type { Metadata } from "next";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { PilotStrip } from "@/components/layout/PilotStrip";
import { Button } from "@/components/ui/Button";
import { pilotRoleBySlug, type PilotRole } from "@/lib/explore/pilotRoles";

export function pilotRoleMetadata(slug: string): Metadata {
  const role = pilotRoleBySlug(slug);
  return {
    title: role ? `${role.title} — X!Y` : "X!Y",
    description:
      "This participant workflow is currently being developed as part of the X!Y pilot.",
  };
}

export function PilotRoleView({ role }: { role: PilotRole }) {
  return (
    <>
      <PilotStrip />
      <Header />
      <main className="info-page">
        <div className="wrap">
          <div className="section-head">
            <div className="footer-pilot-badge info-status">
              <span className="pilot-dot" /> Pilot processing
            </div>
            <h1>Coming into the X!Y ecosystem</h1>
            <p className="desc">
              This participant workflow is currently being developed as part of the
              X!Y pilot. Explore how this role will connect with the wider ecosystem
              as the platform evolves.
            </p>
          </div>
          <div className="info-list">
            <article className="scope-card">
              <h3>{role.title}</h3>
              <div className="info-copy">
                <p>{role.description}</p>
                <p>This workflow is being prepared for a future stage of the X!Y platform.</p>
              </div>
            </article>
          </div>
          <div className="role-actions">
            <Button href="/#explore" variant="primary">
              Back to Explore
            </Button>
            <Button href="/" variant="ghost">
              Back to Home
            </Button>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
