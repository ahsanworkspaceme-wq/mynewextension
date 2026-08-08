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

  function collectState() {
    registry = [];
    const lines = [];
    walk(document, lines);

    let text = "";
    try {
      text = (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT);
    } catch (_) {}

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

  function flash(box) {
    const div = document.createElement("div");
    Object.assign(div.style, {
      position: "fixed",
      left: box.left + "px",
      top: box.top + "px",
      width: box.width + "px",
      height: box.height + "px",
      border: "2px solid #9b8cff",
      background: "rgba(155,140,255,0.15)",
      borderRadius: "6px",
      zIndex: "2147483646",
      pointerEvents: "none",
      boxShadow: "0 0 0 3px rgba(155,140,255,0.18)",
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
        border: "2px solid rgba(155,140,255,0.9)",
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
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, text);
    else el.value = text;
    fireInput(el);
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

  async function doClickAt(x, y) {
    highlightPoint(x, y);
    await pause(350);
    const el = deepElementFromPoint(x, y);
    if (!el) return { ok: false, error: `No element at (${x}, ${y}).` };
    synthClick(el, x, y);
    return { ok: true, message: `Clicked at (${x}, ${y}) → ${describe(el)}` };
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
    highlightPoint(x, y);
    await pause(300);
    const el = deepElementFromPoint(x, y);
    if (!el) return { ok: false, error: `No element at (${x}, ${y}).` };
    synthClick(el, x, y);
    if (!typeInto(el, text, submit)) return { ok: false, error: `Element at (${x}, ${y}) is not typable.` };
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
      border: "2px solid #8b6dff",
      background: "rgba(139,109,255,0.15)",
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
          case "pick_start":
            startPick(sendResponse);
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
