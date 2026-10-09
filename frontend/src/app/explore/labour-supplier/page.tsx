import { PilotRoleView, pilotRoleMetadata } from "@/components/explore/PilotRoleView";
import { pilotRoleBySlug } from "@/lib/explore/pilotRoles";

export const metadata = pilotRoleMetadata("labour-supplier");

export default function LabourSupplierExplorePage() {
  return <PilotRoleView role={pilotRoleBySlug("labour-supplier")!} />;
}
