import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
const g = globalThis as any;
g.window = dom.window; g.document = dom.window.document;
// Node 21+ defines a read-only global navigator; replace it with jsdom's.
Object.defineProperty(g, "navigator", { value: dom.window.navigator, configurable: true, writable: true });
for (const k of Object.getOwnPropertyNames(dom.window)) if (!(k in g)) { try { g[k] = (dom.window as any)[k]; } catch {} }
g.IS_REACT_ACT_ENVIRONMENT = true;
