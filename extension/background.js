// background.js — the agent orchestrator (service worker).
// Runs the agentic loop: user message -> Gemini (via backend) -> tool calls
// (DOM-index OR vision coordinates) executed on the page -> results fed back ->
// repeat until the model answers. Handles screenshots, iframe-aware messaging,
// and safety confirmations.

const api = globalThis.browser ?? globalThis.chrome;

const DEFAULTS = {
  backendUrl: "http://localhost:8787",
  maxSteps: 20,
  confirmMode: "risky", // "off" | "risky" | "all"
};

async function getConfig() {
  const s = await api.storage.local.get(["backendUrl", "maxSteps", "confirmMode"]);
  return {
    backendUrl: (s.backendUrl || DEFAULTS.backendUrl).replace(/\/+$/, ""),
    maxSteps: Number(s.maxSteps) || DEFAULTS.maxSteps,
    confirmMode: s.confirmMode || DEFAULTS.confirmMode,
  };
}

// Open the side panel when the toolbar icon is clicked (Chrome).
if (api.sidePanel?.setPanelBehavior) {
  api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
if (api.action?.onClicked) {
  api.action.onClicked.addListener(async (tab) => {
    try {
      if (api.sidePanel?.open) await api.sidePanel.open({ tabId: tab.id });
    } catch (_) {}
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- tab / content-script helpers -------------------------------------------

async function getActiveTab() {
  const tabs = await api.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] || null;
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const tab = await api.tabs.get(tabId);
      if (tab.status === "complete") return true;
    } catch (_) {
      return false;
    }
    await delay(250);
  }
  return false;
}

async function ensureContentScript(tabId) {
  try {
    const res = await api.tabs.sendMessage(tabId, { type: "ping" }, { frameId: 0 });
    if (res?.pong) return true;
  } catch (_) {}
  try {
    if (api.scripting?.executeScript) {
      await api.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      await delay(150);
      return true;
    }
  } catch (_) {
    return false;
  }
  return false;
}

// Always talk to the TOP frame; it drills into child frames itself.
async function sendToTab(tabId, message) {
  await ensureContentScript(tabId);
  return api.tabs.sendMessage(tabId, message, { frameId: 0 });
}

async function getPageState(tabId) {
  try {
    const res = await sendToTab(tabId, { type: "get_state" });
    if (res?.ok) return res.state;
    return { error: res?.error || "Could not read page." };
  } catch (err) {
    return { error: `Page not accessible (${String(err?.message || err)}). It may be a browser-internal page.` };
  }
}

function formatState(state) {
  if (!state || state.error) return `Unable to read the page: ${state?.error || "unknown error"}`;
  return [
    `URL: ${state.url}`,
    `Title: ${state.title}`,
    `Viewport: ${state.viewportWidth}x${state.viewportHeight} css px`,
    `Scroll: y=${state.scrollY} of ${state.scrollHeight}`,
    ``,
    `Interactive elements (${state.elementCount}):`,
    state.elements || "(none found)",
    ``,
    `Visible page text (truncated):`,
    state.text || "(no text)",
  ].join("\n");
}

// ---- screenshot (normalized to CSS pixels via OffscreenCanvas) --------------

function arrayBufferToBase64(buf) {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Capture the visible tab and downscale so the image's pixel space equals CSS
// pixels — then vision coordinates map 1:1 to elementFromPoint.
async function captureScreenshot(tab, state) {
  const dataUrl = await api.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const cssW = state?.viewportWidth || 0;
  const cssH = state?.viewportHeight || 0;

  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const w = cssW || bitmap.width;
    const h = cssH || bitmap.height;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, w, h);
    const outBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 });
    const b64 = arrayBufferToBase64(await outBlob.arrayBuffer());
    return { mimeType: "image/jpeg", data: b64, width: w, height: h };
  } catch (_) {
    // Fallback: send the raw PNG data URL unscaled.
    const b64 = dataUrl.split(",")[1] || "";
    return { mimeType: "image/png", data: b64, width: cssW, height: cssH };
  }
}

// ---- tool execution ---------------------------------------------------------
// Returns { result: string, image?: {mimeType,data} }.

