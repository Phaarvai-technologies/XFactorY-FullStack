// Run from the frontend folder:  node check-clerk.js
// Shows which Clerk settings Next.js really uses and tests them against Clerk. Prints no secrets.
const { loadEnvConfig } = require("@next/env");
const env = loadEnvConfig(process.cwd(), true, { info() {}, error() {} }).combinedEnv;
const get = (k) => (process.env[k] ?? env[k] ?? "").trim();
const mask = (v) => (v ? v.slice(0, 12) + "…" + ` (${v.length} chars)` : "(not set)");

const pk = get("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
const sk = get("CLERK_SECRET_KEY");
console.log("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:", mask(pk));
console.log("CLERK_SECRET_KEY                 :", mask(sk));
for (const k of ["NEXT_PUBLIC_CLERK_PROXY_URL", "CLERK_PROXY_URL", "NEXT_PUBLIC_CLERK_DOMAIN", "CLERK_DOMAIN",
                 "NEXT_PUBLIC_CLERK_IS_SATELLITE", "NEXT_PUBLIC_CLERK_FRONTEND_API", "CLERK_FRONTEND_API"]) {
  const v = get(k);
  if (v) console.log(`!! ${k} = ${v}   <- remove this for local development`);
}

let host = "";
const m = /^pk_(test|live)_(.+)$/.exec(pk);
if (!m) console.log("!! Publishable key is missing or malformed (must start with pk_test_ or pk_live_).");
else {
  host = Buffer.from(m[2], "base64").toString("utf8").replace(/\$$/, "");
  console.log(`Publishable key -> Clerk host: ${host}  (${m[1] === "test" ? "development" : "production"} key)`);
  if (/[^a-z0-9.-]/i.test(host)) console.log("!! That host contains odd characters: the key was copied wrongly (extra text/quotes?).");
}
if (sk && !/^sk_(test|live)_/.test(sk)) console.log("!! Secret key must start with sk_test_ or sk_live_.");
if (m && sk && m[1] !== sk.slice(3, 7)) console.log("!! Publishable and secret key are from different environments (test vs live).");

(async () => {
  if (!host) return;
  try {
    const r = await fetch(`https://${host}/v1/environment`);
    const body = await r.text();
    console.log(`Clerk says about ${host}:`, r.ok ? "OK (valid instance)" : `${r.status} ${body.includes("host_invalid") ? "host_invalid -> this publishable key is wrong/old; copy it again from Clerk Dashboard -> API keys" : body.slice(0, 120)}`);
    if (!sk) return;
    const [a, b] = await Promise.all([
      fetch(`https://${host}/.well-known/jwks.json`).then((x) => x.json()),
      fetch("https://api.clerk.com/v1/jwks", { headers: { Authorization: `Bearer ${sk}` } }).then((x) => x.json()),
    ]);
    const ka = (a.keys || []).map((k) => k.kid), kb = (b.keys || []).map((k) => k.kid);
    if (!kb.length) console.log("!! Secret key rejected by Clerk -> copy it again from Clerk Dashboard -> API keys.");
    else console.log(ka.some((k) => kb.includes(k))
      ? "Publishable + secret key belong to the SAME Clerk app: OK"
      : "!! Publishable and secret key belong to DIFFERENT Clerk apps -> copy both from the same app's API keys page.");
  } catch (e) {
    console.log("Could not reach Clerk from this computer:", e.message);
  }
})();