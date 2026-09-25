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

# XY Factory API (FastAPI) — Manufacturer backend

Serves the Next.js frontend (`frontend/`). The backend was shaped to the
frontend: every request/response uses the frontend's own field names
(`ManufacturerState`, `ProfileWizardData`, `MachineryDraft`, `AccountSubmission`).

```
Browser (Next.js + Clerk) --Bearer JWT--> FastAPI --> Supabase Postgres
                                              \--> Supabase Storage (images)
```

## 1. Database (Supabase)

Either run the SQL files in the Supabase SQL editor, in order:

1. `database/XY_Database_Schema.sql` (only on an empty database)
2. `database/migrations/004_manufacturer_api_support.sql` (also creates the `manufacturer-assets` storage bucket)
3. `database/migrations/005_minimal_reference_seed.sql`
4. `database/migrations/006_frontend_field_support.sql`

or, from this folder: `PYTHONPATH=. python -m app.migrate` — it applies the
schema only if the database is empty, then runs all migrations (they are idempotent).

## 2. Configure and run

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env      # or keep your existing .env - it is compatible
$env:PYTHONPATH="."
python -m app.migrate
uvicorn app.main:app --reload --port 8000
```

macOS/Linux: same, with `source .venv/bin/activate` and `PYTHONPATH=. uvicorn app.main:app --reload --port 8000`.

Check `http://localhost:8000/health/live` and `http://localhost:8000/docs`.

`CORS_ORIGINS` and `CLERK_AUTHORIZED_PARTIES` must contain the frontend
origin (`http://localhost:3000`). `CLERK_SECRET_KEY` is required: on a user's
first request the backend reads their email/name from Clerk and creates the
`users` / `organizations` / `memberships` rows (the Clerk webhook is optional).

## 3. Frontend

In `frontend/.env.local` set `NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1`,
then `npm install && npm run dev`.

## Sample booking requests (optional)

New manufacturers start with an empty Booking Requests list (real data only).
To load the four sample bookings the UI used to hardcode, run
`database/seeds/sample_booking_requests.sql` once in the Supabase SQL editor, then:

```sql
SELECT xy_seed_sample_bookings('manufacturer@example.com');  -- email of a user who filled the details form
```

It returns how many rows were added; running it again adds nothing.

## Endpoints used by the frontend

See `infrastructure/API_CONTRACT.md`.

## Tests

```bash
PYTHONPATH=. python -m pytest                    # unit + contract tests
# full end-to-end test against a disposable Postgres with PostGIS and the schema loaded:
E2E_DATABASE_URL=postgresql+asyncpg://postgres@localhost:5432/xy_test PYTHONPATH=. python -m pytest
```

Tests never read `.env` values (see `tests/conftest.py`), so they cannot touch
your real database. Never point `E2E_DATABASE_URL` at production — the test inserts rows.