async function executeTool(tab, name, args) {
  const tabId = tab.id;
  switch (name) {
    case "get_page_state": {
      return { result: formatState(await getPageState(tabId)) };
    }
    case "screenshot": {
      const state = await getPageState(tabId);
      if (state?.error) return { result: `Cannot screenshot: ${state.error}` };
      try {
        const image = await captureScreenshot(tab, state);
        return {
          result: `Screenshot captured (${image.width}x${image.height} px). The image is attached. Give click_at/type_at coordinates in this pixel space (top-left origin).`,
          image,
        };
      } catch (err) {
        return { result: `Screenshot failed: ${String(err?.message || err)}` };
      }
    }
    case "click": {
      const res = await sendToTab(tabId, { type: "click", index: args.index });
      await delay(400);
      await waitForTabComplete(tabId, 8000);
      return { result: res?.ok ? res.message : `Failed: ${res?.error}` };
    }
    case "click_at": {
      const res = await sendToTab(tabId, { type: "click_at", x: args.x, y: args.y });
      await delay(400);
      await waitForTabComplete(tabId, 8000);
      return { result: res?.ok ? res.message : `Failed: ${res?.error}` };
    }
    case "type_text": {
      const res = await sendToTab(tabId, {
        type: "type_text",
        index: args.index,
        text: args.text,
        submit: !!args.submit,
      });
      if (args.submit) {
        await delay(500);
        await waitForTabComplete(tabId, 8000);
      }
      return { result: res?.ok ? res.message : `Failed: ${res?.error}` };
    }
    case "type_at": {
      const res = await sendToTab(tabId, {
        type: "type_at",
        x: args.x,
        y: args.y,
        text: args.text,
        submit: !!args.submit,
      });
      if (args.submit) {
        await delay(500);
        await waitForTabComplete(tabId, 8000);
      }
      return { result: res?.ok ? res.message : `Failed: ${res?.error}` };
    }
    case "scroll": {
      const res = await sendToTab(tabId, {
        type: "scroll",
        direction: args.direction || "down",
        pixels: args.pixels,
      });
      await delay(250);
      return { result: res?.ok ? res.message : `Failed: ${res?.error}` };
    }
    case "navigate": {
      let url = String(args.url || "").trim();
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;
      await api.tabs.update(tabId, { url });
      await delay(500);
      await waitForTabComplete(tabId, 15000);
      await ensureContentScript(tabId);
      return { result: `Navigated to ${url}` };
    }
    case "go_back": {
      try {
        if (api.tabs.goBack) await api.tabs.goBack(tabId);
      } catch (_) {}
      await delay(500);
      await waitForTabComplete(tabId, 8000);
      return { result: "Went back to the previous page." };
    }
    case "wait": {
      const secs = Math.min(Number(args.seconds) || 1, 8);
      await delay(secs * 1000);
      return { result: `Waited ${secs}s.` };
    }
    default:
      return { result: `Unknown tool: ${name}` };
  }
}

// ---- risk classification ----------------------------------------------------

function needsConfirm(name, args, mode) {
  if (mode === "off") return false;
  const isAction = ["click", "click_at", "type_text", "type_at", "navigate", "go_back"].includes(name);
  if (mode === "all") return isAction;
  // "risky": navigations and form submissions
  if (name === "navigate") return true;
  if ((name === "type_text" || name === "type_at") && args?.submit) return true;
  return false;
}

function confirmDetail(name, args) {
  switch (name) {
    case "navigate":
      return `Navigate to: ${args.url}`;
    case "type_text":
      return `Type "${args.text}" and submit`;
    case "type_at":
      return `Type "${args.text}" at (${args.x}, ${args.y}) and submit`;
    case "click":
      return `Click element [${args.index}]`;
    case "click_at":
      return `Click at (${args.x}, ${args.y})`;
    case "go_back":
      return "Go back to the previous page";
    default:
      return name;
  }
}

// ---- backend call -----------------------------------------------------------

