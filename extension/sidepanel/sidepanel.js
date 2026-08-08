// sidepanel.js — chat UI, talks to background.js over a long-lived port.
const api = globalThis.browser ?? globalThis.chrome;

const els = {
  messages: document.getElementById("messages"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
  status: document.getElementById("statusBar"),
  statusText: document.getElementById("statusText"),
  stop: document.getElementById("stop"),
  mic: document.getElementById("mic"),
  newChat: document.getElementById("newChat"),
  openOptions: document.getElementById("openOptions"),
};

let port = null;
let busy = false;
let currentToolLog = null;

// UI transcript (persisted so the chat survives reopening the panel)
let transcript = [];
let lastToolItem = null;

function connect() {
  port = api.runtime.connect({ name: "agent" });
  port.onMessage.addListener(onPortMessage);
  port.onDisconnect.addListener(() => {
    port = null;
  });
}
function ensurePort() {
  if (!port) connect();
  return port;
}

// ---- persistence ------------------------------------------------------------

function saveTranscript() {
  try {
    api.storage.local.set({ uiTranscript: transcript.slice(-200) });
  } catch (_) {}
}
async function restoreTranscript() {
  const s = await api.storage.local.get(["uiTranscript"]);
  const items = Array.isArray(s.uiTranscript) ? s.uiTranscript : [];
  if (!items.length) return;
  transcript = items;
  for (const it of items) {
    if (it.t === "tool") {
      const el = renderToolLog(it.name, it.args, it.declined);
      if (it.result) renderToolResult(el, it.result);
    } else {
      renderMessage(it.t, it.text);
    }
  }
}

// ---- rendering --------------------------------------------------------------

function clearWelcome() {
  const w = els.messages.querySelector(".welcome");
  if (w) w.remove();
}
function scrollToBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}
function formatText(text) {
  const div = document.createElement("div");
  div.textContent = text;
  let html = div.innerHTML;
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return html;
}

