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
| Profile wizard edits (all 5 steps) | `PUT /manufacturer/profile` | `ProfileWizardData` (logo/cover as `data:` URL or existing URL) |
| Machinery wizard Publish / Save draft | `POST /manufacturer/machinery` (201) | `MachineryDraft` + `status: "Published" \| "Draft"` |
| Publish / Unpublish / Archive listing | `PATCH /manufacturer/machinery/{id}/status` | `{"status": "Draft\|Published\|Unpublished\|Archived"}` |
| Calendar day, recurring, capacity | `PUT /manufacturer/availability` | `{calendar, recurring, capacity}` |
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
