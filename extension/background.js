// background.js — the agent orchestrator (service worker).
// Runs the agentic loop: user message -> Gemini (via backend) -> tool calls
// executed on the page -> results fed back -> repeat until the model answers.

const api = globalThis.browser ?? globalThis.chrome;

const DEFAULTS = {
  backendUrl: "http://localhost:8787",
  maxSteps: 16,
};

async function getConfig() {
  const stored = await api.storage.local.get(["backendUrl", "maxSteps"]);
  return {
    backendUrl: (stored.backendUrl || DEFAULTS.backendUrl).replace(/\/+$/, ""),
    maxSteps: Number(stored.maxSteps) || DEFAULTS.maxSteps,
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

// ---- tab / content-script helpers -------------------------------------------

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
    const res = await api.tabs.sendMessage(tabId, { type: "ping" });
    if (res?.pong) return true;
  } catch (_) {
    // not injected yet — try to inject
  }
  try {
    if (api.scripting?.executeScript) {
      await api.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      await delay(150);
      return true;
    }
  } catch (err) {
    return false;
  }
  return false;
}

async function sendToTab(tabId, message) {
  await ensureContentScript(tabId);
  return api.tabs.sendMessage(tabId, message);
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
    `Scroll: y=${state.scrollY} of ${state.scrollHeight} (viewport ${state.viewportHeight}px)`,
    ``,
    `Interactive elements (${state.elementCount}):`,
    state.elements || "(none found)",
    ``,
    `Visible page text (truncated):`,
    state.text || "(no text)",
  ].join("\n");
}

// ---- tool execution ---------------------------------------------------------

async function executeTool(tabId, name, args) {
  switch (name) {
    case "get_page_state": {
      const state = await getPageState(tabId);
      return formatState(state);
    }
    case "click": {
      const res = await sendToTab(tabId, { type: "click", index: args.index });
      await delay(400);
      await waitForTabComplete(tabId, 8000);
      return res?.ok ? res.message : `Failed: ${res?.error}`;
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
      return res?.ok ? res.message : `Failed: ${res?.error}`;
    }
    case "scroll": {
      const res = await sendToTab(tabId, {
        type: "scroll",
        direction: args.direction || "down",
        pixels: args.pixels,
      });
      await delay(200);
      return res?.ok ? res.message : `Failed: ${res?.error}`;
    }
    case "navigate": {
      let url = String(args.url || "").trim();
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;
      await api.tabs.update(tabId, { url });
      await delay(500);
      await waitForTabComplete(tabId, 15000);
      await ensureContentScript(tabId);
      return `Navigated to ${url}`;
    }
    case "go_back": {
      try {
        if (api.tabs.goBack) await api.tabs.goBack(tabId);
        else await sendToTab(tabId, { type: "scroll", direction: "up", pixels: 0 });
      } catch (_) {}
      await delay(500);
      await waitForTabComplete(tabId, 8000);
      return "Went back to the previous page.";
    }
    case "wait": {
      const secs = Math.min(Number(args.seconds) || 1, 8);
      await delay(secs * 1000);
      return `Waited ${secs}s.`;
    }
    default:
      return `Unknown tool: ${name}`;
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

  // conversation history for this side-panel session (Gemini `contents` format)
  const contents = [];
  let busy = false;

  const send = (msg) => {
    try {
      port.postMessage(msg);
    } catch (_) {}
  };

  port.onMessage.addListener(async (msg) => {
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
      const tabId = tab.id;

      // capture current page state and attach it to the user's turn
      const state = await getPageState(tabId);
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

        // surface any interim assistant text
        if (textParts.length && calls.length) {
          send({ type: "assistant_interim", text: textParts.join("").trim() });
        }

        if (calls.length === 0) {
          send({ type: "assistant", text: textParts.join("").trim() || "(no response)" });
          return;
        }

        // execute each requested tool and gather responses
        const responseParts = [];
        for (const call of calls) {
          const args = call.args || {};
          send({ type: "tool", name: call.name, args });
          let result;
          try {
            result = await executeTool(tabId, call.name, args);
          } catch (err) {
            result = `Error executing ${call.name}: ${String(err?.message || err)}`;
          }
          send({ type: "tool_result", name: call.name, result });
          responseParts.push({
            functionResponse: { name: call.name, response: { result: String(result) } },
          });
        }
        contents.push({ role: "user", parts: responseParts });
      }

      send({
        type: "assistant",
        text: `I reached the maximum of ${config.maxSteps} steps without finishing. Ask me to continue if you'd like.`,
      });
    } catch (err) {
      send({ type: "error", text: String(err?.message || err) });
    } finally {
      busy = false;
      send({ type: "done" });
    }
  });
});
