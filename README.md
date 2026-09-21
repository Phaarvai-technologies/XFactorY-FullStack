# X!Y Factory Complete MVP

This project connects the supplied Next.js Manufacturer frontend to a FastAPI
backend, Clerk identity, and Supabase PostgreSQL.

## Architecture

```text
Browser → Next.js → Clerk JWT → FastAPI → service → repository → Supabase
                         Clerk webhook ────────┘
```

## Project folders

```text
frontend/       Supplied Next.js 16 + React 19 UI, integrated with FastAPI
backend/        FastAPI, Clerk JWT/webhooks, services and repositories
database/       Complete PostgreSQL/PostGIS schema
infrastructure/ Nginx reverse-proxy example
```

## What is implemented

- Clerk custom sign-up and sign-in
- Clerk-protected frontend routes
- Server-side Clerk JWT/JWKS validation
- Clerk user, organization and membership webhooks
- Supabase-compatible asynchronous PostgreSQL connection
- Database-backed marketplace role selection
- Clerk organization creation and activation for a Manufacturer
- Database-backed Manufacturer account creation
- Database-backed check before account/dashboard redirects
- FastAPI Swagger documentation
- CORS configuration and production configuration checks
- Backend unit tests and frontend production build

The extended profile wizard, machinery, availability and demo bookings remain UI
prototypes. Their database tables exist, but each workflow needs a separately
approved API contract before production persistence is enabled.

## 1. Clerk setup

1. Create a Clerk application.
2. Enable email/password and any required Google sign-in connection.
3. Enable Organizations; allow users to create organizations.
4. Set sign-in and sign-up paths to `/sign-in` and `/sign-up`.
5. Set fallback redirects to `/onboarding/roles`.
6. Create a webhook endpoint:
   `https://YOUR-BACKEND/api/v1/webhooks/clerk`.
7. Subscribe to user, organization and organization-membership create/update/delete events.

## 2. Supabase setup

1. Create a Supabase project.
2. Open its SQL Editor.
3. Run `database/XY_Database_Schema.sql`.
4. Copy the PostgreSQL connection string.
5. Change its scheme for SQLAlchemy asyncpg:
   `postgresql+asyncpg://...`.
6. Add `?ssl=require` if TLS is not already represented in the URL.

## 3. Backend configuration

Windows PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env
```

Fill `backend/.env` with Supabase and Clerk server values. Then run:

```powershell
$env:PYTHONPATH="backend"
python -m app.migrate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

macOS/Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
PYTHONPATH=backend python -m app.migrate
PYTHONPATH=backend uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Verify:

```text
http://localhost:8000/health/live
http://localhost:8000/docs
```

## 4. Frontend configuration

Open a second terminal.

Windows PowerShell:

```powershell
cd frontend
Copy-Item .env.example .env.local
npm install
npm run dev
```

macOS/Linux:

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Configure `frontend/.env.local`:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_replace_me
CLERK_SECRET_KEY=sk_test_replace_me
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/onboarding/roles
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```

Open `http://localhost:3000`.

## 5. End-to-end verification

1. Create a new account in the frontend and verify its email.
2. Select Manufacturer and save roles.
3. Open the Manufacturer account form.
4. Submit company information. The frontend creates and activates a Clerk organization.
5. Confirm `POST /api/v1/manufacturer/account` returns `201`.
6. Refresh the dashboard; it must remain accessible because the backend account exists.
7. Confirm the database:

```sql
SELECT id, clerk_user_id, email, status FROM users ORDER BY created_at DESC;
SELECT id, clerk_organization_id, display_name FROM organizations ORDER BY created_at DESC;
SELECT * FROM marketplace_role_selections ORDER BY selected_at DESC;
SELECT * FROM manufacturer_onboarding ORDER BY created_at DESC;
```

## Tests

```powershell
$env:PYTHONPATH="backend"
python -m pytest backend\tests
cd frontend
npm run lint
npm run build
```
