// sidepanel.js — chat UI, talks to background.js over a long-lived port.
const api = globalThis.browser ?? globalThis.chrome;

const els = {
  messages: document.getElementById("messages"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
  status: document.getElementById("workingBar"),
  statusText: document.getElementById("statusText"),
  stop: document.getElementById("stop"),
  mic: document.getElementById("mic"),
  newChat: document.getElementById("newChat"),
  openOptions: document.getElementById("openOptions"),
  usage: document.getElementById("usage"),
  modelSelect: document.getElementById("modelSelect"),
  saveSkill: document.getElementById("saveSkill"),
  schedule: document.getElementById("schedule"),
  exportChat: document.getElementById("exportChat"),
  fillProfile: document.getElementById("fillProfile"),
  recordWorkflow: document.getElementById("recordWorkflow"),
  workflowsList: document.getElementById("workflowsList"),
  recordBar: document.getElementById("recordBar"),
  stopRecord: document.getElementById("stopRecord"),
  workflowsPanel: document.getElementById("workflowsPanel"),
  pick: document.getElementById("pick"),
  skillsBar: document.getElementById("skillsBar"),
  suggestionsBar: document.getElementById("suggestionsBar"),
  confirmMode: document.getElementById("confirmMode"),
  aiSetup: document.getElementById("aiSetup"),
  onboarding: document.getElementById("onboarding"),
  obProvider: document.getElementById("obProvider"),
  obKeyHint: document.getElementById("obKeyHint"),
  obKeyWrap: document.getElementById("obKeyWrap"),
  obKey: document.getElementById("obKey"),
  obCustomUrlWrap: document.getElementById("obCustomUrlWrap"),
  obCustomUrl: document.getElementById("obCustomUrl"),
  obConnect: document.getElementById("obConnect"),
  obStatus: document.getElementById("obStatus"),
  obModelWrap: document.getElementById("obModelWrap"),
  obModel: document.getElementById("obModel"),
  obBackend: document.getElementById("obBackend"),
  obDone: document.getElementById("obDone"),
};

const PROVIDER_INFO = {
  gemini: { label: "Google Gemini", url: "https://aistudio.google.com/apikey", needsKey: true },
  openai: { label: "OpenAI (GPT)", url: "https://platform.openai.com/api-keys", needsKey: true },
  anthropic: { label: "Anthropic (Claude)", url: "https://console.anthropic.com/settings/keys", needsKey: true },
  openrouter: { label: "OpenRouter — many models, one key", url: "https://openrouter.ai/keys", needsKey: true },
  groq: { label: "Groq — very fast, free tier", url: "https://console.groq.com/keys", needsKey: true },
  deepseek: { label: "DeepSeek — powerful & affordable", url: "https://platform.deepseek.com/api_keys", needsKey: true },
  mistral: { label: "Mistral", url: "https://console.mistral.ai/api-keys", needsKey: true },
  cohere: { label: "Cohere — Command R+", url: "https://dashboard.cohere.com/api-keys", needsKey: true },
  together: { label: "Together AI — open models", url: "https://api.together.xyz/settings/api-keys", needsKey: true },
  fireworks: { label: "Fireworks AI — fast inference", url: "https://fireworks.ai/account/api-keys", needsKey: true },
  huggingface: { label: "Hugging Face — free inference", url: "https://huggingface.co/settings/tokens", needsKey: true },
  novita: { label: "Novita AI — affordable GPU", url: "https://novita.ai/settings/api-keys", needsKey: true },
  chutes: { label: "Chutes AI — cheap & fast", url: "https://chutes.ai/app/api-keys", needsKey: true },
  ollama: { label: "Ollama — local & free (no key)", url: "https://ollama.com/download", needsKey: false },
  custom: { label: "Custom — any OpenAI-compatible API", url: "", needsKey: true, custom: true },
};

let port = null;
let busy = false;
let currentActivity = null;
let transcript = [];
let lastActivityItem = null;
let lastUserText = "";

function connect() {
  port = api.runtime.connect({ name: "agent" });
  port.onMessage.addListener(onPortMessage);
  port.onDisconnect.addListener(() => (port = null));
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
      const el = renderActivity(it.name, it.args, it.declined);
      if (it.result || it.thumb) renderActivityResult(el, it.result, it.thumb);
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
function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
// inline formatting on already-escaped text
function inlineMd(s) {
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}
function formatText(text) {
  return inlineMd(escapeHtml(text));
}
function splitRow(l) {
  return l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim());
}
function isTableSep(l) {
  return /-/.test(l) && /^\s*\|?[\s:\-|]+\|?\s*$/.test(l);
}
function renderMarkdown(md) {
  const lines = String(md).replace(/\r/g, "").split("\n");
  let html = "";
  let i = 0;
  let inList = null;
  const closeList = () => {
    if (inList) {
      html += `</${inList}>`;
      inList = null;
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      i++;
      let code = "";
      while (i < lines.length && !/^```/.test(lines[i])) code += lines[i++] + "\n";
      i++;
      closeList();
      html += `<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") rows.push(splitRow(lines[i++]));
      closeList();
      html +=
        "<table><thead><tr>" +
        header.map((c) => `<th>${inlineMd(escapeHtml(c))}</th>`).join("") +
        "</tr></thead><tbody>" +
        rows.map((r) => "<tr>" + r.map((c) => `<td>${inlineMd(escapeHtml(c))}</td>`).join("") + "</tr>").join("") +
        "</tbody></table>";
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      html += `<h${h[1].length}>${inlineMd(escapeHtml(h[2]))}</h${h[1].length}>`;
      i++;
      continue;
    }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      closeList();
      html += "<hr>";
      i++;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      closeList();
      html += `<blockquote>${inlineMd(escapeHtml(line.replace(/^\s*>\s?/, "")))}</blockquote>`;
      i++;
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      if (inList !== "ul") {
        closeList();
        html += "<ul>";
        inList = "ul";
      }
      html += `<li>${inlineMd(escapeHtml(ul[1]))}</li>`;
      i++;
      continue;
    }
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      if (inList !== "ol") {
        closeList();
        html += "<ol>";
        inList = "ol";
      }
      html += `<li>${inlineMd(escapeHtml(ol[1]))}</li>`;
      i++;
      continue;
    }
    if (/^\s*$/.test(line)) {
      closeList();
      i++;
      continue;
    }
    closeList();
    html += `<p>${inlineMd(escapeHtml(line))}</p>`;
    i++;
  }
  closeList();
  return html;
}

