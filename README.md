# XY Factory (X!Y)

X!Y connects people with product ideas (**Visionaries**) to **Manufacturers**. This repository holds
the whole platform: a Next.js frontend, a FastAPI backend, and the PostgreSQL (Supabase) schema and
migrations.

| Portal | Who uses it | Frontend | Backend API |
|---|---|---|---|
| **Manufacturer** | Companies offering production capacity | `/manufacturer`: landing, account details, company profile wizard, machinery, availability, dashboard with booking requests and notifications | `/api/v1/manufacturer/*` |
| **Visionaries** | People with a product idea | `/visionaries` (overview), `/visionaries/flow` (profile, idea, stage, requirements, find a manufacturer, send a request, my project) | `/api/v1/visionary/*` |
| **Admin** | X!Y staff | `/admin`: its own sign-in page, overview, users, admins, manufacturers, machinery, visionaries, onboarding & review, analytics, support | `/api/v1/admin/*` |
| Shared | Everyone | Home, sign-in / sign-up (Clerk, with Terms acceptance and new-device verification code), role selection, onboarding | `/api/v1/identity/*`, `/api/v1/webhooks/clerk` |

```
Browser ── Next.js (Vercel) ── Clerk (sign-in)
   │
   └─ Bearer <Clerk session token or admin session> ──> FastAPI (Render) ──> PostgreSQL (Supabase)
                                                                    └──> Supabase Storage (images)
```

## Contents

