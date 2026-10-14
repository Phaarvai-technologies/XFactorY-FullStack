// Test stand-in for @clerk/nextjs/server (proxy tests). The test sets `serverAuth`.
type Handler = (auth: AuthFn, request: Request) => Promise<Response | void> | Response | void;
type AuthFn = (() => Promise<{ userId: string | null; getToken: () => Promise<string | null> }>) & {
  protect: () => Promise<void>;
};

type ServerAuthState = { userId: string | null; token: string | null; protected: string[] };
// Kept on globalThis so tests that reset modules still share one state object.
const store = globalThis as { __xyServerAuth?: ServerAuthState };
export const serverAuth: ServerAuthState = (store.__xyServerAuth ??= {
  userId: null,
  token: "server-token",
  protected: [],
});

export function createRouteMatcher(patterns: string[]) {
  const regexes = patterns.map((p) => new RegExp(`^${p}$`));
  return (request: { nextUrl: { pathname: string } }) => regexes.some((r) => r.test(request.nextUrl.pathname));
}

export function clerkMiddleware(handler: Handler) {
  return async (request: Request & { nextUrl: URL }) => {
    const auth = (async () => ({ userId: serverAuth.userId, getToken: async () => serverAuth.token })) as AuthFn;
    auth.protect = async () => {
      serverAuth.protected.push(request.nextUrl.pathname);
    };
    return handler(auth, request);
  };
}

export function clerkFrontendApiProxy() {
  return new Response(null, { status: 204 });
}

export async function auth() {
  return { userId: serverAuth.userId, getToken: async () => serverAuth.token };
}
