import "@/lib/clerkConfig";
import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { BASE_PATH, withBase } from "@/lib/basePath";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "X!Y - Why own it when you can make it",
  description:
    "X!Y connects designers, manufacturers, suppliers and every partner in between — so production capacity finds demand, and good ideas find a factory floor.",
};

// Inside the Phaarvai website (/xfactory) Clerk's pages and its sign-out landing page carry the
// prefix too. Without a base path nothing is passed and the defaults stay as they were.
const clerkPaths = BASE_PATH
  ? { signInUrl: withBase("/sign-in"), signUpUrl: withBase("/sign-up"), afterSignOutUrl: withBase("/") }
  : {};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} ${ibmPlexMono.variable}`}
    >
      <body>
        <ClerkProvider {...clerkPaths}>{children}</ClerkProvider>
      </body>
    </html>
  );
}
