# Frontend component tests

Two suites, rendered in jsdom (no browser, no real backend needed):

- `wizard-steps.test.tsx`: `ProfileWizard`, `MachineryWizard` and the availability form.
  Checks that it moves only after a successful save, blocks double submits, validates
  before saving, handles Skip/Previous, resumes at the right step and publishes.
  Also checks that typed-but-not-added serviceable areas and certifications are saved,
  and that the availability Machine Name lists the manufacturer's own machinery.
- `manufacturer-entry.test.tsx`: opening the Manufacturer portal.
  - An existing account goes straight to the dashboard with its saved data, in one load,
    and never shows "Join Our Ecosystem".
  - No account shows the Join page.
  - A loading indicator shows while the account is checked.
  - The check is retried right after sign-in.
  - The account menu on the dashboard name button opens, and Manage account / Sign out
    call Clerk.

  It uses a real `GET /manufacturer/bootstrap` response (`fixtures/`) and stand-ins for
  Clerk and Next.js navigation (`mocks/`).

```bash
# from the frontend folder (tools are installed without touching package.json)
npm install --no-save esbuild@0.25 jsdom@26 @testing-library/react@16 @testing-library/dom@10

npx esbuild tests/wizard-steps.test.tsx --bundle --platform=node --outfile=tests/.out.js \
  --jsx=automatic --alias:@=./src --alias:react=./node_modules/react \
  --alias:react-dom=./node_modules/react-dom --alias:@clerk/nextjs=./tests/mocks/clerk.tsx \
  --external:jsdom
node tests/.out.js      # expected: 17/17 component tests passed

npx esbuild tests/manufacturer-entry.test.tsx --bundle --platform=node --outfile=tests/.out.js \
  --jsx=automatic --alias:@=./src --alias:react=./node_modules/react \
  --alias:react-dom=./node_modules/react-dom --alias:@clerk/nextjs=./tests/mocks/clerk.tsx \
  --alias:next/navigation=./tests/mocks/navigation.tsx --external:jsdom
node tests/.out.js      # expected: 7/7 manufacturer entry tests passed
```

## Admins tab (live, optional)

`tests/live/admins-live.test.tsx` drives the real admin portal against a running backend
(test database only — it adds an admin). Set `ADMIN_TEST_PASSWORD` to the built-in
`admin@phaarvai.com` password on that database, then build and run it with the same esbuild
command as the other tests. Expected: `4/4 live admin tests passed`.

## Manufacturer notifications

- `tests/manufacturer-notifications.test.tsx` (no backend needed): popup on arrival, "Open notifications"
  shows the correction note, shared notes and admin edits and marks them read, "Later" only hides the popup.
  Expected: `5/5 notification tests passed`.
- `tests/live/notifications-live.test.tsx` (optional, real backend + test database): an admin sets
  Needs correction and shares a note; the manufacturer's bell shows both, never the private note.
