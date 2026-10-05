import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { PilotStrip } from "@/components/layout/PilotStrip";
import { RoleSelection } from "@/components/onboarding/RoleSelection";

export default function OnboardingRolesPage() {
  return (
    <>
      <PilotStrip />
      <Header />
      <main>
        <RoleSelection />
      </main>
      <Footer />
    </>
  );
}