function renderMessage(role, text) {
  clearWelcome();
  const msg = document.createElement("div");
  msg.className = `msg ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = formatText(text);
  msg.appendChild(bubble);
  els.messages.appendChild(msg);
  scrollToBottom();
  return msg;
}
function addMessage(role, text) {
  const el = renderMessage(role, text);
  transcript.push({ t: role, text });
  saveTranscript();
  return el;
}

function prettyArgs(args) {
  if (!args || Object.keys(args).length === 0) return "";
  return Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");
}

const TOOL_LABELS = {
  get_page_state: "Reading page",
  screenshot: "Looking at the page",
  click: "Clicking",
  click_at: "Clicking",
  type_text: "Typing",
  type_at: "Typing",
  scroll: "Scrolling",
  navigate: "Navigating",
  go_back: "Going back",
  list_tabs: "Listing tabs",
  open_tab: "Opening tab",
  switch_tab: "Switching tab",
  close_tab: "Closing tab",
  download: "Downloading",
  upload_file: "Opening file chooser",
  wait: "Waiting",
};

function renderToolLog(name, args, declined) {
  clearWelcome();
  const el = document.createElement("div");
  el.className = "tool-log";
  const label = TOOL_LABELS[name] || name;
  const argStr = prettyArgs(args);
  const icon = declined ? "🚫" : "🔧";
  el.innerHTML =
    `<span class="tool-name">${icon} ${label}${declined ? " (blocked/declined)" : ""}</span>` +
    (argStr ? ` <span>${formatText(argStr)}</span>` : "") +
    `<div class="tool-result"></div>`;
  els.messages.appendChild(el);
  scrollToBottom();
  return el;
}
function addToolLog(name, args, declined) {
  const el = renderToolLog(name, args, declined);
  const item = { t: "tool", name, args, declined, result: "" };
  transcript.push(item);
  lastToolItem = declined ? null : item;
  currentToolLog = declined ? null : el;
  saveTranscript();
}

function renderToolResult(el, result) {
  const box = el.querySelector(".tool-result");
  const short = String(result).split("\n").slice(0, 3).join("\n");
  box.textContent = short.length > 200 ? short.slice(0, 200) + "…" : short;
}
function setToolResult(result) {
  if (currentToolLog) renderToolResult(currentToolLog, result);
  if (lastToolItem) {
    lastToolItem.result = result;
    saveTranscript();
  }
  currentToolLog = null;
  lastToolItem = null;
}

function renderConfirm(id, detail) {
  clearWelcome();
  const card = document.createElement("div");
  card.className = "confirm-card";
  card.innerHTML =
    `<div class="confirm-title">⚠️ Confirm action</div>` +
    `<div class="confirm-detail">${formatText(detail)}</div>` +
    `<div class="confirm-actions">` +
    `<button class="confirm-yes">Approve</button>` +
    `<button class="confirm-no">Reject</button>` +
    `</div>`;
  els.messages.appendChild(card);
  scrollToBottom();
  const respond = (approved) => {
    ensurePort().postMessage({ type: "confirm_result", id, approved });
    card.querySelectorAll("button").forEach((b) => (b.disabled = true));
    card.classList.add(approved ? "approved" : "rejected");
    const note = document.createElement("div");
    note.className = "confirm-note";
    note.textContent = approved ? "✓ Approved" : "✕ Rejected";
    card.appendChild(note);
    setStatus(approved ? "Working…" : "");
  };
  card.querySelector(".confirm-yes").addEventListener("click", () => respond(true));
  card.querySelector(".confirm-no").addEventListener("click", () => respond(false));
}

function setStatus(text) {
  if (!text) {
    els.status.hidden = true;
    return;
  }
  els.status.hidden = false;
  els.statusText.textContent = text;
}

function setBusy(v) {
  busy = v;
  els.send.disabled = v;
  els.stop.style.display = v ? "" : "none";
  if (!v) {
    setStatus("");
    els.input.focus();
  }
}

// ---- port messages ----------------------------------------------------------

function onPortMessage(msg) {
  switch (msg.type) {
    case "thinking":
      setStatus("Thinking…");
      break;
    case "thinking_pause":
      setStatus("Waiting for your confirmation…");
      break;
    case "confirm":
      setStatus("Waiting for your confirmation…");
      renderConfirm(msg.id, msg.detail);
      break;
    case "tool":
      setStatus(`${TOOL_LABELS[msg.name] || msg.name}…`);
      addToolLog(msg.name, msg.args, msg.declined);
      break;
    case "tool_result":
      setToolResult(msg.result);
      break;
    case "assistant_interim":
      if (msg.text) addMessage("assistant", msg.text);
      break;
    case "assistant":
      addMessage("assistant", msg.text);
      break;
    case "error":
      addMessage("error", msg.text);
      break;
    case "done":
      setBusy(false);
      break;
  }
}

// ---- sending ----------------------------------------------------------------

function sendMessage(text) {
  const value = (text ?? els.input.value).trim();
  if (!value || busy) return;
  addMessage("user", value);
  els.input.value = "";
  autoResize();
  setBusy(true);
  setStatus("Thinking…");
  ensurePort().postMessage({ type: "user_message", text: value });
}

// ---- input behavior ---------------------------------------------------------

function autoResize() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 140) + "px";
}
els.input.addEventListener("input", autoResize);
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
els.send.addEventListener("click", () => sendMessage());
els.stop.addEventListener("click", () => {
  ensurePort().postMessage({ type: "interrupt" });
  setStatus("Stopping…");
});

els.messages.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (chip) sendMessage(chip.dataset.prompt);
});

els.newChat.addEventListener("click", async () => {
  ensurePort().postMessage({ type: "reset" });
  transcript = [];
  await api.storage.local.remove(["uiTranscript"]);
  els.messages.innerHTML = "";
  location.reload();
});
els.openOptions.addEventListener("click", () => {
  if (api.runtime.openOptionsPage) api.runtime.openOptionsPage();
});

// ---- voice dictation (Web Speech API, Chrome) -------------------------------

(function setupMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    els.mic.style.display = "none";
    return;
  }
  let recog = null;
  let listening = false;
  els.mic.addEventListener("click", () => {
    if (listening) {
      recog && recog.stop();
      return;
    }
    recog = new SR();
    recog.lang = navigator.language || "en-US";
    recog.interimResults = true;
    recog.continuous = false;
    const base = els.input.value;
    recog.onstart = () => {
      listening = true;
      els.mic.classList.add("listening");
    };
    recog.onend = () => {
      listening = false;
      els.mic.classList.remove("listening");
    };
    recog.onerror = () => {
      listening = false;
      els.mic.classList.remove("listening");
    };
    recog.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      els.input.value = (base ? base + " " : "") + text;
      autoResize();
    };
    recog.start();
  });
})();

// ---- init -------------------------------------------------------------------

connect();
setBusy(false);
restoreTranscript();
els.input.focus();
