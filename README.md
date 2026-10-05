# XY Factory (X!Y)

X!Y connects people with product ideas (Visionaries) to Manufacturers. This repository holds
the whole platform: a Next.js frontend, a FastAPI backend, and the Postgres (Supabase)
schema and migrations.

| Portal | Who uses it | Frontend | Backend API |
|---|---|---|---|
| **Manufacturer** | Companies offering production capacity | `/manufacturer` (landing, account details, company profile wizard, machinery, availability, dashboard with booking requests) | `/api/v1/manufacturer/*` |
| **Visionaries** | People with a product idea | `/visionaries` (overview), `/visionaries/flow` (profile, idea, stage, requirements, find a manufacturer, send a request, my project) | `/api/v1/visionary/*` |
| **Admin** | X!Y staff | `/admin` (own sign-in page, manufacturer records, review queue, users, support, analytics) | `/api/v1/admin/*` |
| Shared | Everyone | Home, sign-in / sign-up (Clerk, with new-device verification code), role selection, onboarding | `/api/v1/identity/*`, `/api/v1/webhooks/clerk` |

```
Browser ── Next.js (Vercel) ── Clerk (sign-in)
   │
   └─ Bearer <Clerk session token> ──> FastAPI (Render) ──> Postgres (Supabase)
                                                     └──> Supabase Storage (images)
```

## Repository layout

```
backend/                FastAPI app
  app/
    api/routes/         HTTP routes: identity, manufacturer, visionary, admin, admin_auth, webhooks
    core/               config, Clerk token check, database, email, schema check
    identity/           users and roles
    repositories/, services/, schemas/   Manufacturer portal
    visionary/          Visionaries portal (schemas, repository, service)
    admin/              Admin portal
    storage/            Supabase Storage uploads
    migrate.py          applies the schema + migrations
    admin_account.py    create / manage admin email+password accounts
    grant_admin.py      give an X!Y user admin access
  database/
    XY_Database_Schema.sql   base schema (empty database only)
    migrations/              004 … 012, idempotent, applied in order
    seeds/                   optional sample data
  tests/                pytest (unit, contract and database end-to-end tests)
frontend/               Next.js 16 app (App Router, Clerk)
  src/app/              pages: home, sign-in/up, onboarding, manufacturer, visionaries, admin
  src/components/       UI per portal (manufacturer, visionary, admin, auth, home, layout, ui)
  src/lib/              API client (lib/api.ts) and per-portal helpers
  tests/                component tests (see tests/README.md)
VISIONARIES_PORTAL.md   Visionaries portal: database design, ER diagram, API reference
```

More detail: `backend/README.md` (backend, admin access, email, troubleshooting),
`backend/infrastructure/API_CONTRACT.md` (Manufacturer endpoints), `VISIONARIES_PORTAL.md`.

## Requirements

- Python 3.12 and Node.js 20 or newer
- A Postgres database: Supabase (production) or a local Postgres 16 with PostGIS
- A Clerk application (publishable + secret key)

## Set up and run locally (Windows PowerShell)

### 1. Backend

```powershell
cd backend
py -3.12 -m venv myenv
.\myenv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env        # then fill in your own values (see below)
$env:PYTHONPATH="."
python -m app.migrate              # creates / updates the database (safe to re-run)
uvicorn app.main:app --reload --port 8000
```

Check `http://localhost:8000/health/ready`, which should return `{"status":"ok"}`.
API docs are at `http://localhost:8000/docs` (development only).

### 2. Frontend (second terminal)

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local  # then fill in your own values
npm run dev
```

Open `http://localhost:3000`. The portals are at `/manufacturer`, `/visionaries` and `/admin`.

macOS / Linux: the same steps, using `source myenv/bin/activate` and
`PYTHONPATH=. uvicorn app.main:app --reload --port 8000`.

## Environment variables

