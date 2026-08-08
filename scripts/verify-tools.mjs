// Real verification: runs the actual content.js against a real DOM (jsdom) and
// proves the action tools (read/click/type/extract) truly mutate the page —
// not just display. Also tests the side-panel markdown renderer.
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0, fail = 0;
const ok = (name, cond) => (cond ? (pass++, console.log(`  ✅ ${name}`)) : (fail++, console.log(`  ❌ ${name}`)));

// ---- 1. Content script action tools on a real DOM ---------------------------
console.log("\n[1] content.js — real DOM actions");

const dom = new JSDOM(
  `<!DOCTYPE html><html><body>
     <h1>Test Page</h1>
     <button id="b" onclick="window.__clicked=true">Login</button>
     <input id="i" type="text" placeholder="Search" />
     <a href="https://example.com/x">Example Link</a>
     <table><tr><th>Name</th><th>Age</th></tr><tr><td>Ali</td><td>30</td></tr></table>
   </body></html>`,
  { url: "https://test.local/", runScripts: "outside-only", pretendToBeVisual: true }
);
const { window } = dom;

// make layout-based visibility pass in jsdom (no real layout engine)
window.Element.prototype.getBoundingClientRect = function () {
  return { width: 120, height: 24, top: 10, left: 10, bottom: 34, right: 130, x: 10, y: 10 };
};
// jsdom doesn't implement scrollIntoView (real browsers do) — stub it
window.Element.prototype.scrollIntoView = function () {};
// jsdom "outside-only" won't run inline onclick — attach the handler from the test
window.document.getElementById("b").addEventListener("click", () => (window.__clicked = true));
const realGCS = window.getComputedStyle.bind(window);
window.getComputedStyle = (el) => {
  const s = realGCS(el);
  return new Proxy(s, { get: (t, p) => (p === "display" ? "block" : p === "visibility" ? "visible" : p === "opacity" ? "1" : t[p]) });
};

// shim the extension runtime and capture the message handler content.js registers
let handler = null;
const chromeShim = {
  runtime: { onMessage: { addListener: (fn) => (handler = fn) } },
};
window.chrome = chromeShim;
globalThis.chrome = chromeShim;
globalThis.browser = undefined;
globalThis.window = window;
globalThis.document = window.document;
globalThis.CSS = window.CSS;
globalThis.location = window.location;
for (const k of ["Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "HTMLInputElement", "HTMLTextAreaElement", "Node"]) globalThis[k] = window[k];

// load the REAL content.js into this context
const code = readFileSync(join(ROOT, "extension/content.js"), "utf8");
new Function(code)();
ok("content.js registered a message handler", typeof handler === "function");

const call = (msg) =>
  new Promise((resolve) => {
    const ret = handler(msg, {}, resolve);
    if (ret !== true) resolve(undefined);
  });

const state = await call({ type: "get_state" });
ok("get_state reads the page (finds button/input/link)", state.ok && /Login/.test(state.state.elements) && state.state.elementCount >= 3);

// find the button's index from the element list
const btnIdx = state.state.elements.split("\n").findIndex((l) => /button.*Login/i.test(l));
const clickRes = await call({ type: "click", index: btnIdx });
ok("click actually fired the button's onclick handler", window.__clicked === true && clickRes.ok);

const inputIdx = state.state.elements.split("\n").findIndex((l) => /input.*Search/i.test(l));
await call({ type: "type_text", index: inputIdx, text: "hello world" });
ok("type_text actually set the input's value", window.document.getElementById("i").value === "hello world");

const extract = await call({ type: "get_extract" });
ok("extract_data pulled the real table + link", /Ali\t30/.test(extract.data.tables) && /example\.com/.test(extract.data.links));

// ---- 2. Side panel markdown renderer ----------------------------------------
console.log("\n[2] sidepanel — markdown renderer");
const sp = readFileSync(join(ROOT, "extension/sidepanel/sidepanel.js"), "utf8");
const startMd = sp.indexOf("function escapeHtml");
const endMd = sp.indexOf("function renderMessage");
const mdCode = sp.slice(startMd, endMd);
const dom2 = new JSDOM("<!DOCTYPE html><body></body>");
const renderMarkdown = new Function(
  "document",
  mdCode + "\nreturn renderMarkdown;"
)(dom2.window.document);
const md = renderMarkdown("# Title\n\n**bold** and `code`\n\n- a\n- b\n\n| X | Y |\n|---|---|\n| 1 | 2 |");
ok("markdown renders heading", /<h1>Title<\/h1>/.test(md));
ok("markdown renders bold + inline code", /<strong>bold<\/strong>/.test(md) && /<code>code<\/code>/.test(md));
ok("markdown renders list", /<ul><li>a<\/li><li>b<\/li><\/ul>/.test(md));
ok("markdown renders table", /<table>.*<td>1<\/td><td>2<\/td>/s.test(md));

console.log(`\n───────────────\nRESULT: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
