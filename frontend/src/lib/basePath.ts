/**
 * Where this app is served.
 *
 * Default (NEXT_PUBLIC_BASE_PATH empty): at the root of its own domain, e.g.
 * https://x-factor-y-full-stack-cwlx.vercel.app/ — nothing changes.
 *
 * NEXT_PUBLIC_BASE_PATH=/xfactory: inside the Phaarvai website at
 * https://phaarvai-website.vercel.app/xfactory (the website forwards /xfactory/... here).
 * Next.js adds the prefix to <Link>, router.push and its own files by itself; these helpers
 * cover the few places that build a URL by hand (Clerk redirects, images, CSS).
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim().replace(/\/+$/, "");

/** "/sso-callback" -> "/xfactory/sso-callback" (unchanged without a base path). */
export function withBase(path: string): string {
  if (!BASE_PATH || !path.startsWith("/") || path.startsWith("//")) return path;
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`) || path.startsWith(`${BASE_PATH}?`)) return path;
  return path === "/" ? BASE_PATH : `${BASE_PATH}${path}`;
}

/** "/xfactory/manufacturer" -> "/manufacturer": the form router.push expects. */
export function stripBase(path: string): string {
  if (!BASE_PATH) return path;
  if (path === BASE_PATH) return "/";
  if (path.startsWith(`${BASE_PATH}/`)) return path.slice(BASE_PATH.length);
  if (path.startsWith(`${BASE_PATH}?`) || path.startsWith(`${BASE_PATH}#`)) return `/${path.slice(BASE_PATH.length)}`;
  return path;
}
