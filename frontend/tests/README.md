# Wizard step-saving tests

Renders the real `ProfileWizard` and `MachineryWizard` in jsdom with a fake
backend and checks: moving only after a successful save, no double submits,
validation before saving, Skip/Previous behaviour, resume step, Publish.

```bash
# from the frontend folder (tools are installed without touching package.json)
npm install --no-save esbuild@0.25 jsdom@26 @testing-library/react@16 @testing-library/dom@10
npx esbuild tests/wizard-steps.test.tsx --bundle --platform=node --outfile=tests/.out.js \
  --jsx=automatic --alias:@=./src --alias:react=./node_modules/react \
  --alias:react-dom=./node_modules/react-dom --external:jsdom
node tests/.out.js      # expected: 13/13 component tests passed
```
