import { PilotRoleView, pilotRoleMetadata } from "@/components/explore/PilotRoleView";
import { pilotRoleBySlug } from "@/lib/explore/pilotRoles";

export const metadata = pilotRoleMetadata("vendor");

export default function VendorExplorePage() {
  return <PilotRoleView role={pilotRoleBySlug("vendor")!} />;
}