function renderMessage(role, text) {
  clearWelcome();
  const msg = document.createElement("div");
  msg.className = `msg ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = role === "assistant" ? renderMarkdown(text) : formatText(text);
  msg.appendChild(bubble);
  els.messages.appendChild(msg);
  scrollToBottom();
  return { msg, bubble };
}
// typewriter reveal, then swap in rich markdown
function typewrite(bubble, text) {
  let i = 0;
  const step = Math.max(2, Math.round(text.length / 140));
  const tick = () => {
    i += step;
    bubble.textContent = text.slice(0, i);
    scrollToBottom();
    if (i < text.length) setTimeout(tick, 12);
    else {
      bubble.innerHTML = renderMarkdown(text);
      scrollToBottom();
    }
  };
  tick();
}
function addMessage(role, text) {
  transcript.push({ t: role, text });
  saveTranscript();
  if (role === "assistant" && text) {
    clearWelcome();
    const msg = document.createElement("div");
    msg.className = "msg assistant";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    msg.appendChild(bubble);
    els.messages.appendChild(msg);
    typewrite(bubble, text);
    return msg;
  }
  return renderMessage(role, text).msg;
}

function prettyArgs(args) {
  if (!args || Object.keys(args).length === 0) return "";
  return Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");
}

// Premium-style activity labels (verb phrases like Claude's feed)
const TOOL_LABELS = {
  get_page_state: "Reading page",
  screenshot: "Capturing page",
  click: "Clicking",
  click_at: "Clicking",
  click_text: "Clicking by text",
  type_text: "Typing",
  type_at: "Typing",
  scroll: "Scrolling",
  drag: "Dragging",
  navigate: "Navigating",
  go_back: "Going back",
  list_tabs: "Listing tabs",
  open_tab: "Opening tab",
  switch_tab: "Switching tab",
  close_tab: "Closing tab",
  download: "Downloading",
  upload_file: "Opening file chooser",
  read_pdf: "Reading PDF",
  extract_data: "Extracting data",
  http_request: "Calling API",
  execute_js: "Running code",
  read_clipboard: "Reading clipboard",
  write_clipboard: "Copying",
  press_keys: "Pressing keys",
  remember: "Saving to memory",
  recall: "Recalling memory",
  smart_fill: "Auto-filling form",
  detect_form: "Detecting form fields",
  record_start: "Recording actions",
  record_stop: "Stopping recording",
  record_get: "Getting recording",
  workflow_save: "Saving workflow",
  workflow_list: "Listing workflows",
  workflow_replay: "Replaying workflow",
  workflow_delete: "Deleting workflow",
  wait: "Waiting",
};
// Minimal line-icons (inner SVG paths) for the activity feed.
const ACT_PATHS = {
  get_page_state: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
  screenshot: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="3.5"/>',
  click: '<path d="M4 4l7 16 2.2-6.8L20 11z"/>',
  click_at: '<path d="M4 4l7 16 2.2-6.8L20 11z"/>',
  click_text: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
  type_text: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  type_at: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  scroll: '<path d="M7 13l5 5 5-5M7 6l5 5 5-5"/>',
  drag: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
  navigate: '<circle cx="12" cy="12" r="9"/><path d="M16 8l-2 6-6 2 2-6z"/>',
  go_back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  open_tab: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  switch_tab: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  close_tab: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  list_tabs: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload_file: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  read_pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  extract_data: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  http_request: '<path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20zM2 12h20"/><circle cx="12" cy="12" r="9"/>',
  execute_js: '<path d="M8 6l-6 6 6 6M16 6l6 6-6 6"/>',
  read_clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  write_clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  press_keys: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M8 14h8"/>',
  remember: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  recall: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  smart_fill: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  detect_form: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M3 9h18"/>',
  record_start: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>',
  record_stop: '<circle cx="12" cy="12" r="7"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  record_get: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>',
  workflow_save: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  workflow_list: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  workflow_replay: '<polygon points="5 3 19 12 5 21 5 3"/>',
  workflow_delete: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  wait: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
function actIcon(name, declined) {
  if (declined) return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M5 5l14 14"/></svg>';
  const inner = ACT_PATHS[name] || '<circle cx="12" cy="12" r="3.2"/>';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

function renderActivity(name, args, declined) {
  clearWelcome();
  const el = document.createElement("div");
  el.className = "activity" + (declined ? " declined" : "");
  const label = TOOL_LABELS[name] || name;
  const argStr = prettyArgs(args);
  el.innerHTML =
    `<span class="act-icon">${actIcon(name, declined)}</span>` +
    `<div class="act-body">` +
    `<div class="act-label">${label}${declined ? " · blocked" : ""}</div>` +
    (argStr ? `<div class="act-args">${formatText(argStr)}</div>` : "") +
    `</div>` +
    `<img class="act-thumb" hidden alt="" />`;
  els.messages.appendChild(el);
  scrollToBottom();
  return el;
}
function addActivity(name, args, declined) {
  const el = renderActivity(name, args, declined);
  const item = { t: "tool", name, args, declined, result: "", thumb: "" };
  transcript.push(item);
  lastActivityItem = declined ? null : item;
  currentActivity = declined ? null : el;
  saveTranscript();
}
function renderActivityResult(el, result, thumb) {
  if (result) {
    const args = el.querySelector(".act-args");
    const short = String(result).split("\n")[0].slice(0, 90);
    if (args) args.textContent = short;
    else {
      const d = document.createElement("div");
      d.className = "act-args";
      d.textContent = short;
      el.querySelector(".act-body").appendChild(d);
    }
  }
  if (thumb) {
    const img = el.querySelector(".act-thumb");
    img.src = thumb;
    img.hidden = false;
  }
}
function setActivityResult(result, thumb) {
  if (currentActivity) renderActivityResult(currentActivity, result, thumb);
  if (lastActivityItem) {
    lastActivityItem.result = result || "";
    if (thumb) lastActivityItem.thumb = thumb;
    saveTranscript();
  }
  currentActivity = null;
  lastActivityItem = null;
}

// ---- plan / ask / confirm cards --------------------------------------------

function renderPlan(id, goal, steps) {
  clearWelcome();
  const card = document.createElement("div");
  card.className = "plan-card";
  const list = (steps || []).map((s, i) => `<li>${formatText(String(s))}</li>`).join("");
  card.innerHTML =
    `<div class="plan-title">📋 Glide's plan${goal ? ": " + formatText(goal) : ""}</div>` +
    `<ol class="plan-steps">${list}</ol>` +
    `<div class="plan-actions">` +
    `<button class="plan-approve">Approve plan</button>` +
    `<button class="plan-change">Make changes</button>` +
    `</div>`;
  els.messages.appendChild(card);
  scrollToBottom();
  const finish = (approved, feedback) => {
    ensurePort().postMessage({ type: "ui_result", id, data: { approved, feedback } });
    card.querySelectorAll("button").forEach((b) => (b.disabled = true));
    card.classList.add(approved ? "approved" : "changed");
    const note = document.createElement("div");
    note.className = "confirm-note";
    note.textContent = approved ? "✓ Approved" : "✎ Changes requested";
    card.appendChild(note);
  };
  card.querySelector(".plan-approve").addEventListener("click", () => finish(true, ""));
  card.querySelector(".plan-change").addEventListener("click", () => {
    const fb = window.prompt("What should change about the plan?");
    finish(false, fb || "");
  });
}

