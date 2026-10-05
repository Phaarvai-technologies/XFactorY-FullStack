import { PilotRoleView, pilotRoleMetadata } from "@/components/explore/PilotRoleView";
import { pilotRoleBySlug } from "@/lib/explore/pilotRoles";

export const metadata = pilotRoleMetadata("logistics-supplier");

export default function LogisticsSupplierExplorePage() {
  return <PilotRoleView role={pilotRoleBySlug("logistics-supplier")!} />;
}
