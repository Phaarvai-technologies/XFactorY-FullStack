# API contract (frontend <-> backend)

Base URL `/api/v1`. Every call sends `Authorization: Bearer <Clerk session JWT>`
(`useAuth().getToken()`). Errors use FastAPI's `{"detail": ...}`: 401 missing or
invalid token, 403 organization is not a Manufacturer, 404 unknown id,
409 conflict / user not synchronised, 422 validation, 503 missing server config.

Every Manufacturer endpoint returns the same snapshot:

```json
{ "accountExists": true, "state": { ...ManufacturerState }, "profileData": { ...ProfileWizardData } }
```

Machinery and booking `id`s are UUID strings; the frontend maps them to the
numeric ids its components use.

| Frontend action | Method & path | Body |
|---|---|---|
| Open dashboard / account page | `GET /manufacturer/bootstrap` | – |
| AccountScreen "Create Manufacturer account" | `POST /manufacturer/account` (201) | `AccountSubmission` |
| Profile wizard edits (all 5 steps) | `PATCH /manufacturer/profile` | Only the changed fields (see below) |
| (older clients) | `PUT /manufacturer/profile` | Whole `ProfileWizardData`; deprecated |
| Machinery wizard step 1 "Save & Next" | `POST /manufacturer/machinery/drafts` (201) | `clientKey` + step fields + `progress` (creates the draft once) |
| Machinery wizard later steps | `PATCH /manufacturer/machinery/{id}` | changed fields + `progress` |
| Machinery wizard Publish / Save as Draft | `PATCH /manufacturer/machinery/{id}` | `finish: "Published" \| "Draft"` (+ any last changes) |
| (older clients) one-shot create | `POST /manufacturer/machinery` (201) | `MachineryDraft` + `status` |
| Publish / Unpublish / Archive listing | `PATCH /manufacturer/machinery/{id}/status` | `{"status": "Draft\|Published\|Unpublished\|Archived"}` |
| Calendar day, recurring, capacity | `PATCH /manufacturer/availability` | only the part that changed: `{calendar}`, `{recurring}` or `{capacity}` |
| Booking Accept / Confirm | `PATCH /manufacturer/booking-requests/{id}` | `{"status": "accepted"}` -> Booked |
| Booking Decline / Cancel | same | `{"status": "declined"}` -> Cancelled |
| Roles page load | `GET /identity/me` | – returns `{user, roles, manufacturerAccountExists}` |
| Roles page "Continue" | `PUT /identity/me/roles` | `{"roles": [PersonaId]}` returns `{roles, manufacturerAccountExists}` |
| Clerk webhook | `POST /webhooks/clerk` | Svix-signed |

Where the data goes:

| Frontend data | Tables |
|---|---|
| account | `users`, `organizations`, `organization_profiles`, `marketplace_role_selections`, `manufacturer_onboarding` |
| profile | `organizations`, `organization_profiles`, `facilities` (address, pin -> `location` geography), `organization_certifications`, `manufacturer_infrastructure`, `manufacturer_faq_answers`, `files` |
| machinery | `taxonomy_terms`, `machines`, `machine_specs`, `machine_images`, `files` |
| availability | `manufacturer_availability_preferences` |
| bookings | `manufacturer_booking_requests` (+ `manufacturer_booking_request_events` via trigger) |
| roles | `marketplace_role_selections` (persona ids mapped, e.g. `visionary` -> `demand_requester`) |

After "Continue" with Manufacturer selected, the frontend goes to the dashboard
when `manufacturerAccountExists` is true, otherwise to the details form (shown only once).

## Profile updates (`PATCH /manufacturer/profile`)

The body has the same shape as `ProfileWizardData`, but contains **only the
fields the user changed**:

| In the request | Effect in the database |
| --- | --- |
| Field absent | Unchanged (existing value or `NULL` stays) |
| Field with a value | Saved: replaces the old value, or a `NULL` |
| Field `""` or `null` | The user cleared it: set to `NULL` (lists: emptied) |
| `company.name` = `""` | Ignored: the company name is required |
| `company.logo` / `cover` = `data:image/...` | New image uploaded (identical images reused) |
| `company.logo` / `cover` = existing `https://` URL | Image unchanged |
| Invalid year / employee count / map pin | 422, nothing is changed |
| `certifications`, `faqs`, `location.serviceableAreas` | Sent whole when changed; replace the list |

The record is found from the Clerk user's manufacturer organization and updated
in place (no duplicates). The response is the full record read back from the
database after saving, in the same snapshot format as `GET /manufacturer/bootstrap`.

Example - user fills an empty "Vision" field and changes the city:

```json
PATCH /api/v1/manufacturer/profile
{ "company": { "vision": "Quality first" }, "location": { "city": "Chengalpattu" } }
```

## Step-by-step saving (all multi-step forms)

Every "Save & Next" is saved before the wizard moves on. Each step request
carries the changed fields plus:

```json
"progress": { "step": 2, "completed": true, "nextStep": 3 }
```

| Button | `completed` | Data sent |
| --- | --- | --- |
| Save & Next / Get started / Finish | `true` (step validated, server re-checks) | changed fields |
| Skip | `false` | none (position only) |
| Previous / closing the wizard | `false` | changed fields (kept, not marked done) |

