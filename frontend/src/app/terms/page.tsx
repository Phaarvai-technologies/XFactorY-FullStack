import type { Metadata } from "next";
import Link from "next/link";
import { PilotInfoPage } from "@/components/layout/PilotInfoPage";

export const metadata: Metadata = {
  title: "Terms of service — X!Y",
  description:
    "Simple pilot-stage terms for using X!Y while the platform is still being tested.",
};

export default function TermsPage() {
  return (
    <PilotInfoPage
      title="Terms of service"
      description="These notes explain how to use X!Y during the pilot. They are not a finished commercial agreement."
      sections={[
        {
          title: "Pilot phase",
          body: (
            <p>
              X!Y is in a pilot and early-stage phase. The site is a discovery and
              engagement platform for people in manufacturing. It is being tried
              with a limited group and is not presented as a fully launched service.
            </p>
          ),
        },
        {
          title: "Testing and feedback",
          body: (
            <p>
              The platform is being tested and improved from user feedback. What
              you see may be incomplete, and some paths may still be in progress.
            </p>
          ),
        },
        {
          title: "Accurate information",
          body: (
            <p>
              Please provide accurate information about yourself, your
              organization, and what you are looking for. Other participants rely
              on what you share when they decide whether to connect.
            </p>
          ),
        },
        {
          title: "Features may change",
          body: (
            <p>
              Platform features and workflows may change during the pilot. Screens,
              roles, and steps can be added, updated, or removed while the team
              learns what works.
            </p>
          ),
        },
        {
          title: "No guaranteed outcomes",
          body: (
            <p>
              Information, matches, manufacturer details, opportunities, and other
              content on X!Y should not automatically be treated as guaranteed
              business outcomes. A listing or suggestion is a starting point for
              your own review, not a promise of work, supply, investment, or a
              completed deal.
            </p>
          ),
        },
        {
          title: "Your decisions",
          body: (
            <p>
              You are responsible for reviewing information before you make a
              business decision. Agreements, transactions, and hiring happen
              directly between the people you connect with. X!Y does not process
              payments or act as a legal, investment, or employment advisor.
            </p>
          ),
        },
        {
          title: "Questions",
          body: (
            <p>
              If you have a question about these pilot terms, visit{" "}
              <Link href="/contact">Contact us</Link>.
            </p>
          ),
        },
      ]}
    />
  );
}
