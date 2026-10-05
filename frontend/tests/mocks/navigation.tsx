// Test stand-in for next/navigation: records navigation; the test changes the pathname.
import { useSyncExternalStore } from "react";
const listeners = new Set<() => void>();
export const nav = {
  pathname: "/manufacturer",
  pushed: [] as string[],
  replaced: [] as string[],
  go(path: string) { nav.pathname = path; listeners.forEach((l) => l()); },
};
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export function usePathname() { return useSyncExternalStore(subscribe, () => nav.pathname); }
export function useRouter() {
  return {
    push: (p: string) => { nav.pushed.push(p); },
    replace: (p: string) => { nav.replaced.push(p); },
  };
}
