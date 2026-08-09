// content.js — runs on every page/frame.
// Responsibilities:
//   1. Serialize the page into an indexed registry of interactive elements
//      (recursing same-origin iframes + open shadow roots) plus readable text.
//   2. Execute actions: click/type by index, click/type by pixel coordinates
//      (vision mode), scroll — with a visual highlight before acting.
// Only the TOP frame is addressed by the background (frameId 0); it drills into
// child frames itself.

(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  if (window.__geminiAgentContentLoaded) return;
  window.__geminiAgentContentLoaded = true;

  const MAX_ELEMENTS = 150;
  const MAX_TEXT = 6000;
  const MAX_LABEL = 120;

  const INTERACTIVE_SELECTOR = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "textarea",
    "select",
    "[role=button]",
    "[role=link]",
    "[role=textbox]",
    "[role=checkbox]",
    "[role=tab]",
    "[role=menuitem]",
    "[role=combobox]",
    "[contenteditable=true]",
    "[onclick]",
    "summary",
  ].join(",");

  let registry = []; // index -> element (may live in a subframe/shadow root)

  // ---- visibility & description --------------------------------------------

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const win = el.ownerDocument?.defaultView || window;
    const style = win.getComputedStyle(el);
    if (!style || style.display === "none" || style.visibility === "hidden" || style.opacity === "0")
      return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    return true;
  }

  function clean(str) {
    return (str || "").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
  }

  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    const type = el.getAttribute("type");
    let label =
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      el.getAttribute("alt") ||
      el.getAttribute("name") ||
      "";
    if (!label) {
      if (tag === "input" || tag === "textarea") label = el.value || "";
      else label = el.innerText || el.textContent || "";
    }
    label = clean(label);
    const kind = role || (type ? `${tag}:${type}` : tag);
    const href = tag === "a" && el.href ? ` -> ${el.href.slice(0, 80)}` : "";
    return `<${kind}> "${label}"${href}`;
  }

  // ---- page-state collection (recurses iframes + shadow roots) --------------

  function walk(root, lines) {
    let nodes;
    try {
      nodes = root.querySelectorAll(INTERACTIVE_SELECTOR);
    } catch (_) {
      return;
    }
    for (const el of nodes) {
      if (registry.length >= MAX_ELEMENTS) return;
      if (!isVisible(el)) continue;
      const idx = registry.length;
      registry.push(el);
      lines.push(`[${idx}] ${describe(el)}`);
      // open shadow root
      if (el.shadowRoot) walk(el.shadowRoot, lines);
    }
    // same-origin iframes
    let frames = [];
    try {
      frames = root.querySelectorAll("iframe, frame");
    } catch (_) {}
    for (const f of frames) {
      let idoc = null;
      try {
        idoc = f.contentDocument;
      } catch (_) {
        idoc = null; // cross-origin — cannot read
      }
      if (idoc && registry.length < MAX_ELEMENTS) walk(idoc, lines);
    }
  }

  function detectPageType() {
    const url = location.href;
    const textLen = (document.body?.innerText || "").length;
    const hasForms = document.querySelectorAll("input:not([type=hidden]), textarea, select").length > 0;
    const hasPassword = !!document.querySelector("input[type=password]");
    const title = document.title || "";
    const bodyText = (document.body?.innerText || "").slice(0, 2000);
    const hasLogin = hasPassword || /log\s?in|sign\s?in/i.test(title + " " + bodyText);
    const hasTables = document.querySelectorAll("table").length > 0;
    const hasLongText = textLen > 6000;
    let pageType = "generic";
    if (document.querySelector("video") || /youtube\.com|vimeo\.com|dailymotion\.com/i.test(url)) pageType = "video";
    else if (/[?&](q|query|search|s)=/i.test(url)) pageType = "search";
    else if (document.querySelector("article") || (document.querySelectorAll("p").length > 25 && hasLongText)) pageType = "article";
    else if (hasForms && document.querySelectorAll("input").length >= 4) pageType = "form";
    else if (hasTables && /dashboard|analytics|metrics|report/i.test(title + " " + url)) pageType = "dashboard";
    else if (/twitter\.com|x\.com|facebook\.com|instagram\.com|linkedin\.com|reddit\.com|tiktok\.com/i.test(url)) pageType = "social";
    return { hasForms, hasLogin, hasTables, hasLongText, pageType, textLen };
  }

  function collectState() {
    registry = [];
    const lines = [];
    walk(document, lines);

    let text = "";
    try {
      text = (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT);
    } catch (_) {}

    const analysis = detectPageType();
    return {
      url: location.href,
      title: document.title,
      scrollY: Math.round(window.scrollY),
      scrollHeight: Math.round(document.body?.scrollHeight || 0),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      elementCount: registry.length,
      elements: lines.join("\n"),
      text,
      pageType: analysis.pageType,
    };
  }

  function findByIndex(index) {
    return registry[index] || null;
  }

  // ---- deep elementFromPoint (drills into same-origin iframes + shadow) -----

  function deepElementFromPoint(x, y) {
    let doc = document;
    let el = doc.elementFromPoint(x, y);
    let guard = 0;
    while (el && guard++ < 20) {
      if (el.shadowRoot) {
        const inner = el.shadowRoot.elementFromPoint(x, y);
        if (inner && inner !== el) {
          el = inner;
          continue;
        }
      }
      if ((el.tagName === "IFRAME" || el.tagName === "FRAME")) {
        let idoc = null;
        try {
          idoc = el.contentDocument;
        } catch (_) {
          break; // cross-origin
        }
        if (idoc) {
          const r = el.getBoundingClientRect();
          const inner = idoc.elementFromPoint(x - r.left, y - r.top);
          if (inner) {
            x = x - r.left;
            y = y - r.top;
            el = inner;
            continue;
          }
        }
      }
      break;
    }
    return el;
  }

  // ---- highlight overlay ----------------------------------------------------

  // Compute an element's rect in the TOP viewport, accounting for frame offsets.
  function rectInTopViewport(el) {
    let rect = el.getBoundingClientRect();
    let win = el.ownerDocument?.defaultView;
    let left = rect.left,
      top = rect.top;
    let guard = 0;
    while (win && win !== window.top && guard++ < 10) {
      const fe = win.frameElement;
      if (!fe) break;
      const fr = fe.getBoundingClientRect();
      left += fr.left;
      top += fr.top;
      win = win.parent;
    }
    return { left, top, width: rect.width, height: rect.height };
  }

  // ---- screenshot annotations ------------------------------------------------
  // Returns viewport coordinates of all visible interactive elements for
  // overlaying numbered labels on captured screenshots.
  function getElementAnnotations() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const items = [];
    for (let i = 0; i < registry.length; i++) {
      const el = registry[i];
      if (!el || !el.getBoundingClientRect) continue;
      const r = rectInTopViewport(el);
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      if (cx < 0 || cy < 0 || cx > vw || cy > vh) continue;
      items.push({ index: i, x: cx, y: cy, rect: { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } });
    }
    return items;
  }

  function flash(box) {
    const div = document.createElement("div");
    Object.assign(div.style, {
      position: "fixed",
      left: box.left + "px",
      top: box.top + "px",
      width: box.width + "px",
      height: box.height + "px",
      border: "2px solid #da7756",
      background: "rgba(218,119,86,0.15)",
      borderRadius: "6px",
      zIndex: "2147483646",
      pointerEvents: "none",
      boxShadow: "0 0 0 3px rgba(218,119,86,0.18)",
      transition: "opacity 0.4s ease",
    });
    document.documentElement.appendChild(div);
    setTimeout(() => (div.style.opacity = "0"), 250);
    setTimeout(() => div.remove(), 650);
  }

  function highlightElement(el) {
    try {
      const r = rectInTopViewport(el);
      flash(r);
      moveCursor(r.left + r.width / 2, r.top + r.height / 2);
    } catch (_) {}
  }

  function highlightPoint(x, y) {
    flash({ left: x - 14, top: y - 14, width: 28, height: 28 });
    moveCursor(x, y);
  }

  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- animated agent cursor ------------------------------------------------

  let cursorEl = null;
  let cursorX = -100;
  let cursorY = -100;
  function ensureCursor() {
    if (cursorEl && document.documentElement.contains(cursorEl)) return cursorEl;
    cursorEl = document.createElement("div");
    Object.assign(cursorEl.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "22px",
      height: "22px",
      background: "#ffffff",
      clipPath: "polygon(0 0, 0 78%, 24% 60%, 42% 100%, 56% 93%, 39% 55%, 72% 55%)",
      filter: "drop-shadow(0 0 1px rgba(0,0,0,0.75)) drop-shadow(0 3px 6px rgba(0,0,0,0.35))",
      zIndex: "2147483647",
      pointerEvents: "none",
      transformOrigin: "top left",
      transform: "translate(-100px,-100px)",
      transition: "transform 0.5s cubic-bezier(0.16,1,0.3,1)",
    });
    document.documentElement.appendChild(cursorEl);
    return cursorEl;
  }
  function moveCursor(x, y) {
    try {
      cursorX = x;
      cursorY = y;
      const c = ensureCursor();
      c.style.transform = `translate(${x - 3}px, ${y - 2}px) scale(1)`;
    } catch (_) {}
  }
  function cursorPress() {
    if (!cursorEl) return;
    cursorEl.style.transform = `translate(${cursorX - 3}px, ${cursorY - 2}px) scale(0.82)`;
    setTimeout(() => {
      if (cursorEl) cursorEl.style.transform = `translate(${cursorX - 3}px, ${cursorY - 2}px) scale(1)`;
    }, 130);
    // expanding ripple ring at the click point
    try {
      const ring = document.createElement("div");
      Object.assign(ring.style, {
        position: "fixed",
        left: cursorX + "px",
        top: cursorY + "px",
        width: "10px",
        height: "10px",
        marginLeft: "-5px",
        marginTop: "-5px",
        borderRadius: "50%",
        border: "2px solid rgba(218,119,86,0.9)",
        zIndex: "2147483646",
        pointerEvents: "none",
        transition: "transform 0.45s ease-out, opacity 0.45s ease-out",
      });
      document.documentElement.appendChild(ring);
      requestAnimationFrame(() => {
        ring.style.transform = "scale(3.2)";
        ring.style.opacity = "0";
      });
      setTimeout(() => ring.remove(), 480);
    } catch (_) {}
  }

  // ---- drag (for canvas UIs like n8n) ---------------------------------------

  function pointerAt(el, type, x, y) {
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 1 };
    try {
      el.dispatchEvent(new PointerEvent(type, opts));
    } catch (_) {}
    const mouseType = { pointerdown: "mousedown", pointermove: "mousemove", pointerup: "mouseup" }[type];
    if (mouseType) el.dispatchEvent(new MouseEvent(mouseType, opts));
  }

  async function doDrag(fromX, fromY, toX, toY) {
    const startEl = deepElementFromPoint(fromX, fromY) || document.body;
    moveCursor(fromX, fromY);
    await pause(300);
    pointerAt(startEl, "pointerdown", fromX, fromY);
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const x = fromX + ((toX - fromX) * i) / steps;
      const y = fromY + ((toY - fromY) * i) / steps;
      const overEl = deepElementFromPoint(x, y) || startEl;
      pointerAt(overEl, "pointermove", x, y);
      moveCursor(x, y);
      await pause(25);
    }
    const endEl = deepElementFromPoint(toX, toY) || startEl;
    pointerAt(endEl, "pointerup", toX, toY);
    return { ok: true, message: `Dragged from (${fromX},${fromY}) to (${toX},${toY})` };
  }

  // ---- structured extraction ------------------------------------------------

  function extractData() {
    const txt = (el) => clean(el.innerText || el.textContent || "");
    const tables = [];
    document.querySelectorAll("table").forEach((tbl, i) => {
      if (i >= 10) return;
      const rows = [];
      tbl.querySelectorAll("tr").forEach((tr) => {
        const cells = [...tr.querySelectorAll("th,td")].map((c) => txt(c).replace(/\t/g, " "));
        if (cells.length) rows.push(cells.join("\t"));
      });
      if (rows.length) tables.push(`Table ${i + 1}:\n${rows.slice(0, 50).join("\n")}`);
    });
    const links = [];
    document.querySelectorAll("a[href]").forEach((a, i) => {
      if (i >= 60) return;
      const t = txt(a);
      if (t) links.push(`${t} -> ${a.href}`);
    });
    const lists = [];
    document.querySelectorAll("ul,ol").forEach((l, i) => {
      if (i >= 8) return;
      const items = [...l.querySelectorAll("li")].slice(0, 30).map((li) => "• " + txt(li)).filter((s) => s.length > 2);
      if (items.length) lists.push(items.join("\n"));
    });
    return {
      tables: tables.join("\n\n") || "(no tables)",
      lists: lists.join("\n\n") || "(no lists)",
      links: links.join("\n") || "(no links)",
    };
  }

  // ---- input synthesis ------------------------------------------------------

  function fireInput(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setValue(el, text) {
    try { window.__glideAgentAction = true; } catch (_) {}
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, text);
    else el.value = text;
    fireInput(el);
    setTimeout(() => { try { window.__glideAgentAction = false; } catch (_) {} }, 50);
  }

  function pressEnter(el) {
    for (const type of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(
        new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })
      );
    }
    const form = el.closest && el.closest("form");
    if (form && typeof form.requestSubmit === "function") {
      try {
        form.requestSubmit();
      } catch (_) {}
    }
  }

  function synthClick(el, x, y) {
    try { window.__glideAgentAction = true; }
    catch (_) {}
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
    try {
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
    } catch (_) {}
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    try {
      el.dispatchEvent(new PointerEvent("pointerup", opts));
    } catch (_) {}
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
    if (typeof el.click === "function") el.click();
    cursorPress();
    setTimeout(() => { try { window.__glideAgentAction = false; } catch (_) {} }, 50);
  }

  function typeInto(el, text, submit) {
    el.focus();
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea") {
      setValue(el, text);
    } else if (el.isContentEditable) {
      el.textContent = text;
      fireInput(el);
    } else {
      return false;
    }
    if (submit) pressEnter(el);
    return true;
  }

  // ---- action handlers ------------------------------------------------------

  function safeScrollIntoView(el, opts) {
    try {
      if (typeof el.scrollIntoView === "function") el.scrollIntoView(opts);
    } catch (_) {}
  }

  async function doClick(index) {
    const el = findByIndex(index);
    if (!el) return { ok: false, error: `No element with index ${index}. Call get_page_state to refresh indices.` };
    safeScrollIntoView(el, { block: "center", inline: "center" });
    highlightElement(el);
    await pause(350);
    const r = el.getBoundingClientRect();
    synthClick(el, r.left + r.width / 2, r.top + r.height / 2);
    return { ok: true, message: `Clicked [${index}] ${describe(el)}` };
  }

  // Find the closest interactive element from the registry near (x, y).
  function findNearestElement(x, y, maxDist = 80) {
    let best = null, bestDist = Infinity;
    for (const el of registry) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.hypot(cx - x, cy - y);
      if (d < bestDist) { bestDist = d; best = el; }
    }
    return bestDist <= maxDist ? best : null;
  }

  // Find element by text content — searches visible text on the page.
  function findElementByText(searchText) {
    const query = searchText.toLowerCase().trim();
    if (!query) return null;
    // First try registry elements (interactive)
    for (let i = 0; i < registry.length; i++) {
      const el = registry[i];
      const text = (el.innerText || el.textContent || el.value || el.getAttribute("aria-label") || "").toLowerCase();
      if (text.includes(query)) return { el, index: i, source: "registry" };
    }
    // Then try all visible elements with text
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.textContent && node.textContent.toLowerCase().includes(query)) {
        const el = node.parentElement;
        if (el && isVisible(el)) {
          const idx = registry.indexOf(el);
          return { el, index: idx >= 0 ? idx : -1, source: "text" };
        }
      }
    }
    return null;
  }

  async function doClickAt(x, y) {
    // Clamp coordinates to visible viewport
    const vw = window.innerWidth, vh = window.innerHeight;
    x = Math.max(0, Math.min(Math.round(x), vw));
    y = Math.max(0, Math.min(Math.round(y), vh));

    highlightPoint(x, y);
    await pause(350);

    // 1) Try exact hit at coordinates
    let el = deepElementFromPoint(x, y);
    let method = "exact";

    // 2) If no element or hit a non-interactive wrapper, expand search
    if (!el || (!el.closest(INTERACTIVE_SELECTOR) && el.tagName !== "A" && el.tagName !== "BUTTON")) {
      const nearby = findNearestElement(x, y, 80);
      if (nearby) { el = nearby; method = "nearest-80"; }
    }

    // 3) Broader fallback — 150px radius
    if (!el) {
      el = findNearestElement(x, y, 150);
      method = "nearest-150";
    }

    // 4) Try finding any clickable element in the general area (250px)
    if (!el) {
      el = findNearestElement(x, y, 250);
      method = "area-250";
    }

    // 5) Last resort — find ANY visible interactive element on the page
    if (!el && registry.length > 0) {
      // Find the element closest to the center of the viewport
      const cx = vw / 2, cy = vh / 2;
      el = findNearestElement(cx, cy, Infinity);
      method = "viewport-center";
    }

    if (!el) return { ok: false, error: `No element found near (${x}, ${y}). Try click_text() or click(index) instead.` };

    // AUTO-RETRY: If we hit a generic div/container on a canvas UI, try text search
    const desc = describe(el).toLowerCase();
    const isGeneric = el.tagName === "DIV" || el.tagName === "SPAN" || el.tagName === "MAIN";
    const isCanvasUI = document.querySelector("canvas") || document.querySelector("[data-testid]") ||
      /n8n|figma|draw\.io|miro|excalidraw/i.test(location.href);
    if (isGeneric && isCanvasUI && method !== "text-search") {
      // Don't click generic divs on canvas UIs — they're usually wrong
      return { ok: false, error: `Hit a generic ${el.tagName} on a canvas UI — coordinates are unreliable here. Use click_text("label") instead.`, suggestion: "use_click_text" };
    }

    synthClick(el, x, y);
    return { ok: true, message: `Clicked at (${x}, ${y}) [${method}] → ${describe(el)}` };
  }

  async function doType(index, text, submit) {
    const el = findByIndex(index);
    if (!el) return { ok: false, error: `No element with index ${index}. Call get_page_state to refresh indices.` };
    safeScrollIntoView(el, { block: "center" });
    highlightElement(el);
    await pause(300);
    if (!typeInto(el, text, submit)) return { ok: false, error: `Element [${index}] is not typable.` };
    return { ok: true, message: `Typed "${clean(text)}" into [${index}]${submit ? " and submitted" : ""}` };
  }

  async function doTypeAt(x, y, text, submit) {
    const vw = window.innerWidth, vh = window.innerHeight;
    x = Math.max(0, Math.min(Math.round(x), vw));
    y = Math.max(0, Math.min(Math.round(y), vh));

    highlightPoint(x, y);
    await pause(300);

    let el = deepElementFromPoint(x, y);
    if (!el || (!el.closest(INTERACTIVE_SELECTOR) && el.tagName !== "A" && el.tagName !== "BUTTON")) {
      const nearby = findNearestElement(x, y, 60);
      if (nearby) el = nearby;
    }
    if (!el) el = findNearestElement(x, y, 120);
    if (!el) return { ok: false, error: `No typable element found near (${x}, ${y}). Try get_page_state and use type_text(index) instead.` };
    synthClick(el, x, y);
    if (!typeInto(el, text, submit)) return { ok: false, error: `Element near (${x}, ${y}) is not typable.` };
    return { ok: true, message: `Typed "${clean(text)}" at (${x}, ${y})${submit ? " and submitted" : ""}` };
  }

  function doScroll(direction, pixels) {
    const amount = pixels || Math.round((window.innerHeight || 600) * 0.8);
    const dy = direction === "up" ? -amount : amount;
    window.scrollBy({ top: dy, behavior: "auto" });
    return { ok: true, message: `Scrolled ${direction} by ${Math.abs(dy)}px (now at y=${Math.round(window.scrollY)})` };
  }

  // ---- element picker (point-to-target) -------------------------------------

  function startPick(sendResponse) {
    const box = document.createElement("div");
    Object.assign(box.style, {
      position: "fixed",
      border: "2px solid #da7756",
      background: "rgba(218,119,86,0.15)",
      borderRadius: "3px",
      zIndex: "2147483647",
      pointerEvents: "none",
      transition: "all 0.05s",
    });
    const banner = document.createElement("div");
    banner.textContent = "🖐️ Click an element to pick it · Esc to cancel";
    Object.assign(banner.style, {
      position: "fixed",
      top: "12px",
      left: "50%",
      transform: "translateX(-50%)",
      background: "#14161e",
      color: "#edeef3",
      padding: "7px 14px",
      borderRadius: "10px",
      font: "13px -apple-system, sans-serif",
      zIndex: "2147483647",
      pointerEvents: "none",
      boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
    });
    document.documentElement.append(box, banner);

    let current = null;
    const onMove = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === box) return;
      current = el;
      const r = el.getBoundingClientRect();
      Object.assign(box.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    };
    const cleanup = () => {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey, true);
      box.remove();
      banner.remove();
    };
    const onClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = current || document.elementFromPoint(e.clientX, e.clientY);
      cleanup();
      if (!el) return sendResponse({ ok: false });
      sendResponse({ ok: true, desc: describe(el), label: clean(el.innerText || el.value || el.getAttribute("aria-label") || ""), kind: el.tagName.toLowerCase() });
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        cleanup();
        sendResponse({ ok: false, cancelled: true });
      }
    };
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey, true);
  }

  // ---- power tools: run JS, clipboard, keyboard -----------------------------

  function serializeResult(v) {
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    if (typeof v === "string") return v.slice(0, 6000);
    try {
      const s = JSON.stringify(v);
      return (s ?? String(v)).slice(0, 6000);
    } catch (_) {
      return String(v).slice(0, 6000);
    }
  }
  // Runs arbitrary JS in the content-script world: full DOM access, immune to the
  // page's CSP (isolated world). Supports async (returned promises are awaited).
  async function doExecuteJs(code) {
    try {
      const fn = new Function("return (async () => {" + code + "})()");
      const result = await fn();
      return { ok: true, result: serializeResult(result) };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }

  async function doReadClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      return { ok: true, message: `Clipboard: ${clean(text).slice(0, 200)}`, text };
    } catch (err) {
      return { ok: false, error: `Could not read clipboard: ${String(err?.message || err)}` };
    }
  }
  async function doWriteClipboard(text) {
    try {
      await navigator.clipboard.writeText(text || "");
      return { ok: true, message: `Copied to clipboard: "${clean(text).slice(0, 80)}"` };
    } catch (_) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text || "";
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        return { ok: true, message: `Copied to clipboard (fallback).` };
      } catch (err) {
        return { ok: false, error: `Could not write clipboard: ${String(err?.message || err)}` };
      }
    }
  }

  function doPressKeys(combo) {
    const parts = String(combo || "").split("+").map((s) => s.trim());
    const key = parts[parts.length - 1];
    const mods = parts.slice(0, -1).map((m) => m.toLowerCase());
    const opts = {
      key,
      code: key.length === 1 ? "Key" + key.toUpperCase() : key,
      bubbles: true,
      cancelable: true,
      ctrlKey: mods.includes("ctrl") || mods.includes("control"),
      metaKey: mods.includes("cmd") || mods.includes("meta"),
      shiftKey: mods.includes("shift"),
      altKey: mods.includes("alt"),
    };
    const el = document.activeElement || document.body;
    for (const type of ["keydown", "keypress", "keyup"]) el.dispatchEvent(new KeyboardEvent(type, opts));
    return { ok: true, message: `Pressed ${combo}` };
  }

  // ---- smart form filling ----------------------------------------------------

  const FIELD_ALIASES = {
    email: ["email", "e-mail", "emailaddress", "mail", "user-email"],
    phone: ["phone", "tel", "telephone", "mobile", "cell", "phone-number", "contact"],
    firstName: ["first-name", "firstname", "fname", "given-name", "your-name"],
    lastName: ["last-name", "lastname", "lname", "surname", "family-name"],
    name: ["name", "fullname", "full-name", "customer-name", "your-name"],
    address: ["address", "street", "street-address", "addr", "address1", "address-line1"],
    city: ["city", "town", "locality"],
    state: ["state", "region", "province", "state-province"],
    zip: ["zip", "zipcode", "zip-code", "postal", "postal-code", "postcode"],
    country: ["country", "country-code", "nation"],
  };

  function findFieldLabel(el) {
    return (el.getAttribute("aria-label") || el.getAttribute("placeholder") ||
      el.closest("label")?.textContent || "").toLowerCase();
  }

  function detectFormFields() {
    const fields = [];
    for (let i = 0; i < registry.length; i++) {
      const el = registry[i], tag = el.tagName.toLowerCase();
      if (tag !== "input" && tag !== "textarea" && tag !== "select") continue;
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (["hidden", "submit", "button", "file", "image", "reset", "password"].includes(type)) continue;
      if (String(el.getAttribute("autocomplete") || "").toLowerCase().includes("password")) continue;
      fields.push({
        index: i, tag, type,
        name: (el.getAttribute("name") || "").toLowerCase(),
        label: findFieldLabel(el),
        placeholder: (el.getAttribute("placeholder") || "").toLowerCase(),
        autocomplete: (el.getAttribute("autocomplete") || "").toLowerCase(),
        required: el.hasAttribute("required"),
      });
    }
    return fields;
  }

  function matchFieldScore(f, key) {
    const aliases = [key, ...(FIELD_ALIASES[key] || [])];
    let best = 0;
    for (const a of aliases) {
      if (f.autocomplete === a) return 100;
      if (f.name === a || f.name.includes(a)) best = Math.max(best, 80);
      if (f.label.includes(a) || f.placeholder.includes(a)) best = Math.max(best, 60);
    }
    return best;
  }

  function fillFormWithProfile(profile) {
    const fields = detectFormFields();
    const filled = [];
    const usedFields = new Set();
    for (const key of Object.keys(FIELD_ALIASES)) {
      const value = profile[key];
      if (!value) continue;
      let best = null, bestScore = 0;
      for (const f of fields) {
        if (usedFields.has(f.index)) continue;
        const s = matchFieldScore(f, key);
        if (s > bestScore) { bestScore = s; best = f; }
      }
      if (best && bestScore >= 60) {
        const el = findByIndex(best.index);
        if (!el) continue;
        if (best.tag === "select") {
          el.value = value;
          if (el.value !== value) {
            const opt = [...el.options].find(o => (o.textContent || "").toLowerCase().includes(value.toLowerCase()));
            if (opt) el.value = opt.value;
          }
          fireInput(el);
        } else {
          setValue(el, value);
        }
        usedFields.add(best.index);
        filled.push({ index: best.index, key, value });
      }
    }
    return filled;
  }

  // ---- workflow recorder -----------------------------------------------------

  let recording = false;
  const typeTimers = new Map();
  let lastScrollY = 0, lastScrollAt = 0;

  function robustSelector(el) {
    if (el.id) return "#" + CSS.escape(el.id);
    for (const attr of ["data-testid", "data-test", "name"]) {
      const v = el.getAttribute(attr);
      if (v) return `[${attr}="${CSS.escape(v)}"]`;
    }
    const parts = [];
    let node = el;
    while (node && node !== document.documentElement && parts.length < 4) {
      let sel = node.tagName.toLowerCase();
      if (node.id) { parts.unshift("#" + CSS.escape(node.id)); break; }
      if (typeof node.className === "string" && node.className.trim()) {
        const cls = node.className.trim().split(/\s+/).slice(0, 2).map(c => "." + CSS.escape(c)).join("");
        if (cls) sel += cls;
      }
      const parent = node.parentElement;
      if (parent) {
        const sib = [...parent.children];
        if (sib.length > 1) sel += `:nth-child(${sib.indexOf(node) + 1})`;
      }
      parts.unshift(sel);
      node = parent;
    }
    return parts.join(" > ");
  }

  function recSend(step) {
    try { api.runtime.sendMessage({ type: "recording_event", step }); } catch (_) {}
  }

  document.addEventListener("click", (e) => {
    if (!recording || window.__glideAgentAction) return;
    const el = e.target?.closest?.(INTERACTIVE_SELECTOR);
    if (!el) return;
    recSend({ type: "click", selector: robustSelector(el), text: clean(el.innerText || el.value || "") });
  }, true);

  document.addEventListener("change", (e) => {
    if (!recording || window.__glideAgentAction) return;
    const el = e.target;
    if (el.matches("select")) recSend({ type: "select", selector: robustSelector(el), value: el.value });
    else if (el.matches("input[type=checkbox], input[type=radio]"))
      recSend({ type: "click", selector: robustSelector(el), text: el.checked ? "checked" : "unchecked" });
  }, true);

  document.addEventListener("input", (e) => {
    if (!recording || window.__glideAgentAction) return;
    const el = e.target;
    if (!el.matches('input:not([type=checkbox],[type=radio],[type=password]), textarea, [contenteditable=true]')) return;
    clearTimeout(typeTimers.get(el));
    typeTimers.set(el, setTimeout(() => {
      const text = el.tagName === "INPUT" || el.tagName === "TEXTAREA" ? el.value : el.textContent;
      recSend({ type: "type", selector: robustSelector(el), text: String(text || "") });
    }, 700));
  }, true);

  window.addEventListener("scroll", () => {
    if (!recording || window.__glideAgentAction) return;
    const now = Date.now(), y = Math.round(window.scrollY);
    if (now - lastScrollAt < 600 || Math.abs(y - lastScrollY) < 40) return;
    lastScrollY = y; lastScrollAt = now;
    recSend({ type: "scroll", scrollY: y });
  }, true);

  window.addEventListener("pagehide", () => {
    for (const t of typeTimers.values()) clearTimeout(t);
    typeTimers.clear();
  });

  async function doWorkflowStep(step) {
    try {
      const el = step.selector ? document.querySelector(step.selector) : null;
      if (!el) return { ok: false, error: `Could not find element: ${step.selector}` };
      safeScrollIntoView(el, { block: "center" });
      highlightElement(el);
      await pause(300);
      if (step.type === "click") {
        const r = el.getBoundingClientRect();
        synthClick(el, r.left + r.width / 2, r.top + r.height / 2);
        return { ok: true, message: `Clicked ${step.selector}` };
      } else if (step.type === "type") {
        typeInto(el, step.text || "", false);
        return { ok: true, message: `Typed into ${step.selector}` };
      } else if (step.type === "select") {
        el.value = step.value || "";
        fireInput(el);
        return { ok: true, message: `Selected in ${step.selector}` };
      }
      return { ok: false, error: `Unknown step type: ${step.type}` };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }

  // ---- message router -------------------------------------------------------

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        switch (msg?.type) {
          case "ping":
            sendResponse({ ok: true, pong: true });
            break;
          case "get_state":
            sendResponse({ ok: true, state: collectState() });
            break;
          case "click":
            sendResponse(await doClick(msg.index));
            break;
          case "click_at":
            sendResponse(await doClickAt(msg.x, msg.y));
            break;
          case "type_text":
            sendResponse(await doType(msg.index, msg.text ?? "", !!msg.submit));
            break;
          case "type_at":
            sendResponse(await doTypeAt(msg.x, msg.y, msg.text ?? "", !!msg.submit));
            break;
          case "highlight_at":
            highlightPoint(msg.x, msg.y);
            sendResponse({ ok: true });
            break;
          case "drag":
            sendResponse(await doDrag(msg.fromX, msg.fromY, msg.toX, msg.toY));
            break;
          case "get_extract":
            sendResponse({ ok: true, data: extractData() });
            break;
          case "get_annotations":
            sendResponse({ ok: true, items: getElementAnnotations() });
            break;
          case "detect_form":
            sendResponse({ ok: true, fields: detectFormFields() });
            break;
          case "fill_form":
            sendResponse({ ok: true, filled: fillFormWithProfile(msg.profile || {}) });
            break;
          case "record_start":
            recording = true;
            lastScrollY = window.scrollY;
            sendResponse({ ok: true });
            break;
          case "record_stop":
            recording = false;
            for (const t of typeTimers.values()) clearTimeout(t);
            typeTimers.clear();
            sendResponse({ ok: true });
            break;
          case "workflow_step":
            sendResponse(await doWorkflowStep(msg.step || {}));
            break;
          case "get_analysis":
            sendResponse({ ok: true, analysis: detectPageType() });
            break;
          case "click_text": {
            const result = findElementByText(msg.text || "");
            if (!result) {
              sendResponse({ ok: false, error: `No element found containing text "${msg.text}". Try get_page_state and use click(index) or use a different search term.` });
            } else {
              safeScrollIntoView(result.el, { block: "center", inline: "center" });
              highlightElement(result.el);
              await pause(300);
              const r = result.el.getBoundingClientRect();
              synthClick(result.el, r.left + r.width / 2, r.top + r.height / 2);
              sendResponse({ ok: true, message: `Clicked element containing "${msg.text}" [${result.source}] → ${describe(result.el)}` });
            }
            break;
          }
          case "pick_start":
            startPick(sendResponse);
            break;
          case "execute_js":
            sendResponse(await doExecuteJs(msg.code || ""));
            break;
          case "read_clipboard":
            sendResponse(await doReadClipboard());
            break;
          case "write_clipboard":
            sendResponse(await doWriteClipboard(msg.text || ""));
            break;
          case "press_keys":
            sendResponse(doPressKeys(msg.keys || ""));
            break;
          case "scroll":
            sendResponse(doScroll(msg.direction || "down", msg.pixels));
            break;
          default:
            sendResponse({ ok: false, error: `Unknown action: ${msg?.type}` });
        }
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true; // async response
  });
})();
