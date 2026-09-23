# X!Y — The Explorer Factory

Frontend for the X!Y manufacturing marketplace: Next.js (App Router), React, TypeScript, Tailwind CSS, and Clerk authentication.

The home page is a faithful port of the reference landing HTML (`xy-landing-page`).

## Prerequisites

- Node.js 20.9+ recommended
- npm 10+
- A Clerk application (dev keys are written by `clerk init`, or paste keys from the [Clerk Dashboard](https://dashboard.clerk.com/))

## Setup

```bash
npm install
cp .env.example .env.local
```

Fill `.env.local` with your Clerk keys (or run `npx clerk@latest init -y --accountless --no-skills`).

### Environment variables

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (public) |
| `CLERK_SECRET_KEY` | Clerk secret key (server only — never expose to the client) |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | Post sign-in redirect (`/onboarding/roles`) |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | Post sign-up redirect (`/onboarding/roles`) |

In the Clerk Dashboard, set the sign-in and sign-up paths to `/sign-in` and `/sign-up`.

### Clerk password policy (minimum 8 characters)

The custom Sign Up form validates passwords with a **minimum length of 8 characters**. Clerk must use the same minimum, or sign-up will fail with a Clerk API error (for example, “password must contain at least 15 characters”) shown in the password field.

**Clerk Dashboard:**

1. Open the [Clerk Dashboard](https://dashboard.clerk.com/) for this project.
2. Go to **User & Authentication**.
3. Open **Password** or **Authentication** settings.
4. Change the **minimum password length** from **15** to **8**.
5. Save the configuration.
6. Restart the Next.js development server if required (`npm run dev`).

There is no 15-character minimum in the frontend code. If you still see a 15-character error after submitting the form, the Clerk Dashboard policy has not been updated yet.

## Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm run build
npm start
```

## Routes

| Route | Access |
| --- | --- |
| `/` | Public home page |
| `/sign-in` | Public Clerk sign-in |
| `/sign-up` | Public Clerk sign-up |
| `/account/verify` | Authenticated account verification helper |
| `/onboarding/roles` | Authenticated role selection |
| `/onboarding/organization` | Authenticated placeholder |
| `/onboarding/profile` | Authenticated placeholder |
| `/organization/verification` | Authenticated placeholder |
| `/app` | Authenticated workspace shell |
| `/notifications` | Authenticated placeholder |
| `/help` | Authenticated help shell |

Protection is enforced in `src/proxy.ts` via `clerkMiddleware` + `auth.protect()` (Next.js 16 proxy convention).

## Personas / roles

TypeScript personas live in `src/types/personas.ts`. The role selection UI at `/onboarding/roles` stores selections in `localStorage` for this MVP (`src/lib/auth/roles.ts`). Replace with Clerk metadata / backend authorization later — do not hardcode real permissions in the frontend.

## Design notes

- Landing styles are preserved from the reference HTML in `src/app/globals.css`.
- Hero blueprint asset: `public/images/hero-blueprint.png` (extracted from the reference HTML).
- Sign-in / sign-up use the split-panel auth layout from the reference (`AuthShell`, `AuthBrandPanel`) with Clerk embedded in the right panel.
- Fonts: Space Grotesk, Inter, IBM Plex Mono via `next/font`.

## Project structure (key paths)

```
src/
  app/
    page.tsx                    # Home (public)
    layout.tsx                  # ClerkProvider + fonts
    sign-in/[[...sign-in]]/     # Clerk sign-in
    sign-up/[[...sign-up]]/     # Clerk sign-up
    account/verify/             # Post-sign-up verification helper
    onboarding/roles/           # Role selection (protected)
    app/                        # Authenticated workspace shell
  components/
    auth/                       # Sign-in reference layout
    home/                       # Hero, personas, process, scope, trust
    layout/                     # Header, Footer, Logo, PilotStrip
    onboarding/RoleSelection.tsx
  lib/auth/                     # Role localStorage + Clerk appearance
  types/personas.ts             # Persona TypeScript model
  proxy.ts                      # Clerk route protection (Next.js 16)
public/images/hero-blueprint.png
```
