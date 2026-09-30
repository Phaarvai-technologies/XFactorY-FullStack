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
5. `database/migrations/007_form_progress.sql`
6. `database/migrations/008_admin_dashboard.sql` (Admin Dashboard: record type, entry source,
   archive, assignment, change history, internal notes, activity log, `admin_manufacturer_overview` view)
7. `database/migrations/009_admin_accounts.sql` (admin email + password sign-in)

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

## Admin Dashboard (`/admin`)

Admins are users with an active row in `platform_role_assignments`
(platform_administrator, platform_operator, support_specialist or verification_analyst).
Everyone else gets 403 from every `/api/v1/admin/...` endpoint and sees
"Admin access only" at `/admin`.

### Signing in to `/admin` — two methods (page `/admin/login`)

| Method | Who | How to set up |
| --- | --- | --- |
| **Admin account** (email + password) | X!Y staff, no X!Y sign-up needed | `PYTHONPATH=. python -m app.admin_account create you@company.com --name "Your Name"` (asks for the password) |
| **X!Y account** (the normal Clerk email + password) | an X!Y user who has an admin role | `ADMIN_EMAILS=you@company.com` in `.env` (granted on first visit), or `PYTHONPATH=. python -m app.grant_admin you@company.com` |

If the email already has an X!Y (Clerk) account, `admin_account create` links the password
to that same user, so the person can use either method. If the person signs up to X!Y later
with the same (verified) email, their X!Y sign-in joins the same user record.

Managing admin accounts (the password is typed at a hidden prompt, never on the command line;
add `--password-stdin` for scripts):

```bash
PYTHONPATH=. python -m app.admin_account create   you@company.com --name "Your Name"
PYTHONPATH=. python -m app.admin_account password you@company.com   # reset (signs out all sessions)
PYTHONPATH=. python -m app.admin_account disable  you@company.com   # blocks sign-in, ends sessions
PYTHONPATH=. python -m app.admin_account enable   you@company.com   # also clears a lockout
PYTHONPATH=. python -m app.admin_account list
```

Security of admin accounts:
- Passwords: at least 12 characters with letters and a number; stored only as a salted scrypt hash.
- 5 wrong passwords in a row lock the account for 15 minutes (`ADMIN_MAX_FAILED_LOGINS`,
  `ADMIN_LOCKOUT_MINUTES`). Unknown emails get the same "Incorrect email or password." answer.
- Sessions end after 60 minutes without activity or 12 hours (`ADMIN_IDLE_MINUTES`,
  `ADMIN_SESSION_HOURS`), on "Log out", on a password change (other devices), or when the
  admin is suspended in Users. The browser keeps the session only for the open tab
  (sessionStorage); the database stores only a SHA-256 of the session token.
- Sign-ins and failed attempts show in that admin's Users → troubleshooting panel.
- Admins signed in with the admin account can change their password from the sidebar.

What it records (migration 008):

| Table / view | Used for |
| --- | --- |
| `organizations.record_type` (REAL/DEMO/TEST), `entry_source` (MANUFACTURER/ADMIN_ASSISTED/IMPORTED), `referral_source`, `assigned_admin_user_id`, `is_archived`, `archived_at` | XY-ADMIN-04/07/08 |
| `admin_change_history` | every admin change: field, old value, new value, admin, time, reason |
| `admin_internal_notes` | notes only admins can see |
| `user_activity_events` | failed API calls (method, path, status, message, error reference) and suspensions — never passwords, codes or tokens |
| `users.last_seen_at` | last activity (updated at most every 5 minutes) |
| `admin_accounts`, `admin_sessions` (migration 009) | admin email + password sign-in |
| `admin_manufacturer_overview` (view) | one row per manufacturer for lists, queue and analytics |

Onboarding status is `manufacturer_onboarding.status`, shown as Not started / In progress /
Submitted / Needs correction / Reviewed. A profile moves to Submitted automatically when every
required section is complete. Completeness = required items completed ÷ 14 × 100 (the 14 items
are listed on the manufacturer's Onboarding & Review tab); it is separate from the percentage the
manufacturer sees on their own dashboard. Suspending a user blocks the API (403) and bans the
user in Clerk. "Open support issues" = users with failed operations in the last 7 days.

## Endpoints used by the frontend

See `infrastructure/API_CONTRACT.md`.

## Running behind the API gateway

In production the backend is not exposed directly: `docker compose up --build`
(project root) starts it on a private network behind the nginx + ModSecurity
gateway, which terminates HTTPS and filters attacks. See `../gateway/README.md`.
The backend still verifies every Clerk JWT itself. `backend/Dockerfile` runs
uvicorn with `--proxy-headers` so client IPs/scheme come from the gateway.

## Behind the gateway on Render

With the gateway as its own Render service (`GATEWAY_MODE=behind-proxy`, see
`../gateway/README.md`), set `GATEWAY_SHARED_SECRET` here and on the gateway to the same
random value. The backend then answers only requests forwarded by the gateway; a call to
its own `onrender.com` URL gets 403 (`/health` and `/health/live` stay open for Render's
health check).

## Email

The backend emails users when an admin marks their profile *Needs correction* or
*Reviewed*, suspends or reactivates their account, when a new user registers (welcome),
and emails admins about their admin account. It is **off** unless `SMTP_HOST` is set;
set the `SMTP_*` values in `.env` (see `.env.example`) to an email provider to send.
Admin → Support has a **Send test email** button and the delivery log; each user's page
lists the emails sent to them. Verification codes are sent by Clerk, not by this backend.

## Troubleshooting

- Check `http://localhost:8000/health/ready`: it lists any missing tables/columns.
  On startup the uvicorn console also prints `DATABASE IS MISSING MIGRATIONS` if
  the database is behind. Fix: `PYTHONPATH=. python -m app.migrate` (safe to re-run),
  or run the files in `database/migrations/` in the Supabase SQL editor.
- Every error response has a `detail` message; open the browser's Network tab,
  click the failed request and read its Response.
- 401: Clerk token rejected - check `CLERK_ISSUER`, `CLERK_JWKS_URL`, `CLERK_AUTHORIZED_PARTIES`.
- 422: the request body is invalid (the `detail` names the field).

## Tests

```bash
PYTHONPATH=. python -m pytest                    # unit + contract tests
# full end-to-end test against a disposable Postgres with PostGIS and the schema loaded:
E2E_DATABASE_URL=postgresql+asyncpg://postgres@localhost:5432/xy_test PYTHONPATH=. python -m pytest
```

Tests never read `.env` values (see `tests/conftest.py`), so they cannot touch
your real database. Never point `E2E_DATABASE_URL` at production — the test inserts rows.
