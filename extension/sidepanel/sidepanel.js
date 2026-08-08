// sidepanel.js — chat UI, talks to background.js over a long-lived port.
const api = globalThis.browser ?? globalThis.chrome;

const els = {
  messages: document.getElementById("messages"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
  status: document.getElementById("statusBar"),
  newChat: document.getElementById("newChat"),
  openOptions: document.getElementById("openOptions"),
};

let port = null;
let busy = false;
let currentToolLog = null;

function connect() {
  port = api.runtime.connect({ name: "agent" });
  port.onMessage.addListener(onPortMessage);
  port.onDisconnect.addListener(() => {
    // service worker may have suspended; reconnect lazily on next send
    port = null;
  });
}

function ensurePort() {
  if (!port) connect();
  return port;
}

// ---- rendering --------------------------------------------------------------

function clearWelcome() {
  const w = els.messages.querySelector(".welcome");
  if (w) w.remove();
}

function scrollToBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

// minimal, safe inline formatting: `code` and **bold**
function formatText(text) {
  const div = document.createElement("div");
  div.textContent = text;
  let html = div.innerHTML;
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return html;
}

function addMessage(role, text) {
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

function prettyArgs(args) {
  if (!args || Object.keys(args).length === 0) return "";
  return Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");
}

const TOOL_LABELS = {
  get_page_state: "Reading page",
  click: "Clicking",
  type_text: "Typing",
  scroll: "Scrolling",
  navigate: "Navigating",
  go_back: "Going back",
  wait: "Waiting",
};

function addToolLog(name, args) {
  clearWelcome();
  const el = document.createElement("div");
  el.className = "tool-log";
  const label = TOOL_LABELS[name] || name;
  const argStr = prettyArgs(args);
  el.innerHTML =
    `<span class="tool-name">🔧 ${label}</span>` +
    (argStr ? ` <span>${formatText(argStr)}</span>` : "") +
    `<div class="tool-result"></div>`;
  els.messages.appendChild(el);
  scrollToBottom();
  currentToolLog = el;
}

function setToolResult(result) {
  if (!currentToolLog) return;
  const box = currentToolLog.querySelector(".tool-result");
  const short = String(result).split("\n").slice(0, 3).join("\n");
  box.textContent = short.length > 200 ? short.slice(0, 200) + "…" : short;
  currentToolLog = null;
}

function setStatus(text) {
  if (!text) {
    els.status.hidden = true;
    els.status.innerHTML = "";
    return;
  }
  els.status.hidden = false;
  els.status.innerHTML = `<span class="dot"></span><span>${text}</span>`;
}

function setBusy(v) {
  busy = v;
  els.send.disabled = v;
  els.input.disabled = v;
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
    case "tool":
      setStatus(`${TOOL_LABELS[msg.name] || msg.name}…`);
      addToolLog(msg.name, msg.args);
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
    case "reset_done":
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

els.messages.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (chip) sendMessage(chip.dataset.prompt);
});

els.newChat.addEventListener("click", () => {
  ensurePort().postMessage({ type: "reset" });
  els.messages.innerHTML = "";
  location.reload();
});

els.openOptions.addEventListener("click", () => {
  if (api.runtime.openOptionsPage) api.runtime.openOptionsPage();
});

connect();
els.input.focus();
