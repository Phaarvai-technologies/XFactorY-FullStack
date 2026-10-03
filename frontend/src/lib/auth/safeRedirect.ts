/**
 * Where to send the user after signing in / up. Only addresses on THIS site are allowed:
 * a path ("/manufacturer/dashboard") or a full URL with the same origin (Clerk sends
 * those, e.g. "http://localhost:3000/manufacturer/dashboard"). Anything else, such as
 * "https://evil.com", "//evil.com", "/\evil.com" or "javascript:...", returns null
 * (callers then use "/"), so a crafted ?redirect_url= link cannot send users to a
 * fake site after they sign in.
 */
export function safeRedirectPath(raw: string | string[] | null | undefined, origin: string): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  // Backslashes and control characters are read as "/" or dropped by browsers: refuse them.
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || (url.protocol !== "http:" && url.protocol !== "https:")) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** The origin of the current request (server components) from the proxy headers. */
export function requestOrigin(headers: { get(name: string): string | null }): string {
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost:3000";
  const proto = headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
}
