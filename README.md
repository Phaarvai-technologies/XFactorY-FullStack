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

## Contents

1. [Repository layout](#repository-layout)
2. [Requirements](#requirements)
3. [Set up and run locally](#set-up-and-run-locally)
4. [Environment variables](#environment-variables)
5. [Database and migrations](#database-and-migrations)
6. [Admin access](#admin-access)
7. [Admin portal features](#admin-portal-features)
8. [Manufacturer onboarding (approval first)](#manufacturer-onboarding-approval-first)
9. [Company onboarding source](#company-onboarding-source)
10. [Notifications to manufacturers](#notifications-to-manufacturers)
11. [Command-line tools](#command-line-tools)
12. [Tests](#tests)
13. [Deployment](#deployment)
14. [Troubleshooting](#troubleshooting)
15. [Security notes](#security-notes)

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
| `ADMIN_EMAILS` | backend | X!Y users who get admin access automatically |
| `MANUFACTURER_REAPPLY_AFTER_DAYS` | backend | Days after a rejection before a manufacturer may apply again. **Not decided yet: leave unset** (applying again is then not available; `0` = immediately) |
| `ADMIN_DEFAULT_EMAIL` | backend | The built-in administrator (default `admin@phaarvai.com`) |
| `ADMIN_SESSION_HOURS`, `ADMIN_IDLE_MINUTES`, `ADMIN_MAX_FAILED_LOGINS`, `ADMIN_LOCKOUT_MINUTES` | backend | Admin session and lockout rules |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_SECURITY`, `SMTP_TIMEOUT_SECONDS`, `EMAIL_FROM`, `APP_BASE_URL` | backend | Outgoing email (off when `SMTP_HOST` is empty) |
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
| 016 | Terms and Conditions acceptance recorded at registration |
| 017 | Admin approval of submitted company details (staging in `manufacturer_submissions`) |
| 018 | Compatibility for accounts that existed before explicit registration |
| 019 | Admin-reviewed update requests for a company managed by someone else |
| 020 | Company onboarding source, import batches, onboarding history |
| 021 | Backfill audit log + `users.registration_channel`; then run the onboarding-source backfill for existing records (see below) |
| 022 | Admin Entry: **Add company** in the admin portal records `onboarding_source = admin_entry` |
| 023 | `users.record_type` (Real / Demo / Test) so an admin can mark a person, e.g. a Visionary, as demo data |
| 024 | Approval-first onboarding: `users.personal_email`, application kind `join_company`, `correction_fields`, event `membership_granted`, `manufacturer_application_drafts` |

Run the migrations before deploying a backend that needs them.

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
When they apply as a manufacturer, the application goes to **Onboarding & review** (and the header bell);
after an admin approves it, the applicant is notified and a new company appears in **Manufacturers**. Imported and admin-added companies are listed in Manufacturers straight away.

**Real vs demo data.** Admins mark data as demo with **Mark as demo** (Manufacturers or Visionaries →
Actions), or under *Record classification* on a company's *Onboarding & Review* tab (which also offers
*Test*). A company's mark is `organizations.record_type`; a person's (e.g. a Visionary) is
`users.record_type`. In **Users**, a person counts as *Demo* when they or the company shown for them are
marked Demo or Test; everyone else counts as *Real*. Real + demo = all. Every change is recorded
(company history / the person's activity log). Filters are kept in the URL (`/admin/users?data=demo`,
`/admin/visionaries?data=demo`, `/admin/manufacturers?record_type=DEMO&record_type=TEST`,
`/admin/manufacturers?listing=awaiting`).

**Edit admin details.** Admins tab → **Edit**, or click your name at the top right (Edit my details;
admins signed in with an admin account also find **Change password** there). The sidebar footer shows
your name and email with **Log out**.

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

## Manufacturer onboarding (approval first)

Code: `backend/app/manufacturer_applications.py`, `frontend/src/components/manufacturer/AccountScreen.tsx`,
`ApplicationStatusScreen.tsx`, `frontend/src/components/admin/ApplicationReview.tsx`.

1. **Basic details.** Company information (name, category, location, company phone, production
   capacity) and personal information (first / last name, personal email, date of birth). The company
   phone must be an Indian number and is stored as `+91XXXXXXXXXX`; the personal email is saved on the
   user (`users.personal_email`) and never becomes the company's contact email. The unsent form is kept
   as a draft.
2. **Existing company.** Picked from the search by database id; its saved details are shown read-only
   (the backend re-reads them and refuses changed values). Missing or wrong details can only be
   *suggested* — a staged update request reviewed by X!Y. **New company:** the fields are editable and
   no previous company id is kept.
3. **Pending.** Sending creates one application per user (retries add nothing), notifies the admins
   who can decide (administrators, operators, verification analysts) and shows the applicant a pending
   page. Company profile, machinery, availability and bookings stay locked in the UI **and** the API
   (`403 onboarding_pending`).
4. **Decision** (Onboarding & review → Application):
   * *Approve* — a new company gets its details and the applicant is its primary user; an applicant for an
     existing company becomes a **member** (never the owner, unless the admin ticks “make primary user”,
     offered only when the company has no owner). Applied once; the company's own approval, owner and
     other members are not changed.
   * *Request corrections* — the admin picks the fields; only those can change on resubmission, which
     goes back to the queue and notifies the admins.
   * *Reject* — a reason shown to the applicant, plus an optional internal note that stays in the admin
     portal. The applicant sees the reason and a link back to the main dashboard; their account and other
     roles are unaffected. Reapplying follows `MANUFACTURER_REAPPLY_AFTER_DAYS` (**not decided yet**).
5. **Visible to Visionaries** only when the company is approved **and** its profile is 100% complete
   (`app/core/eligibility.py`); another person's application never changes that.

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
