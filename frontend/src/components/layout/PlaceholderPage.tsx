import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { PilotStrip } from "@/components/layout/PilotStrip";
import { Button } from "@/components/ui/Button";

type PlaceholderPageProps = {
  title: string;
  description: string;
  primaryHref?: string;
  primaryLabel?: string;
};

export function PlaceholderPage({
  title,
  description,
  primaryHref = "/app",
  primaryLabel = "Back to app",
}: PlaceholderPageProps) {
  return (
    <>
      <PilotStrip />
      <Header />
      <main className="app-shell">
        <div className="wrap">
          <div className="section-head">
            <h2>{title}</h2>
            <p className="desc">{description}</p>
          </div>
          <p>
            This route is authenticated and ready for product features. Role and
            organization authorization will connect to the backend in a later
            phase.
          </p>
          <div className="role-actions">
            <Button href={primaryHref} variant="primary">
              {primaryLabel}
            </Button>
            <Button href="/onboarding/roles" variant="ghost">
              Manage roles
            </Button>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