async function callBackend(backendUrl, contents) {
  const resp = await fetch(`${backendUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Backend ${resp.status}: ${body.slice(0, 300)}`);
  }
  return resp.json();
}

// ---- agent loop (per side-panel connection) ---------------------------------

api.runtime.onConnect.addListener((port) => {
  if (port.name !== "agent") return;

  const contents = [];
  let busy = false;
  const pendingConfirms = new Map();
  let confirmSeq = 0;

  const send = (msg) => {
    try {
      port.postMessage(msg);
    } catch (_) {}
  };

  function requestConfirm(detail) {
    return new Promise((resolve) => {
      const id = ++confirmSeq;
      pendingConfirms.set(id, resolve);
      send({ type: "confirm", id, detail });
    });
  }

  port.onMessage.addListener(async (msg) => {
    if (msg?.type === "confirm_result") {
      const resolve = pendingConfirms.get(msg.id);
      if (resolve) {
        pendingConfirms.delete(msg.id);
        resolve(!!msg.approved);
      }
      return;
    }
    if (msg?.type === "reset") {
      contents.length = 0;
      send({ type: "reset_done" });
      return;
    }
    if (msg?.type !== "user_message") return;
    if (busy) {
      send({ type: "error", text: "Agent is still working on the previous request." });
      return;
    }
    busy = true;

    try {
      const config = await getConfig();
      const tab = await getActiveTab();
      if (!tab) {
        send({ type: "error", text: "No active tab found." });
        return;
      }

      const state = await getPageState(tab.id);
      contents.push({
        role: "user",
        parts: [
          { text: msg.text },
          { text: `\n\n[Current page state at the time of this message]\n${formatState(state)}` },
        ],
      });

      let steps = 0;
      while (steps < config.maxSteps) {
        steps++;
        send({ type: "thinking" });

        let data;
        try {
          data = await callBackend(config.backendUrl, contents);
        } catch (err) {
          send({
            type: "error",
            text:
              `Could not reach the backend at ${config.backendUrl}. ` +
              `Is it running? (cd backend && npm start)\n\nDetails: ${String(err.message || err)}`,
          });
          return;
        }

        const parts = data?.parts || [];
        contents.push({ role: "model", parts });

        const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
        const textParts = parts.filter((p) => p.text).map((p) => p.text);

        if (textParts.length && calls.length) {
          send({ type: "assistant_interim", text: textParts.join("").trim() });
        }

        if (calls.length === 0) {
          send({ type: "assistant", text: textParts.join("").trim() || "(no response)" });
          return;
        }

        const responseParts = [];
        for (const call of calls) {
          const args = call.args || {};

          if (needsConfirm(call.name, args, config.confirmMode)) {
            send({ type: "thinking_pause" });
            const approved = await requestConfirm(confirmDetail(call.name, args));
            if (!approved) {
              send({ type: "tool", name: call.name, args, declined: true });
              responseParts.push({
                functionResponse: {
                  name: call.name,
                  response: { result: "The user DECLINED this action. Do not repeat it; ask how to proceed." },
                },
              });
              continue;
            }
          }

          send({ type: "tool", name: call.name, args });
          let out;
          try {
            out = await executeTool(tab, call.name, args);
          } catch (err) {
            out = { result: `Error executing ${call.name}: ${String(err?.message || err)}` };
          }
          send({ type: "tool_result", name: call.name, result: out.result });

          responseParts.push({
            functionResponse: { name: call.name, response: { result: String(out.result) } },
          });
          // attach screenshot image so Gemini can see the page
          if (out.image) {
            responseParts.push({ inlineData: { mimeType: out.image.mimeType, data: out.image.data } });
          }
        }
        contents.push({ role: "user", parts: responseParts });
      }

      send({
        type: "assistant",
        text: `I reached the maximum of ${config.maxSteps} steps. Ask me to continue if you'd like.`,
      });
    } catch (err) {
      send({ type: "error", text: String(err?.message || err) });
    } finally {
      busy = false;
      send({ type: "done" });
    }
  });

  port.onDisconnect.addListener(() => {
    pendingConfirms.forEach((resolve) => resolve(false));
    pendingConfirms.clear();
  });
});