function renderAsk(id, question) {
  clearWelcome();
  const card = document.createElement("div");
  card.className = "confirm-card";
  card.innerHTML =
    `<div class="confirm-title">🙋 The agent needs you</div>` +
    `<div class="confirm-detail">${formatText(question)}</div>` +
    `<div class="ask-row"><input class="ask-input" type="text" placeholder="Type your answer…" /><button class="confirm-yes">Send</button></div>`;
  els.messages.appendChild(card);
  scrollToBottom();
  const input = card.querySelector(".ask-input");
  input.focus();
  const submit = () => {
    ensurePort().postMessage({ type: "ui_result", id, data: { text: input.value } });
    card.querySelectorAll("input,button").forEach((b) => (b.disabled = true));
    const note = document.createElement("div");
    note.className = "confirm-note";
    note.textContent = "✓ Sent";
    card.appendChild(note);
  };
  card.querySelector(".confirm-yes").addEventListener("click", submit);
  input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
}

function renderConfirm(id, detail) {
  clearWelcome();
  const card = document.createElement("div");
  card.className = "confirm-card";
  card.innerHTML =
    `<div class="confirm-title">⚠️ Confirm action</div>` +
    `<div class="confirm-detail">${formatText(detail)}</div>` +
    `<div class="confirm-actions"><button class="confirm-yes">Approve</button><button class="confirm-no">Reject</button></div>`;
  els.messages.appendChild(card);
  scrollToBottom();
  const respond = (approved) => {
    ensurePort().postMessage({ type: "ui_result", id, data: { approved } });
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

// ---- status -----------------------------------------------------------------

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
  if (!v) {
    setStatus("");
    els.input.focus();
  }
}
function setUsage(total, cost) {
  if (!total) return;
  els.usage.hidden = false;
  const c = cost ? ` · $${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3)}` : "";
  els.usage.textContent = `${total.toLocaleString()} tok${c}`;
}

// ---- port messages ----------------------------------------------------------

function onPortMessage(msg) {
  switch (msg.type) {
    case "thinking":
      setStatus("Thinking…");
      break;
    case "thinking_pause":
      setStatus("Waiting for you…");
      break;
    case "confirm":
      setStatus("Waiting for you…");
      renderConfirm(msg.id, msg.detail);
      break;
    case "plan":
      setStatus("Waiting for plan approval…");
      renderPlan(msg.id, msg.goal, msg.steps);
      break;
    case "ask":
      setStatus("Waiting for your answer…");
      renderAsk(msg.id, msg.question);
      break;
    case "tool":
      setStatus(`${TOOL_LABELS[msg.name] || msg.name}…`);
      addActivity(msg.name, msg.args, msg.declined);
      break;
    case "tool_result":
      setActivityResult(msg.result, msg.thumb);
      break;
    case "usage":
      setUsage(msg.total, msg.cost);
      break;
    case "picked":
      if (msg.ok) {
        const ref = msg.label ? `the "${msg.label}" ${msg.kind || "element"}` : msg.desc;
        els.input.value = (els.input.value ? els.input.value + " " : "") + `Click ${ref}`;
        autoResize();
        els.input.focus();
      }
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
    case "run_prompt": // scheduled task fired
      if (msg.text) sendMessage(msg.text);
      break;
    case "recording_update":
      if (msg.count) els.recordBar.querySelector(".rec-text").textContent = `Recording… ${msg.count} step(s)`;
      break;
    case "site_memories":
      // Could show a subtle indicator; for now just log
      if (msg.count > 0) console.log(`[Glide] ${msg.count} memory(ies) loaded for ${msg.site}`);
      break;
    case "suggestions":
      if (!busy) renderSuggestions(msg.items || []);
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
  lastUserText = value;
  addMessage("user", value);
  els.input.value = "";
  autoResize();
  setBusy(true);
  setStatus("Thinking…");
  ensurePort().postMessage({ type: "user_message", text: value });
}

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
  els.usage.hidden = true;
  location.reload();
});
els.openOptions.addEventListener("click", () => {
  if (api.runtime.openOptionsPage) api.runtime.openOptionsPage();
});
els.fillProfile.addEventListener("click", () => {
  if (api.runtime.openOptionsPage) api.runtime.openOptionsPage();
});