Progress is stored in `manufacturer_form_progress` (one row per form instance:
the company profile, each machinery draft) with `current_step`,
`completed_steps` and `status` (`draft` / `completed`). The snapshot returns:

- `profileProgress`: `{status, currentStep, completedSteps, resumeStep, percentage, checklist}`,
  where `percentage` and `checklist` are computed from the saved data (dashboard).
- `machineryDraft`: the unfinished machinery wizard (`{id, data, currentStep,
  completedSteps, resumeStep}`) or `null`. Unfinished drafts are not listings.

Duplicates are prevented by: one progress row per form instance (unique key);
`clientKey` on the first machinery save (a repeated request returns the same
draft); a per-user lock on first sign-in; disabled buttons while saving.
A step that fails validation returns 422 and saves nothing from that request.

## Onboarding prefill (Manufacturer account form)

`GET /manufacturer/bootstrap` also returns the signed-in user's saved record:

```json
"user": { "firstName": "Jordan", "lastName": "Lee", "email": "jordan@example.com" }
```

- Stored when the user signs up (Clerk `user.created` webhook) or on their first
  API call; if the record has no name yet, it is copied from Clerk once.
- The onboarding form opens with First name, Last name and Email filled in.
- `POST /manufacturer/account` (same body as before):
  - names unchanged -> the saved record is not rewritten;
  - names edited -> `users.first_name/last_name` updated, and the new name is
    also sent to Clerk so its `user.updated` webhook can't restore the old one;
  - the form's email is saved as the manufacturer contact email
    (`organization_profiles.contact_email`); `users.email` stays the Clerk
    sign-in email.
- The user is identified by the Clerk user id; repeated or simultaneous
  submits update the same rows (per-user lock) - no duplicates.

## Admin Dashboard (`/api/v1/admin/...`)

Every endpoint needs `Authorization: Bearer <token>` of a user with an active platform role:
either a Clerk session token (X!Y account) or an admin session token `xya_...` from
`POST /admin/auth/login` (admin account). Others get 401 (not signed in / session ended) or
403 (not an admin / suspended). Screens live at `/admin`; sign-in at `/admin/login`.

| Sign-in | Method + path | Notes |
| --- | --- | --- |
| Admin account | `POST /admin/auth/login` `{email, password}` | 200 `{token, expiresAt, idleMinutes}`; 401 "Incorrect email or password."; 429 locked (Retry-After); 403 disabled/suspended |
| Sign out | `POST /admin/auth/logout` | ends that admin session (204) |
| Change password | `POST /admin/auth/change-password` `{current_password, new_password}` | admin-account sessions only; signs out other devices |

| Screen / ticket | Method + path | Notes |
| --- | --- | --- |
| Access (01) | `GET /admin/me` | 200 `{id,name,email,roles,authMethod}` or 401/403 |
| Overview (02) | `GET /admin/overview` | cards (real records only) + recent / updated / needs-attention lists |
| Users (03) | `GET /admin/users?q=&account_status=&onboarding_status=&page=` | onboarding_status also `NO_PROFILE` |
| User detail + troubleshooting (03/10) | `GET /admin/users/{id}` | last login, last save, last section, recent failed operations with error reference |
| Suspend / reactivate (03) | `POST /admin/users/{id}/suspend` · `/reactivate` `{reason}` | blocks the API + bans in Clerk |
| Manufacturer list (04) | `GET /admin/manufacturers?q=&industry=&process=&location=&completeness=&review_status=&record_type=&entry_source=&archived=&assigned=&sort=&page=` | list filters repeat (`record_type=DEMO&record_type=TEST`); archived hidden by default |
| Detail (05) | `GET /admin/manufacturers/{id}` | profile, contacts, linked users, notes, history, timeline, required fields |
| Edit a response (06) | `PATCH /admin/manufacturers/{id}/fields` `{field, value, reason}` | same validation as onboarding; history keeps old/new value, admin, time, reason |
| Review / classification (07/08) | `PATCH /admin/manufacturers/{id}/admin-fields` `{review_status?, assigned_admin_id?, unassign?, record_type?, entry_source?, referral_source?, reason?}` | NEEDS_CORRECTION requires `reason` (also saved as a note) |
| Queue (07) | `GET /admin/review-queue?q=&review_status=&assigned=me|unassigned&include_test=` | Submitted first; Reviewed hidden unless filtered |
| Notes (07) | `POST /admin/manufacturers/{id}/notes` `{note}` | |
| Archive (04/08) | `POST /admin/manufacturers/{id}/archive` · `/restore` `{reason?}`; `POST /admin/manufacturers/archive-batch` `{ids, reason?}` | batch archives DEMO/TEST only |
| Analytics (09) | `GET /admin/analytics?from=YYYY-MM-DD&to=&include_test=` | DEMO/TEST excluded by default |
| Support (10) | `GET /admin/support/recent-errors` | latest 25 failed operations |

Editable `field` keys: `company.*`, `location.*`, `infra.*`, `certifications`, `faqs`,
`account.companyType`, `account.country`, `account.capacity`, `contact.email`,
`contact.phone`, `machinery.{listingId}.{key}`.
