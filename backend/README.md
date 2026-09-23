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
