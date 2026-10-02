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
