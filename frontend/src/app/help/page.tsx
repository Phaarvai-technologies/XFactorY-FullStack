import type { Metadata } from "next";
import Link from "next/link";
import { PilotInfoPage } from "@/components/layout/PilotInfoPage";

export const metadata: Metadata = {
  title: "Help center — X!Y",
  description: "Simple guidance for using X!Y during the pilot.",
};

export default function HelpPage() {
  return (
    <PilotInfoPage
      title="Help center"
      description="Short guides for the current X!Y pilot. These steps may be updated as testing continues."
      notice="X!Y is currently in a pilot stage. Some features and workflows may change as we continue testing and improving the platform."
      sections={[
        {
          title: "Getting started",
          body: (
            <p>
              Start on the home page and choose the role that fits how you want to
              take part. You can create an account, look through manufacturer and
              visionary overviews, and return later as the pilot grows.
            </p>
          ),
        },
        {
          title: "Creating an account",
          body: (
            <p>
              Use <Link href="/sign-up">Create account</Link> to register, or{" "}
              <Link href="/sign-in">Sign in</Link> if you already have one. After
              sign-up you may be asked for a profile, an organization, and the
              roles you want to use. Enter details you are comfortable sharing
              during the pilot.
            </p>
          ),
        },
        {
          title: "Exploring manufacturers",
          body: (
            <p>
              Open <Link href="/manufacturer">Manufacturers</Link> to see the
              manufacturer overview, or <Link href="/visionaries">Visionaries</Link>{" "}
              if you are exploring from a product idea. Profiles and availability
              are shared so people can evaluate a possible fit. They are not a
              commitment to take on work.
            </p>
          ),
        },
        {
          title: "Creating or viewing a project",
          body: (
            <p>
              Signed-in visionaries can describe a project idea, the product, and
              what the project needs, then review that project in the visionary
              flow. What you can create or view may change while the pilot is
              being tested. If a step is unavailable, it is still being prepared.
            </p>
          ),
        },
        {
          title: "Understanding the pilot workflow",
          body: (
            <>
              <p>
                The pilot path on the home page is: describe a need, discover
                capabilities, look at relevant matches, start a conversation, and
                share information deliberately.
              </p>
              <p>
                This is a working sequence for testing, not a finished production
                process. Matches and conversations do not by themselves create a
                contract or a guaranteed result.
              </p>
            </>
          ),
        },
        {
          title: "Common questions",
          body: (
            <>
              <p>
                Is X!Y fully launched? No. It is in a pilot in limited regions
                while the first participants are onboarded.
              </p>
              <p>
                Does X!Y handle payment or hiring? No. Those happen directly
                between the people who choose to work together.
              </p>
              <p>
                Why does a screen look unfinished? Features and workflows can
                change during testing. Use the contact page if something blocks
                you.
              </p>
            </>
          ),
        },
        {
          title: "Contact support",
          body: (
            <p>
              For help during the pilot, go to <Link href="/contact">Contact us</Link>{" "}
              and choose the topic that fits: a general question, feedback, a
              technical issue, or an account question.
            </p>
          ),
        },
      ]}
    />
  );
}