Templates with placeholders: `backend/.env.example` and `frontend/.env.example`. Real values
go in `backend/.env` and `frontend/.env.local` locally, and in the Render and Vercel
dashboards in production. **Never commit them.** Both `.gitignore` files exclude them.

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | frontend | Backend URL, e.g. `http://localhost:8000/api/v1` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | frontend | Clerk (public) |
| `CLERK_SECRET_KEY` | frontend + backend | Clerk server key (secret) |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `..._SIGN_UP_URL`, `..._FALLBACK_REDIRECT_URL` | frontend | Clerk page routes |
| `ENVIRONMENT` | backend | `development` locally, `production` on Render (hides `/docs` and database error details) |
| `DATABASE_URL` | backend | Postgres, `postgresql+asyncpg://...` (secret) |
| `CORS_ORIGINS` | backend | Frontend origin(s), e.g. `["http://localhost:3000"]` |
| `CLERK_ISSUER`, `CLERK_JWKS_URL`, `CLERK_AUTHORIZED_PARTIES` | backend | Clerk session-token verification |
| `CLERK_WEBHOOK_SIGNING_SECRET` | backend | Clerk webhook signature (secret, optional) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | backend | Image storage (service key is secret) |
| `ADMIN_EMAILS`, `ADMIN_*` | backend | Admin access and admin session rules |
| `SMTP_*`, `EMAIL_FROM`, `APP_BASE_URL` | backend | Outgoing email (off when `SMTP_HOST` is empty) |
| `GATEWAY_SHARED_SECRET` | backend | Only when an API gateway sits in front; leave empty otherwise |

## Database

`python -m app.migrate` applies `XY_Database_Schema.sql` on an empty database and then every
file in `database/migrations/` in order. The migrations are idempotent and never remove data.
On Supabase you can instead run the same files, in order, in the SQL editor.

| Migration | Adds |
|---|---|
| 004 – 007 | Manufacturer portal fields, reference data, form progress, storage bucket |
| 008 – 011 | Admin dashboard, admin accounts, email log, welcome email |
| 012 | Visionaries portal: profiles, projects, request details, request drafts |
| 013 | Admins tab: temporary passwords (must be changed at first sign-in), who added each admin |
| 015 | Notifications to manufacturers; admin notes can be shared with the manufacturer |

## Admin access

Admins sign in at `/admin/login`, either with an **admin account** (email + password, no X!Y
sign-up needed) or with their normal **X!Y account** if it has an admin role. Admins are not
listed under *Users* in the portal; they have their own **Admins** tab.

**First time (from `backend/`, Windows PowerShell in VS Code):**

```powershell
cd backend
.\myenv\Scripts\Activate.ps1
$env:PYTHONPATH = "."
python -m app.migrate                    # applies migration 013 (and any others not yet applied)
python -m app.admin_account setup        # creates the built-in admin@phaarvai.com; asks for its password
python -m app.admin_account list         # check: admin@phaarvai.com  platform_administrator  active
```

Then start the backend, open `/admin/login`, choose *Admin account* and sign in as
`admin@phaarvai.com`. From the **Admins** tab an administrator can add an admin (a temporary
password is shown once; the new admin must change it at first sign-in), change a role, revoke
or restore access, and reset a password.

The same from the terminal (useful if nobody can sign in):

```powershell
python -m app.admin_account create  you@company.com --name "Your Name" [--role platform_operator]
python -m app.admin_account grant   you@company.com [--role ROLE]   # give or restore access
python -m app.admin_account revoke  you@company.com                 # remove access, end sessions
python -m app.admin_account password you@company.com                # set a new password
python -m app.admin_account disable you@company.com                 # / enable
```

Roles: `platform_administrator` (manages admins), `platform_operator`, `support_specialist`,
`verification_analyst`. The built-in admin, your own access and the last active administrator
cannot be revoked or demoted from the portal. The built-in email comes from
`ADMIN_DEFAULT_EMAIL` (default `admin@phaarvai.com`).

See `backend/README.md` → *Admin Dashboard* for the full details.

