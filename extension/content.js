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
      border: "2px solid #7c5cff",
      background: "rgba(124,92,255,0.18)",
      borderRadius: "4px",
      zIndex: "2147483647",
      pointerEvents: "none",
      boxShadow: "0 0 0 2px rgba(79,140,255,0.4)",
      transition: "opacity 0.35s ease",
    });
    document.documentElement.appendChild(div);
    setTimeout(() => (div.style.opacity = "0"), 250);
    setTimeout(() => div.remove(), 650);
  }

  function highlightElement(el) {
    try {
      flash(rectInTopViewport(el));
    } catch (_) {}
  }

  function highlightPoint(x, y) {
    flash({ left: x - 14, top: y - 14, width: 28, height: 28 });
  }

  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

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

  async function doClick(index) {
    const el = findByIndex(index);
    if (!el) return { ok: false, error: `No element with index ${index}. Call get_page_state to refresh indices.` };
    el.scrollIntoView({ block: "center", inline: "center" });
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
    el.scrollIntoView({ block: "center" });
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
