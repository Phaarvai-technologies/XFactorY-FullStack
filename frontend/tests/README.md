# Frontend tests (Vitest)

Component tests run in jsdom: no browser and no backend needed. Clerk and Next.js navigation are
replaced by the stand-ins in `tests/mocks/` (set up in `vitest.config.ts`).

```bash
npm install          # vitest, jsdom and Testing Library are devDependencies
npm test             # all component tests, once
npm run test:watch   # re-run on save
```

Expected: `Test Files 3 passed`, `Tests 29 passed`.

| File | Covers |
|---|---|
| `wizard-steps.test.tsx` (17) | `ProfileWizard`, `MachineryWizard` and the availability form: moves only after a successful save, blocks double submits, validates before saving, Skip/Previous, resume step, publish, typed-but-not-added areas and certifications are saved, Machine Name lists the manufacturer's own machinery |
| `manufacturer-entry.test.tsx` (7) | Opening the Manufacturer portal: an existing account goes straight to the dashboard in one load and never shows "Join Our Ecosystem"; no account shows Join; loading indicator; retry right after sign-in; account menu (Manage account / Sign out). Uses a real `GET /manufacturer/bootstrap` response (`fixtures/`) |
| `manufacturer-notifications.test.tsx` (5) | Dashboard bell: popup on arrival, "Open notifications" shows the correction note, shared notes and admin edits and marks them read, "Later" only hides the popup, empty state, bad server answer |

## Live tests (optional, real backend)

`tests/live/` drives the real screens against a backend on `http://localhost:8000` with a **test**
database (they add an admin and notifications). Each suite is skipped unless its variables are set.

```powershell
# PowerShell, backend running with the test database
$env:ADMIN_TEST_PASSWORD = "<admin@phaarvai.com password on the test database>"
$env:MFR_TOKEN = "<Clerk session token of a manufacturer whose company name contains Kaveri>"
npm run test:live
```

| File | Needs | Covers |
|---|---|---|
| `live/admins-live.test.tsx` (4) | `ADMIN_TEST_PASSWORD` | Admins tab: built-in admin, add admin with a temporary password, admins not in Users, forced password change, revoke and restore |
| `live/notifications-live.test.tsx` (3) | `ADMIN_TEST_PASSWORD`, `MFR_TOKEN` | Admin sets Needs correction and shares a note; the manufacturer's bell shows both, never the private note; no popup on the next visit |
