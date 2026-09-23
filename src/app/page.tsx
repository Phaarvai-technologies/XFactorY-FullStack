import { FeatureSections } from "@/components/home/FeatureSections";
import { Hero } from "@/components/home/Hero";
import { PersonaIcons } from "@/components/home/PersonaIcons";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { PilotStrip } from "@/components/layout/PilotStrip";

export default function HomePage() {
  return (
    <>
      <PersonaIcons />
      <PilotStrip />
      <Header />
      <main>
        <Hero />
        <FeatureSections />
      </main>
      <Footer />
    </>
  );
}
