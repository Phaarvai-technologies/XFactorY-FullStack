// Test stand-in for @clerk/nextjs/legacy. Auth tests replace it with vi.mock factories.
export function useSignIn() {
  return { isLoaded: false, signIn: undefined, setActive: undefined };
}
export function useSignUp() {
  return { isLoaded: false, signUp: undefined, setActive: undefined };
}