// ---- confirm-mode dropdown --------------------------------------------------

async function loadConfirmMode() {
  const s = await api.storage.local.get(["confirmMode"]);
  els.confirmMode.value = s.confirmMode || "risky";
}
els.confirmMode.addEventListener("change", () => {
  api.storage.local.set({ confirmMode: els.confirmMode.value });
});

// ---- provider / key / model configuration -----------------------------------

async function backendBase() {
  const s = await api.storage.local.get(["backendUrl"]);
  return (s.backendUrl || "http://localhost:8787").replace(/\/+$/, "");
}
async function getStored() {
  const s = await api.storage.local.get(["provider", "apiKeys", "model", "backendUrl"]);
  const provider = s.provider || "gemini";
  return { provider, apiKeys: s.apiKeys || {}, apiKey: (s.apiKeys || {})[provider] || "", model: s.model || "", backendUrl: s.backendUrl || "http://localhost:8787" };
}
// Ask the backend which models this provider + key can use.
async function fetchModels(backendUrl, provider, apiKey, customUrl) {
  const r = await fetch(`${backendUrl}/api/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, apiKey, customUrl }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j.models || [];
}
function shortModel(m) {
  return m.replace(/^gemini-/, "").replace(/^models\//, "");
}
// Populate the header model dropdown from the configured provider + key.
async function loadModels() {
  const url = await backendBase();
  const { provider, apiKey, model } = await getStored();
  if (!apiKey && provider !== "ollama") return false;
  try {
    const models = await fetchModels(url, provider, apiKey);
    if (!models.length) return false;
    els.modelSelect.innerHTML = models.map((m) => `<option value="${m}">${shortModel(m)}</option>`).join("");
    els.modelSelect.value = models.includes(model) ? model : models[0];
    if (!models.includes(model)) api.storage.local.set({ model: models[0] });
    els.modelSelect.hidden = false;
    return true;
  } catch (_) {
    return false;
  }
}
els.modelSelect.addEventListener("change", () => {
  api.storage.local.set({ model: els.modelSelect.value });
});

// ---- skills (saved prompt macros) -------------------------------------------

async function getSkills() {
  const s = await api.storage.local.get(["skills"]);
  return Array.isArray(s.skills) ? s.skills : [];
}

let lastSuggestionItems = [];
function renderSuggestions(items) {
  if (!items.length) { els.suggestionsBar.hidden = true; return; }
  if (JSON.stringify(items) === JSON.stringify(lastSuggestionItems) && !els.suggestionsBar.hidden) return;
  lastSuggestionItems = items;
  els.suggestionsBar.hidden = false;
  els.suggestionsBar.innerHTML = "";
  items.forEach((s) => {
    const chip = document.createElement("button");
    chip.className = "suggestion-chip";
    chip.textContent = "✦ " + s.label;
    chip.addEventListener("click", () => {
      els.suggestionsBar.hidden = true;
      sendMessage(s.prompt);
    });
    els.suggestionsBar.appendChild(chip);
  });
}

async function renderSkills() {
  const skills = await getSkills();
  if (!skills.length) {
    els.skillsBar.hidden = true;
    els.skillsBar.innerHTML = "";
    return;
  }
  els.skillsBar.hidden = false;
  els.skillsBar.innerHTML = "";
  skills.forEach((sk, i) => {
    const chip = document.createElement("button");
    chip.className = "skill-chip";
    chip.textContent = "⚡ " + sk.name;
    chip.title = sk.prompt;
    chip.addEventListener("click", () => sendMessage(sk.prompt));
    chip.addEventListener("contextmenu", async (e) => {
      e.preventDefault();
      if (confirm(`Delete skill "${sk.name}"?`)) {
        const all = await getSkills();
        all.splice(i, 1);
        await api.storage.local.set({ skills: all });
        renderSkills();
      }
    });
    els.skillsBar.appendChild(chip);
  });
}
els.saveSkill.addEventListener("click", async () => {
  const prompt = els.input.value.trim() || lastUserText;
  if (!prompt) {
    alert("Type a request first (or send one), then save it as a skill.");
    return;
  }
  const name = window.prompt("Name this skill:", prompt.slice(0, 30));
  if (!name) return;
  const skills = await getSkills();
  skills.push({ name, prompt });
  await api.storage.local.set({ skills });
  renderSkills();
});

// ---- schedule a skill (chrome.alarms) ---------------------------------------

els.schedule.addEventListener("click", async () => {
  const skills = await getSkills();
  if (!skills.length) {
    alert("Save a skill first (⚡), then you can schedule it.");
    return;
  }
  const names = skills.map((s, i) => `${i + 1}. ${s.name}`).join("\n");
  const pick = window.prompt(`Which skill to schedule? Enter a number:\n${names}`);
  const idx = Number(pick) - 1;
  if (!skills[idx]) return;
  const mins = Number(window.prompt("Run every how many minutes? (min 1)", "60"));
  if (!mins || mins < 1) return;
  const s = await api.storage.local.get(["schedules"]);
  const schedules = s.schedules || [];
  const id = Date.now().toString(36);
  schedules.push({ id, name: skills[idx].name, prompt: skills[idx].prompt, mins });
  await api.storage.local.set({ schedules });
  try {
    api.alarms.create(`skill:${id}`, { periodInMinutes: mins, delayInMinutes: mins });
    alert(`Scheduled "${skills[idx].name}" every ${mins} min. Keep the panel open for auto-run, or you'll get a reminder.`);
  } catch (_) {
    alert("Could not create the schedule alarm.");
  }
});

