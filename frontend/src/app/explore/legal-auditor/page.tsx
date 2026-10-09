import { PilotRoleView, pilotRoleMetadata } from "@/components/explore/PilotRoleView";
import { pilotRoleBySlug } from "@/lib/explore/pilotRoles";

export const metadata = pilotRoleMetadata("legal-auditor");

export default function LegalAuditorExplorePage() {
  return <PilotRoleView role={pilotRoleBySlug("legal-auditor")!} />;
}
