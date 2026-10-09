import type { Metadata } from "next";
import { PilotInfoPage } from "@/components/layout/PilotInfoPage";

export const metadata: Metadata = {
  title: "Contact us — X!Y",
  description: "How to reach the X!Y team during the pilot.",
};

export default function ContactPage() {
  return (
    <PilotInfoPage
      title="Contact us"
      description="Ways to think about reaching the X!Y team while the platform is in its pilot."
      notice="A public email address, phone number, and office address are not published on this pilot site. Use the topics below to see what the team can help with. If you already have an account, keep your sign-in email ready so a question can be matched to the right account when you are in touch."
      sections={[
        {
          title: "General questions",
          body: (
            <p>
              Ask about what X!Y is for, which roles are open in the pilot, and
              what you can try on the site today.
            </p>
          ),
        },
        {
          title: "Pilot feedback",
          body: (
            <p>
              Tell the team what was clear, what was confusing, and what you
              expected to happen. Feedback is used to improve the pilot. It does
              not by itself change a listing or create a business commitment.
            </p>
          ),
        },
        {
          title: "Technical issues",
          body: (
            <p>
              If a page does not load, a button does nothing, or you cannot finish
              a step, note the page you were on and what you tried to do.
            </p>
          ),
        },
        {
          title: "Account-related issues",
          body: (
            <p>
              For trouble signing in, creating an account, or updating a profile,
              include the email you used to register so the right account can be
              found. Do not send passwords or other secrets.
            </p>
          ),
        },
        {
          title: "Partnership / business enquiries",
          body: (
            <p>
              If you want to talk about taking part in the pilot as a
              manufacturer, visionary, or supporting partner, describe your
              organization and the kind of connection you are exploring. An
              enquiry is not an agreement to work together.
            </p>
          ),
        },
      ]}
    />
  );
}
