# Manufacturer backend integration

The UI is unchanged. Only the data layer of
`src/components/manufacturer/ManufacturerApp.tsx` talks to the FastAPI backend
and `src/components/onboarding/RoleSelection.tsx` talk to the FastAPI backend
(plus a small change in `AccountScreen.tsx` that re-enables the submit button if
account creation fails). The full endpoint list is in the backend's
`infrastructure/API_CONTRACT.md`.

- Dashboard load: `GET /manufacturer/bootstrap` fills the whole state. The
  dashboard stays blank (as it already does while Clerk loads) until the data arrives.
- Roles page: selected roles are loaded from and saved to the database
  (`/identity/me`), so they are still selected after sign-out or on another device.
  Continue with Manufacturer goes to the dashboard if the details were already
  saved, otherwise to the details form.
- The database (not sessionStorage) decides form vs dashboard: a saved account
  always opens the dashboard with its data; a new one always gets the form first.
- Account creation waits for the backend; everything else updates the screen
  immediately (same toasts as before) and saves in the background. On failure a
  toast explains what was not saved and machinery/bookings are re-read from the server.
- Profile wizard edits are saved with `PATCH /manufacturer/profile` containing only
  the fields that changed since the last save (`src/lib/manufacturer/profilePatch.ts`).
  Untouched fields are never sent, so they can't overwrite saved values; a field the
  user empties is sent as "" and cleared. The record the backend returns is applied
  to the page state straight away. A failed save keeps those fields pending and
  sends them again with the next save.
- Profile wizard and calendar edits are batched (0.7 s) so rapid edits send one request;
  closing the wizard saves immediately.
- Bookings come from `manufacturer_booking_requests`; the four demo bookings in
  `INITIAL_BOOKINGS` are no longer shown. To load them as real rows, see
  `infra/supabase/sample_booking_requests.sql` / the backend README.

Set `NEXT_PUBLIC_API_URL` (default `http://localhost:8000/api/v1`).

## Step-by-step saving

- ProfileWizard and MachineryWizard call `onSaveStep` on Save & Next, Skip and
  Previous; they move to the next step only when it resolves `true`. While a
  step is saving the footer buttons are disabled and show "Saving…".
- The first machinery "Save & Next" creates the draft (`POST /machinery/drafts`
  with a `clientKey`); later steps `PATCH /machinery/{id}`; Publish / Save as
  Draft finishes it. Opening "Add machinery" again continues an unfinished draft
  at its last incomplete step.
- The profile wizard opens at `profileProgress.resumeStep` from the backend; the
  dashboard checklist and percentage come from `profileProgress`.
- Recurring availability and capacity wait for their PATCH before closing /
  confirming; calendar clicks are batched into one PATCH of the calendar.
- Component tests: see `tests/README.md`.
