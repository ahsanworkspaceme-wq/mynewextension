// content.js — runs on every page.
// Responsibilities:
//   1. Serialize the page into a compact, indexed list of interactive elements + readable text.
//   2. Execute actions the agent requests: click, type, scroll.
// Communicates with background.js via runtime messages.

(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  if (window.__geminiAgentContentLoaded) return;
  window.__geminiAgentContentLoaded = true;

  const MAX_ELEMENTS = 120;
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
    "[contenteditable=true]",
    "[onclick]",
    "summary",
  ].join(",");

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    // must be within (or near) the document, not absurdly offscreen
    if (rect.bottom < -200 || rect.top > (window.innerHeight || 0) + 20000) return false;
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

  function collectState() {
    // clear previous markers
    document.querySelectorAll("[data-ai-index]").forEach((e) => e.removeAttribute("data-ai-index"));

    const nodes = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
    const lines = [];
    let idx = 0;
    for (const el of nodes) {
      if (idx >= MAX_ELEMENTS) break;
      if (!isVisible(el)) continue;
      el.setAttribute("data-ai-index", String(idx));
      lines.push(`[${idx}] ${describe(el)}`);
      idx++;
    }

    let text = "";
    try {
      text = (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT);
    } catch (_) {}

    return {
      url: location.href,
      title: document.title,
      scrollY: Math.round(window.scrollY),
      scrollHeight: Math.round(document.body?.scrollHeight || 0),
      viewportHeight: window.innerHeight,
      elementCount: idx,
      elements: lines.join("\n"),
      text,
    };
  }

  function findByIndex(index) {
    return document.querySelector(`[data-ai-index="${CSS.escape(String(index))}"]`);
  }

  function fireInput(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function pressEnter(el) {
    for (const type of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(
        new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })
      );
    }
    // if inside a form, try submitting
    const form = el.closest && el.closest("form");
    if (form && typeof form.requestSubmit === "function") {
      try {
        form.requestSubmit();
      } catch (_) {}
    }
  }

  async function doClick(index) {
    const el = findByIndex(index);
    if (!el) return { ok: false, error: `No element with index ${index}. Call get_page_state to refresh indices.` };
    el.scrollIntoView({ block: "center", inline: "center" });
    const desc = describe(el);
    el.click();
    return { ok: true, message: `Clicked [${index}] ${desc}` };
  }

  async function doType(index, text, submit) {
    const el = findByIndex(index);
    if (!el) return { ok: false, error: `No element with index ${index}. Call get_page_state to refresh indices.` };
    el.scrollIntoView({ block: "center" });
    el.focus();
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea") {
      const setter = Object.getOwnPropertyDescriptor(el.__proto__, "value")?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      fireInput(el);
    } else if (el.isContentEditable) {
      el.textContent = text;
      fireInput(el);
    } else {
      return { ok: false, error: `Element [${index}] is not typable.` };
    }
    if (submit) pressEnter(el);
    return { ok: true, message: `Typed "${clean(text)}" into [${index}]${submit ? " and submitted" : ""}` };
  }

  function doScroll(direction, pixels) {
    const amount = pixels || Math.round((window.innerHeight || 600) * 0.8);
    const dy = direction === "up" ? -amount : amount;
    window.scrollBy({ top: dy, behavior: "instant" in window ? "instant" : "auto" });
    return { ok: true, message: `Scrolled ${direction} by ${Math.abs(dy)}px (now at y=${Math.round(window.scrollY)})` };
  }

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
          case "type_text":
            sendResponse(await doType(msg.index, msg.text ?? "", !!msg.submit));
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
    return true; // keep the message channel open for async response
  });
})();
