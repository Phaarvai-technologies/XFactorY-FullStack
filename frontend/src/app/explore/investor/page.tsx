import { PilotRoleView, pilotRoleMetadata } from "@/components/explore/PilotRoleView";
import { pilotRoleBySlug } from "@/lib/explore/pilotRoles";

export const metadata = pilotRoleMetadata("investor");

export default function InvestorExplorePage() {
  return <PilotRoleView role={pilotRoleBySlug("investor")!} />;
}
