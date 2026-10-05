import { PilotRoleView, pilotRoleMetadata } from "@/components/explore/PilotRoleView";
import { pilotRoleBySlug } from "@/lib/explore/pilotRoles";

export const metadata = pilotRoleMetadata("market-lead");

export default function MarketLeadExplorePage() {
  return <PilotRoleView role={pilotRoleBySlug("market-lead")!} />;
}
