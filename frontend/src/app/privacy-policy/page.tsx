import type { Metadata } from "next";
import Link from "next/link";
import { PilotInfoPage } from "@/components/layout/PilotInfoPage";

export const metadata: Metadata = {
  title: "Privacy policy — X!Y",
  description:
    "How X!Y handles information while the platform is in its pilot stage.",
};

export default function PrivacyPolicyPage() {
  return (
    <PilotInfoPage
      title="Privacy policy"
      description="A simple notice for the X!Y pilot. This is not a finished legal policy for a fully launched service."
      sections={[
        {
          title: "Pilot stage",
          body: (
            <p>
              X!Y is operating in a pilot and early-stage environment. The product
              is still being tested with a limited group of participants, and the
              way information is used may change as the pilot continues.
            </p>
          ),
        },
        {
          title: "Information we may collect",
          body: (
            <p>
              To provide and improve the platform experience, X!Y may collect
              information you choose to share, such as account details, profile
              information, and what you do while using the site. This helps the
              team run sign-in, onboarding, discovery, and pilot feedback.
            </p>
          ),
        },
        {
          title: "How information is handled",
          body: (
            <p>
              Information shared on X!Y should be handled securely and limited to
              what is needed to operate and improve the pilot. Access is meant for
              running the platform, not for unrelated use.
            </p>
          ),
        },
        {
          title: "Sensitive information",
          body: (
            <p>
              During the pilot, avoid submitting highly sensitive or confidential
              information unless X!Y explicitly asks for it. Do not upload secrets,
              payment details, or private documents that you would not want handled
              in an early-stage test environment.
            </p>
          ),
        },
        {
          title: "Updates",
          body: (
            <p>
              Privacy practices may be updated as the product evolves. When this
              notice changes, the updated version will be posted on this page.
            </p>
          ),
        },
        {
          title: "Privacy questions",
          body: (
            <p>
              For privacy-related questions during the pilot, use the{" "}
              <Link href="/contact">Contact us</Link> page and describe your
              question. A public email address is not published on this site.
            </p>
          ),
        },
      ]}
    />
  );
}
