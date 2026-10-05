// Test stand-in for @clerk/nextjs (manufacturer-entry tests): the tests set the session.
export const session = {
  isLoaded: true,
  isSignedIn: true,
  userId: "user_test" as string | null,
  tokens: [] as (string | null)[], // tokens returned by getToken(), in order; then "token"
};
export function useAuth() {
  return {
    isLoaded: session.isLoaded,
    isSignedIn: session.isSignedIn,
    userId: session.isSignedIn ? session.userId : null,
    getToken: async () => (session.tokens.length ? session.tokens.shift() ?? null : "token"),
  };
}

// Signed-in user and Clerk actions used by the dashboard account menu.
export const clerkCalls: string[] = [];
export function useUser() {
  return {
    isLoaded: true,
    isSignedIn: session.isSignedIn,
    user: session.isSignedIn
      ? { fullName: "test user22", username: null, imageUrl: "", primaryEmailAddress: { emailAddress: "testuser22@example.com" } }
      : null,
  };
}
export function useClerk() {
  return {
    openUserProfile: () => { clerkCalls.push("openUserProfile"); },
    signOut: async (options?: { redirectUrl?: string }) => { clerkCalls.push(`signOut:${options?.redirectUrl ?? ""}`); },
  };
}