1. [Repository layout](#repository-layout)
2. [Requirements](#requirements)
3. [Set up and run locally](#set-up-and-run-locally)
4. [Environment variables](#environment-variables)
5. [Database and migrations](#database-and-migrations)
6. [Admin access](#admin-access)
7. [Admin portal features](#admin-portal-features)
8. [Company onboarding source](#company-onboarding-source)
9. [Notifications to manufacturers](#notifications-to-manufacturers)
10. [Command-line tools](#command-line-tools)
11. [Tests](#tests)
12. [Deployment](#deployment)
13. [Troubleshooting](#troubleshooting)
14. [Security notes](#security-notes)

## Repository layout

```
backend/                     FastAPI app
  app/
    api/routes/              HTTP routes: identity, manufacturer, visionary, admin, admin_auth, webhooks
    core/                    config, Clerk token check, database, CORS / JSON errors, email, schema check,
                             onboarding-source rules, Windows-safe CLI runner (core/cli.py)
    identity/                users, roles, explicit registration
    repositories/, services/, schemas/   Manufacturer portal
    visionary/               Visionaries portal (schemas, repository, service)
    admin/                   Admin portal (service, repository, admins, company create, accounts)
    storage/                 Supabase Storage uploads
    migrate.py               applies the schema + migrations
    admin_account.py         create / manage admin email + password accounts
    grant_admin.py           give an existing X!Y user admin access
    import_manufacturers.py  import companies from CSV (no duplicates)
    backfill_onboarding_source.py   evidence-based onboarding-source backfill (dry run first)
    lookup.py                read-only test-data lookup
    diagnose_registration.py read-only "registered user is told to sign up" diagnosis
  database/
    XY_Database_Schema.sql   base schema (empty database only)
    migrations/              004 … 023, idempotent, applied in order
    backfills/               one-off backfills for existing data
    debug/                   read-only SQL for the Supabase SQL editor
    seeds/                   optional sample data
  tests/                     pytest (unit, contract and database end-to-end tests)
  ONBOARDING_SOURCES.md      onboarding-source data model, rules and backfill
  infrastructure/API_CONTRACT.md   API reference
frontend/                    Next.js 16 app (App Router, Clerk)
  src/app/                   pages: home, sign-in/up, onboarding, manufacturer, visionaries, admin
  src/components/            UI per portal (manufacturer, visionary, admin, auth, home, layout, ui)
  src/lib/                   API client (lib/api.ts) and per-portal helpers (lib/admin/*)
  tests/                     component tests (Vitest; see tests/README.md)
VISIONARIES_PORTAL.md        Visionaries portal: database design, ER diagram, API reference
```

More detail: `backend/README.md` (backend, admin access, email, troubleshooting),
`backend/infrastructure/API_CONTRACT.md` (endpoints), `backend/ONBOARDING_SOURCES.md`,
`VISIONARIES_PORTAL.md`.

## Requirements

- Python 3.12 and Node.js 20 or newer
- PostgreSQL: Supabase (production) or a local PostgreSQL 16 with PostGIS
- A Clerk application (publishable + secret key)

## Set up and run locally

### 1. Backend (Windows PowerShell)

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

Check `http://localhost:8000/health/ready`, which should return `{"status":"ok"}` (it lists any
missing migration). API docs are at `http://localhost:8000/docs` (development only). The startup
log prints `CORS allowed origins: ...`.

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

Templates with placeholders: `backend/.env.example` and `frontend/.env.example`. Real values go in
`backend/.env` and `frontend/.env.local` locally, and in the Render and Vercel dashboards in
production. **Never commit them.** Both `.gitignore` files exclude them.

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | frontend | Backend URL **including `/api/v1`**, e.g. `http://localhost:8000/api/v1` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | frontend | Clerk (public) |
| `CLERK_SECRET_KEY` | frontend + backend | Clerk server key (secret) |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `..._SIGN_UP_URL`, `..._SIGN_IN_FALLBACK_REDIRECT_URL`, `..._SIGN_UP_FALLBACK_REDIRECT_URL` | frontend | Clerk page routes |
| `NEXT_PUBLIC_BASE_PATH` | frontend | Optional, e.g. `/xfactory` when the app is served inside the Phaarvai site; empty = site root |
| `ENVIRONMENT` | backend | `development` locally, `production` on Render (hides `/docs` and database error details) |
| `DATABASE_URL` | backend | PostgreSQL, `postgresql+asyncpg://user:password@host:5432/db` (secret). Paste it without a trailing newline or space |
| `CORS_ORIGINS` | backend | Browser origin(s) that call the API: scheme + host, no path, no trailing `/`. Comma list `https://www.phaarvai.com,https://phaarvai.com` or JSON list `["https://www.phaarvai.com","https://phaarvai.com"]` |
| `CLERK_ISSUER`, `CLERK_JWKS_URL`, `CLERK_AUTHORIZED_PARTIES` | backend | Clerk session-token verification (`CLERK_AUTHORIZED_PARTIES` takes the same origins as `CORS_ORIGINS`) |
| `CLERK_WEBHOOK_SIGNING_SECRET` | backend | Clerk webhook signature (secret, optional) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | backend | Image storage (service key is secret) |
| `ADMIN_EMAILS` | backend | X!Y users who get admin access automatically |
| `ADMIN_DEFAULT_EMAIL` | backend | The built-in administrator (default `admin@phaarvai.com`) |
| `ADMIN_SESSION_HOURS`, `ADMIN_IDLE_MINUTES`, `ADMIN_MAX_FAILED_LOGINS`, `ADMIN_LOCKOUT_MINUTES` | backend | Admin session and lockout rules |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_SECURITY`, `SMTP_TIMEOUT_SECONDS`, `EMAIL_FROM`, `APP_BASE_URL` | backend | Outgoing email (off when `SMTP_HOST` is empty) |
| `GATEWAY_SHARED_SECRET` | backend | Only when an API gateway sits in front; leave empty otherwise |

The backend trims stray spaces / newlines from `DATABASE_URL` and the Clerk values, and accepts
`CORS_ORIGINS` as a comma list, a JSON list, or with quotes / trailing slashes.

## Database and migrations

`python -m app.migrate` applies `XY_Database_Schema.sql` on an empty database and then every file
in `database/migrations/` in order. Migrations are idempotent and never remove data. On Supabase you
can instead run the same files, in order, in the SQL editor.

| Migration | Adds |
|---|---|
| 004 – 007 | Manufacturer portal fields, reference data, form progress, storage bucket |
| 008 | Admin dashboard: record type (Real / Demo / Test), entry source, review status, archive, change history, internal notes |
| 009 – 011 | Admin accounts (email + password), email log, welcome email |
| 012 | Visionaries portal: profiles, projects, request details, request drafts |
| 013 | Admins tab: temporary passwords (must be changed at first sign-in), who added each admin |
| 014 | Explicit registration (`users.registration_*`, `registration_flows`); then run `database/backfills/014_registration_backfill.sql` once for existing accounts |
| 015 | Notifications to manufacturers; admin notes can be shared with the manufacturer |
| 016 | Terms and Conditions acceptance recorded at registration |
| 017 | Admin approval of submitted company details (staging in `manufacturer_submissions`) |
| 018 | Compatibility for accounts that existed before explicit registration |
| 019 | Admin-reviewed update requests for a company managed by someone else |
| 020 | Company onboarding source, import batches, onboarding history |
| 021 | Backfill audit log + `users.registration_channel`; then run the onboarding-source backfill for existing records (see below) |
| 022 | Admin Entry: **Add company** in the admin portal records `onboarding_source = admin_entry` |
| 023 | `users.record_type` (Real / Demo / Test) so an admin can mark a person, e.g. a Visionary, as demo data |

Run the migrations before deploying a backend that needs them.

## Admin access

Admins sign in at `/admin/login`, either with an **admin account** (email + password, no X!Y sign-up
needed) or with their normal **X!Y account** if it has an admin role. Admins are not listed under
*Users*; they have their own **Admins** tab.

**First time** (from `backend/`, Windows PowerShell):

```powershell
cd backend
.\myenv\Scripts\Activate.ps1
$env:PYTHONPATH = "."
python -m app.migrate                    # applies any migration not yet applied
python -m app.admin_account setup        # creates the built-in admin@phaarvai.com; asks for its password
python -m app.admin_account list         # check: admin@phaarvai.com  platform_administrator  active
```

Then start the backend, open `/admin/login`, choose *Admin account* and sign in as
`admin@phaarvai.com`.

The same from the terminal (useful if nobody can sign in):

```powershell
python -m app.admin_account create   you@company.com --name "Your Name" [--role platform_operator]
python -m app.admin_account grant    you@company.com [--role ROLE]   # give or restore access
python -m app.admin_account revoke   you@company.com                 # remove access, end sessions
python -m app.admin_account password you@company.com                 # set a new password
python -m app.admin_account disable  you@company.com                 # / enable
python -m app.grant_admin            you@company.com [--revoke]      # admin role for an existing X!Y user
```

Roles: `platform_administrator` (manages admins), `platform_operator`, `support_specialist`,
`verification_analyst`. The built-in administrator, your own access and the last active
administrator cannot be revoked or demoted from the portal.

- **401 on `/admin/auth/login`**: wrong email / password, or the account does not exist in *this*
  database. Run `python -m app.admin_account list` against the same `DATABASE_URL`.
- **403 on `/admin/me`**: signed in with an X!Y account that has no admin role. Use
  `python -m app.grant_admin <email>` or add the email to `ADMIN_EMAILS`.

## Admin portal features

| Tab | What it does |
|---|---|
| **Overview** | Key numbers (real records only), needs attention, recent registrations and updates |
| **Users** | Everyone who registered: roles, linked companies with each company's onboarding source, account and onboarding status, registration channel. Filters: search, role, account status, onboarding status and **Data: Real / Demo / Real + demo** (with counts). Suspend / reactivate, troubleshooting details |
| **Admins** | Add admin (temporary password shown once), change role, revoke / restore, reset password, and **Edit** details (see below) |
| **Manufacturers** | **Approved companies and companies added by admins** (imported or *Add company*). A company a user submits in manufacturer onboarding waits in *Onboarding & review* and appears here once an admin approves it (the manufacturer is notified). Filters: search, industry, process, location, completeness, review status, record type, entry source, archive, assignment, **Listing** (approved and admin-added / awaiting approval / all) and the **Data: Real / Demo / Real + demo** shortcut. Row **Actions → Mark as demo / Mark as real**; **Add company** (administrators / operators); batch-archive demo/test records |
| Company detail | Company & contacts, capabilities, documents, onboarding & review (approve / request corrections / decline, update requests, record classification, assignment, notes), onboarding source panel and history, **Registered Users** and **Onboarding requests** (kept separate; refresh without reloading) |
| **Machinery** | All machines with their company |
| **Visionaries** | Demand-side users with their profile, projects and manufacturing requests. **Data: Real / Demo / Real + demo** filter with counts; **Actions → Mark as demo / Mark as real** (also on the Visionary's page) |
| **Onboarding & review** | Review queue (demo/test excluded unless included) |
| **Analytics** | Registrations, completion, data quality (demo/test excluded unless included) |
| **Support** | Users with failed actions |

**Who appears where.** Someone who only signs up is a registered user and appears only in **Users**.
When they join as a manufacturer and submit their company details, the company goes to **Onboarding &
review**; after an admin approves it, the manufacturer is notified and the company appears in
**Manufacturers**. Imported and admin-added companies are listed in Manufacturers straight away.

**Real vs demo data.** Admins mark data as demo with **Mark as demo** (Manufacturers or Visionaries →
Actions), or under *Record classification* on a company's *Onboarding & Review* tab (which also offers
*Test*). A company's mark is `organizations.record_type`; a person's (e.g. a Visionary) is
`users.record_type`. In **Users**, a person counts as *Demo* when they or the company shown for them are
marked Demo or Test; everyone else counts as *Real*. Real + demo = all. Every change is recorded
(company history / the person's activity log). Filters are kept in the URL (`/admin/users?data=demo`,
`/admin/visionaries?data=demo`, `/admin/manufacturers?record_type=DEMO&record_type=TEST`,
`/admin/manufacturers?listing=awaiting`).

**Edit admin details.** Admins tab → **Edit**, or click your name at the top right / **Edit my
details** in the sidebar:

- First name, last name and phone. Administrators can edit any admin; every admin can edit their own.
- The **sign-in email** can be changed only for admin-only accounts. It is locked for an admin who
  signs in with an X!Y account (that email belongs to the X!Y account) and for the built-in
  administrator. An email already used by another account is refused.
- For an admin with an X!Y account the new name is also saved in Clerk, so the next X!Y sign-in keeps
  it. If Clerk cannot be reached, the name is still saved and the portal says so.
- Every change is recorded in the activity log. API: `PATCH /api/v1/admin/admin-users/{id}`.

**Company contact vs users.** A company's contact email / phone come only from the company profile;
the sign-in emails of its users are listed separately under *Registered Users* and never overwrite
the company contact.

## Company onboarding source

How a manufacturer company first came onto X!Y is stored once in `organizations.onboarding_source`
(a database trigger refuses later changes) and shown in Users, Manufacturers and the company detail.

| Source | Set automatically by |
|---|---|
| `database_import` | `python -m app.import_manufacturers file.csv [--actor NAME]` (with an import batch: file, SHA-256, operator, time) |
| `web_dashboard` | A new company submitted in the manufacturer dashboard; copied to the company when an admin approves it |
| `admin_entry` | Admin portal → Manufacturers → **Add company** |
| `ai_voice_call`, `ground_sales` | Reserved for future channels (refused until built) |

Clients can never send a source; the backend sets it. Records that existed before migration 020
show *Unknown* until the evidence backfill is run:

```powershell
python -m app.backfill_onboarding_source --report source_report.csv   # dry run: review the CSV
python -m app.backfill_onboarding_source --apply                       # write (never overwrites a known source)
```

Full rules: `backend/ONBOARDING_SOURCES.md`.

## Notifications to manufacturers

The admin portal tells a manufacturer about changes through the bell on their dashboard. Anything new
also opens a popup once ("Open notifications" / "Later").

| Admin action | What the manufacturer sees |
|---|---|
| Review status set to **Needs correction** (a note is required) | "Your profile needs a few corrections" with the note, plus a yellow *Needs correction* box with an **Update my profile** button |
| **Add note** with **Show to manufacturer** ticked | "Message from the X!Y team" with the note |
| An admin **edits a profile or machinery field** | "The X!Y team updated your profile" with old → new value and the admin's reason |

Notes without the tick stay private to admins. API: `GET /manufacturer/notifications`,
`POST /manufacturer/notifications/read`, `POST /manufacturer/notifications/popup-seen`.

## Command-line tools

All from `backend/` with the virtual environment active and `$env:PYTHONPATH="."` (PowerShell) or
`PYTHONPATH=.` (macOS / Linux). They use the database in `backend/.env`. They work on Windows with
either `postgresql+asyncpg://` or `postgresql+psycopg://` URLs.

| Command | Purpose |
|---|---|
| `python -m app.migrate` | Apply the schema and migrations |
| `python -m app.admin_account …` | Admin email + password accounts (see *Admin access*) |
| `python -m app.grant_admin EMAIL [--revoke]` | Admin role for an existing X!Y user |
| `python -m app.import_manufacturers FILE.csv [--dry-run] [--actor NAME]` | Import companies without duplicates |
| `python -m app.backfill_onboarding_source --report FILE / --apply` | Onboarding-source backfill |
| `python -m app.lookup user EMAIL` · `recent 15` · `company NAME` · `request REQ-…` · `errors 20` | Read-only test-data lookup (`--wide` for long values) |
| `python -m app.diagnose_registration --email EMAIL` | Read-only diagnosis when a registered user is told to sign up |

**Supabase SQL editor:** `backend/database/debug/find_test_data.sql` (replace the test email, select
one query, Run).

## Tests

```powershell
# backend (unit + contract tests)
cd backend; $env:PYTHONPATH="."; python -m pytest -q
# + database end-to-end tests: use a disposable test database, NEVER production
$env:E2E_DATABASE_URL="postgresql+asyncpg://postgres:PASSWORD@localhost:5432/xy_test"; python -m pytest -q

# frontend
cd frontend; npx tsc --noEmit; npm run lint; npm test; npm run build
```

Frontend component tests: see `frontend/tests/README.md`.

## Deployment

- **Frontend: Vercel.** Root directory `frontend`. Set the frontend variables, with
  `NEXT_PUBLIC_API_URL` pointing at the backend (`https://<backend>/api/v1`).
- **Backend: Render web service.**
  - Root directory: `backend`
  - Build command: `pip install -r requirements.txt`
  - Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
  - Variables: the backend ones above, with `ENVIRONMENT=production`, and `CORS_ORIGINS` /
    `CLERK_AUTHORIZED_PARTIES` set to every origin the site is opened from, e.g.
    `https://www.phaarvai.com,https://phaarvai.com` (add the Vercel URL if it is used directly).
- **Database: Supabase.** Run the migrations first; `/health/ready` reports anything missing.
- **Clerk webhook (optional):** `https://<backend>/api/v1/webhooks/clerk`

After deploying, check `https://<backend>/health/ready` and the Render log line
`CORS allowed origins: ...`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Browser: *No 'Access-Control-Allow-Origin' header* calling the API | The site's origin is missing from `CORS_ORIGINS` on Render. Add it (scheme + host, no path) and redeploy |
| Render: *Exited with status 1* right after a settings change | Usually an invalid variable value. Check the log above that line; use the formats in *Environment variables* |
| Render: `database "postgres\n" does not exist` | `DATABASE_URL` was pasted with a newline. Re-paste it on one line |
| Sign-in: *`identifier` is required when `strategy` is `email_code`* | The verification step expired after a failed check. Enter the password again to get a new code (the form now restarts automatically) |
| Windows: *Psycopg cannot use the 'ProactorEventLoop'* | Fixed in the CLI tools; or use `postgresql+asyncpg://` in the local `DATABASE_URL` |
| Admin login 401 / `/admin/me` 403 | See *Admin access* |
| A registered user is told to sign up | `python -m app.diagnose_registration --email …` |

## Security notes

- Secrets live only in `.env` / `.env.local` and the hosting dashboards. Never commit or share them,
  including in zip files.
- If a secret is ever committed, rotate it at its source (Supabase, Clerk), then update Render and
  Vercel.
- Never point `E2E_DATABASE_URL` at production: the end-to-end tests write data.
- The backend verifies every Clerk token and admin session itself. Every Visionary and Manufacturer
  query is limited to the signed-in user's own records; admin routes check the admin role on every
  request.