// ---- voice dictation --------------------------------------------------------

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

// ---- element picker ---------------------------------------------------------

els.pick.addEventListener("click", () => {
  setStatus("Pick an element on the page…");
  ensurePort().postMessage({ type: "pick_element" });
});

// ---- workflow recorder -------------------------------------------------------

let isRecording = false;

els.recordWorkflow.addEventListener("click", async () => {
  if (isRecording) return;
  isRecording = true;
  els.recordBar.hidden = false;
  els.recordBar.querySelector(".rec-text").textContent = "Recording…";
  els.recordWorkflow.style.color = "var(--danger)";
  ensurePort().postMessage({ type: "user_message", text: "record_start" });
});

els.stopRecord.addEventListener("click", async () => {
  if (!isRecording) return;
  isRecording = false;
  els.recordBar.hidden = true;
  els.recordWorkflow.style.color = "";
  ensurePort().postMessage({ type: "user_message", text: "record_stop" });
  // Wait a moment for the result, then prompt for name
  setTimeout(async () => {
    const name = window.prompt("Name this workflow:");
    if (name) {
      ensurePort().postMessage({ type: "user_message", text: `workflow_save name="${name}"` });
    }
  }, 500);
});

els.workflowsList.addEventListener("click", async () => {
  const panel = els.workflowsPanel;
  if (!panel.hidden) { panel.hidden = true; return; }
  panel.hidden = false;
  const s = await api.storage.local.get(["workflows"]);
  const wfs = s.workflows || [];
  if (!wfs.length) {
    panel.innerHTML = '<div style="font-size:13px;color:var(--text-dim);padding:8px 0;">No saved workflows yet.</div>';
    return;
  }
  panel.innerHTML = "";
  wfs.forEach((wf) => {
    const item = document.createElement("div");
    item.className = "wf-item";
    item.innerHTML =
      `<div class="wf-info"><div class="wf-name">${escapeHtml(wf.name)}</div>` +
      `<div class="wf-meta">${wf.steps.length} steps · ${wf.site || "any site"}</div></div>` +
      `<div class="wf-actions">` +
      `<button class="wf-btn" title="Replay"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>` +
      `<button class="wf-btn" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` +
      `</div>`;
    item.querySelector("[title=Replay]").addEventListener("click", () => {
      sendMessage(`Replay the workflow named "${wf.name}"`);
      panel.hidden = true;
    });
    item.querySelector("[title=Delete]").addEventListener("click", async () => {
      if (!confirm(`Delete workflow "${wf.name}"?`)) return;
      ensurePort().postMessage({ type: "user_message", text: `workflow_delete id="${wf.id}"` });
      item.remove();
    });
    panel.appendChild(item);
  });
});

