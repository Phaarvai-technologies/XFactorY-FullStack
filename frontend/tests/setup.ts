import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
const g = globalThis as any;
g.window = dom.window; g.document = dom.window.document; g.navigator = dom.window.navigator;
for (const k of Object.getOwnPropertyNames(dom.window)) if (!(k in g)) { try { g[k] = (dom.window as any)[k]; } catch {} }
g.IS_REACT_ACT_ENVIRONMENT = true;
