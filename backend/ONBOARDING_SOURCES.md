# Company onboarding source

How a manufacturer company first came onto X!Y. Rules live in `app/core/onboarding_source.py`;
schema in `database/migrations/020_onboarding_source.sql`.

## What is stored where

| Concept | Column | Notes |
|---|---|---|
| Original source of a company | `organizations.onboarding_source` | Set once by the backend; a database trigger refuses any later change. `NULL` = unknown (shown as "Unknown"). |
| Import batch | `organizations.import_batch_id` → `import_batches` | File name / reference, content SHA-256, operator or job, time. Only for `database_import`. |
| Staged submission | `manufacturer_submissions` | `target_organization_id` (company), `selected_company_id`, `payload` (proposed values), `source`, `submitted_by_user_id`, `source_reference_id`, `submitted_at`, `status` (draft / pending / changes_requested / approved / rejected), `reviewed_by_user_id`, `reviewed_at`, `review_feedback` (review note). |
| History | `manufacturer_submission_events` | `organization_id`, `submission_id`, `event` (imported, submitted, resubmitted, edited, note, decision, merged), `source`, `actor_user_id` / `actor_role`, `created_at`, `idempotency_key`. |

`source` on history rows is the channel of that action. Admin review actions are
`admin_review`, which is never an onboarding source. `organizations.entry_source` (migration 008)
is a separate, admin-editable classification and is not used as evidence of origin.

Sign-in method (Google or email/password) is unrelated and never stored here.

## New records: tracked automatically (no script to run)

| What happens | Recorded automatically |
|---|---|
| Someone signs up on the website (manual or Google) | `users.registration_channel = web_signup`, `registration_method = manual / google` |
| An older account is recognised at sign-in | `registration_channel = legacy_account` |
| An admin creates a staff admin account | `registration_channel = admin_portal` |
| A user submits a NEW company in the manufacturer dashboard | staged submission `source = web_dashboard` + user + time; copied to the company's `onboarding_source` in the approval transaction (a rejected creation is never copied) |
| A user claims / edits / requests changes to an existing company | the company keeps its original source; the submission is `web_dashboard` |
| An admin adds a company (Add company) | company `onboarding_source = admin_entry`; history: admin, time, reason |
| Companies are loaded from a CSV (`python -m app.import_manufacturers`) | `onboarding_source = database_import` + import batch (file, operator, time) |
| An admin approves / rejects / requests corrections | history `admin_review` (reviewer, time, note); the source never changes |

Not a company onboarding channel: a manufacturer organization created from a Clerk *organization*
webhook event (the app has no Clerk Organization step) gets no source and shows "Unknown".

The evidence backfill below is only for records that existed before migration 020; it does not
need to be run again for new records.

## Existing records: evidence backfill

Migration 020 added `onboarding_source` empty (NULL) for every existing company, so the admin
dashboard shows "Unknown" until the backfill below is run. Apply migration 021 first, then:

```bash
PYTHONPATH=. python -m app.backfill_onboarding_source --report source_report.csv     # dry run
PYTHONPATH=. python -m app.backfill_onboarding_source --apply                         # write
# optional evidence:
#   --evidence-ids import_ids.csv   columns organization_id and/or registration_id (from import logs)
#   --accept-direct-load            confirm rule D1 (rows loaded straight into the database)
```

The rules (first match wins) are documented at the top of `app/backfill_onboarding_source.py`:
E1/I1/I2 import evidence, A1 admin creation event, W1 (approved new-company submission)/W2 dashboard
evidence, D1 direct database load (needs confirmation), U-NOT-APPROVED (left to the automatic copy),
X1 conflict (reported, never assigned). A Clerk identity, verified email or Google sign-in is never
used as evidence. Unresolved records keep NULL; their reason is stored in
`onboarding_source_backfill_log` and shown in the admin dashboard next to "Unknown". Assigned values
are logged with rule, evidence and time, and a `source_backfilled` history event is added (its time is
the time of the backfill, not an invented creation time). Re-running changes nothing that is set.

The same command fills `users.registration_channel` (web_signup / legacy_account / admin_portal) from
`registration_method` and the staff-account marker. New registrations record it automatically.

## Channels

| Source | Status | Assigned by |
|---|---|---|
| `database_import` | available | `python -m app.import_manufacturers file.csv [--actor NAME]` |
| `web_dashboard` | available | `POST /manufacturer/account` (user from the verified Clerk session) |
| `admin_entry` | available (migration 022) | Admin dashboard → Manufacturers → **Add company** (`POST /admin/manufacturers`, administrator / operator roles only) |
| `ai_voice_call` | reserved | Not built. |
| `ground_sales` | reserved | Not built. |

Unavailable channels are refused in three places: `onboarding_source.require()` (every
assignment calls it), the database CHECK constraints (only `database_import` / `web_dashboard`
are accepted), and the request bodies (any `source` / `onboardingSource` / `importBatchId` /
... key is rejected with 422).

## Adding a future channel

Both future channels **reuse the staging + admin review flow** and must not create application
users (rows in `users`, Clerk accounts, memberships) automatically.

### AI voice call (`ai_voice_call`)

1. A verified integration: the call provider signs each webhook / API call; the backend verifies
   the signature (like `app/api/routes/webhooks.py`) and accepts it only from the configured
   integration. No user session is involved.
2. Migration: add `'ai_voice_call'` to `chk_org_onboarding_source`,
   `manufacturer_submissions_source_ck` and `manufacturer_submission_events_source_ck`.
3. Set `available=True` for `ai_voice_call` in `SOURCES`.
4. The handler stages a `manufacturer_submissions` row with `source='ai_voice_call'`,
   `submitted_by_user_id = NULL` (automated), `source_reference_id = <conversation id>`, and
   records a `submitted` history event with `actor_role='system'` and
   `idempotency_key='ai_voice_call:<conversation id>'` so a redelivered webhook adds nothing.
   A unique index on `(source, source_reference_id)` should be added in the same migration.
5. A new company created from the call gets `onboarding_source='ai_voice_call'` only when the
   admin approves the submission (no owner, like an imported company). An existing company keeps
   its original source.
6. The submission appears in the existing admin review queue; approval / rejection / corrections
   work as today.

### Ground sales (`ground_sales`)

1. A role-protected workflow: a new platform role (e.g. `field_sales`) checked on the backend for
   every request; the employee is identified from their verified session, never from the body.
2. Migration: add `'ground_sales'` to the same three constraints, plus the new role.
3. Set `available=True` for `ground_sales` in `SOURCES`.
4. The handler stages a submission with `source='ground_sales'`,
   `submitted_by_user_id = <employee's user id>` (the employee, not the company's future owner),
   `source_reference_id = <employee id / visit reference>`, and a `submitted` history event.
5. Approval follows the existing admin review; the company owner, if any, joins later through
   the normal sign-up and claim flow.
