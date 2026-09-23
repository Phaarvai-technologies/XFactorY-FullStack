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
- Profile wizard and calendar edits are batched (0.7 s) so rapid edits send one request;
  closing the wizard saves immediately.
- Bookings come from `manufacturer_booking_requests`; the four demo bookings in
  `INITIAL_BOOKINGS` are no longer shown. To load them as real rows, see
  `infra/supabase/sample_booking_requests.sql` / the backend README.

Set `NEXT_PUBLIC_API_URL` (default `http://localhost:8000/api/v1`).