// ---- export chat ------------------------------------------------------------

els.exportChat.addEventListener("click", () => {
  if (!transcript.length) {
    alert("Nothing to export yet.");
    return;
  }
  const lines = [`# Glide chat — ${new Date().toLocaleString()}`, ""];
  for (const it of transcript) {
    if (it.t === "user") lines.push(`## 🧑 You`, "", it.text, "");
    else if (it.t === "assistant") lines.push(`## ✦ Glide`, "", it.text, "");
    else if (it.t === "error") lines.push(`> ⚠️ ${it.text}`, "");
    else if (it.t === "tool") lines.push(`- 🔧 ${TOOL_LABELS[it.name] || it.name} ${it.result ? "— " + it.result.split("\n")[0] : ""}`);
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `glide-chat-${Date.now()}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ---- AI setup (provider + key + model) --------------------------------------

let obModels = [];

function populateProviders() {
  els.obProvider.innerHTML = Object.entries(PROVIDER_INFO)
    .map(([id, info]) => `<option value="${id}">${info.label}</option>`)
    .join("");
}
function onProviderChange() {
  const info = PROVIDER_INFO[els.obProvider.value];
  els.obKeyWrap.style.display = info.needsKey ? "" : "none";
  els.obCustomUrlWrap.hidden = !info.custom;
  if (info.custom) {
    els.obKeyHint.innerHTML = `Enter any OpenAI-compatible API endpoint and key. Works with DeepSeek, Together, Fireworks, vLLM, LM Studio, text-generation-webui, etc.`;
  } else if (info.needsKey) {
    els.obKeyHint.innerHTML = `Get a key: <a href="${info.url}" target="_blank" rel="noopener">${info.url.replace("https://", "")}</a>`;
  } else {
    els.obKeyHint.innerHTML = `Install Ollama and run <code>ollama serve</code> — no key needed. <a href="${info.url}" target="_blank" rel="noopener">Download</a>`;
  }
  els.obModelWrap.hidden = true;
  els.obDone.disabled = true;
  els.obStatus.textContent = "";
}
async function obConnect() {
  const provider = els.obProvider.value;
  const info = PROVIDER_INFO[provider];
  const apiKey = els.obKey.value.trim();
  const customUrl = els.obCustomUrl.value.trim();
  const url = els.obBackend.value.trim().replace(/\/+$/, "") || "http://localhost:8787";
  if (info.needsKey && !apiKey) {
    els.obStatus.textContent = "Paste your API key first.";
    els.obStatus.className = "ob-status err";
    return;
  }
  if (info.custom && !customUrl) {
    els.obStatus.textContent = "Enter the API base URL first.";
    els.obStatus.className = "ob-status err";
    return;
  }
  els.obStatus.textContent = "Connecting…";
  els.obStatus.className = "ob-status";
  els.obConnect.disabled = true;
  try {
    obModels = await fetchModels(url, provider, apiKey, customUrl);
    if (!obModels.length) throw new Error("No models returned");
    els.obModel.innerHTML = obModels.map((m) => `<option value="${m}">${shortModel(m)}</option>`).join("");
    els.obModelWrap.hidden = false;
    els.obStatus.textContent = `✓ Connected — ${obModels.length} models`;
    els.obStatus.className = "ob-status ok";
    els.obDone.disabled = false;
  } catch (err) {
    els.obStatus.textContent = `✕ ${String(err.message || err).slice(0, 80)}`;
    els.obStatus.className = "ob-status err";
  } finally {
    els.obConnect.disabled = false;
  }
}
async function saveSetup() {
  const provider = els.obProvider.value;
  const apiKey = els.obKey.value.trim();
  const customUrl = els.obCustomUrl.value.trim();
  const url = els.obBackend.value.trim().replace(/\/+$/, "") || "http://localhost:8787";
  const model = els.obModel.value || (obModels[0] || "");
  const s = await api.storage.local.get(["apiKeys"]);
  const apiKeys = s.apiKeys || {};
  if (apiKey) apiKeys[provider] = apiKey;
  const toSave = { provider, apiKeys, model, backendUrl: url, onboarded: true };
  if (customUrl) toSave.customBaseUrl = customUrl;
  await api.storage.local.set(toSave);
  els.onboarding.hidden = true;
  loadModels();
}
async function openSetup() {
  const { provider, apiKey, backendUrl } = await getStored();
  populateProviders();
  els.obProvider.value = provider;
  els.obBackend.value = backendUrl;
  els.obKey.value = apiKey;
  onProviderChange();
  els.onboarding.hidden = false;
}
async function maybeOnboard() {
  populateProviders();
  const { provider, apiKey } = await getStored();
  const reachable = await loadModels();
  const needsKey = PROVIDER_INFO[provider]?.needsKey !== false;
  if (!reachable && (!apiKey && needsKey)) {
    openSetup();
  }
}
els.obProvider.addEventListener("change", onProviderChange);
els.obConnect.addEventListener("click", obConnect);
els.obKey.addEventListener("keydown", (e) => e.key === "Enter" && obConnect());
els.obDone.addEventListener("click", saveSetup);
els.aiSetup.addEventListener("click", openSetup);

// ---- context-menu prefill ("Ask Glide about selection") ---------------------

async function loadPendingAsk() {
  const s = await api.storage.local.get(["pendingAsk"]);
  if (s.pendingAsk) {
    els.input.value = s.pendingAsk;
    autoResize();
    await api.storage.local.remove(["pendingAsk"]);
    els.input.focus();
  }
}

// ---- init -------------------------------------------------------------------

connect();
setBusy(false);
restoreTranscript();
loadConfirmMode();
renderSkills();
maybeOnboard();
loadPendingAsk();
els.input.focus();
