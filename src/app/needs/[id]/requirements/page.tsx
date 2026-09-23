import { redirect } from "next/navigation";
import { needRequirementEditorPath } from "@/lib/needs/paths";

type RequirementsAliasPageProps = {
  params: Promise<{ id: string }>;
};

/** Spec alias for Requirement Editor — keeps Prompt 5 Back-to-Edit path stable. */
export default async function RequirementsAliasPage({
  params,
}: RequirementsAliasPageProps) {
  const { id } = await params;
  redirect(needRequirementEditorPath(id));
}
