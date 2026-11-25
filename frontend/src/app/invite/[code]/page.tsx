import { AuthBrandPanel } from "@/components/auth/AuthBrandPanel";
import { InviteAcceptance } from "@/components/auth/InviteAcceptance";

type InvitePageProps = { params: Promise<{ code: string }> };

/** Manufacturer magic link: /invite/{code} signs the manufacturer in without a password. */
export default async function InvitePage({ params }: InvitePageProps) {
  const { code } = await params;
  return (
    <div className="auth-page-split">
      <AuthBrandPanel />
      <div className="auth-wrap">
        <div className="auth-card">
          <InviteAcceptance code={code} />
        </div>
      </div>
    </div>
  );
}
