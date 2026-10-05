import type { ReactNode } from "react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { PilotStrip } from "@/components/layout/PilotStrip";
import { Button } from "@/components/ui/Button";

export type InfoSection = {
  title: string;
  body: ReactNode;
};

type PilotInfoPageProps = {
  title: string;
  description: string;
  notice?: string;
  sections: InfoSection[];
};

export function PilotInfoPage({
  title,
  description,
  notice,
  sections,
}: PilotInfoPageProps) {
  return (
    <>
      <PilotStrip />
      <Header />
      <main className="info-page">
        <div className="wrap">
          <div className="section-head">
            <h1>{title}</h1>
            <p className="desc">{description}</p>
          </div>
          {notice ? <p className="scope-lead scope-lead-strong">{notice}</p> : null}
          <div className="info-list">
            {sections.map((section) => (
              <article key={section.title} className="scope-card">
                <h3>{section.title}</h3>
                <div className="info-copy">{section.body}</div>
              </article>
            ))}
          </div>
          <div className="role-actions">
            <Button href="/" variant="primary">
              Back to Home
            </Button>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