## Notifications to manufacturers

The admin portal tells a manufacturer about changes through the bell on their dashboard. Anything new
also opens a popup once ("Open notifications" / "Later").

| Admin action | What the manufacturer sees |
|---|---|
| Review status set to **Needs correction** (a note is required) | "Your profile needs a few corrections" with the note, plus a yellow *Needs correction* box at the top of the panel with an **Update my profile** button |
| **Add note** with **Show to manufacturer** ticked (Onboarding tab or review queue) | "Message from the X!Y team" with the note; while corrections are open it is also listed in the yellow box |
| An admin **edits a profile or machinery field** | "The X!Y team updated your profile" with old → new value and the admin's reason |

Notes without the tick stay private to admins. Tables: `notifications` (one row per company member;
`read_at`, `popup_shown_at`) and `admin_internal_notes.shared_with_manufacturer` (migration 015).
API: `GET /manufacturer/notifications`, `POST /manufacturer/notifications/read` (`{ids}` or `{}` for all),
`POST /manufacturer/notifications/popup-seen`.

## Finding test data

After a test run, look up what was saved without hunting through tables. Both tools are read-only.

**Terminal** (from `backend/`, PowerShell: `$env:PYTHONPATH="."` first; uses the database in `backend/.env`):

```powershell
python -m app.lookup user  you@example.com          # everything for one person: account, manufacturer, visionary, admin, errors, emails
python -m app.lookup user  meera                    # part of an email lists the matches
python -m app.lookup recent 15                      # newest sign-ups and what each one has
python -m app.lookup company "Kaveri"               # companies by name, with the owner's email
python -m app.lookup request REQ-20261001-05DA2C    # one manufacturing request, both sides + status history
python -m app.lookup errors 20                      # latest failed API calls and who made them
python -m app.lookup --wide user you@example.com    # long values in full
```

**Supabase SQL editor:** open `backend/database/debug/find_test_data.sql`, replace `tester@example.com`
with your test email, then select one query and Run. Q1 lists every table with how many rows that person
has and when it last changed.


## Admin access

- **Staff account (email + password):**
  `PYTHONPATH=. python -m app.admin_account create you@company.com --name "Your Name"`
- **Existing X!Y user:**
  - `PYTHONPATH=. python -m app.grant_admin you@company.com`
  - Revoke: add `--revoke`.
  - Or list the email in `ADMIN_EMAILS`.

See `backend/README.md` → *Admin Dashboard* for the full details.

## Tests

```powershell
cd backend; $env:PYTHONPATH="."; python -m pytest -q
# database end-to-end tests too (use a disposable test database, never production):
$env:E2E_DATABASE_URL="postgresql+asyncpg://postgres:PASSWORD@localhost:5432/xy_test"; python -m pytest -q

cd frontend; npx tsc --noEmit; npm run lint; npm run build
```

Frontend component tests: see `frontend/tests/README.md`.

## Deployment

- **Frontend: Vercel.** Root directory `frontend`. Set the frontend variables above, with
  `NEXT_PUBLIC_API_URL` pointing at the backend.
- **Backend: Render web service.**
  - Root directory: `backend`
  - Build command: `pip install -r requirements.txt`
  - Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
  - Variables: the backend ones above, with `ENVIRONMENT=production` and `CORS_ORIGINS` /
    `CLERK_AUTHORIZED_PARTIES` set to the Vercel URL.
- **Database: Supabase.** Run the migrations before deploying a backend that needs them.
  `/health/ready` reports anything missing.
- **Clerk webhook (optional):** `https://<backend>/api/v1/webhooks/clerk`

## Security notes

- Secrets live only in `.env` / `.env.local` and the hosting dashboards. Never commit or share
  them, including in zip files.
- If a secret is ever committed, rotate it at its source (Supabase, Clerk), then update Render
  and Vercel.
- The backend verifies every Clerk token itself. Every Visionary and Manufacturer query is
  limited to the signed-in user's own records.
