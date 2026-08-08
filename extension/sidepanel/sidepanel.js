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
  modelBadge: document.getElementById("modelBadge"),
  saveSkill: document.getElementById("saveSkill"),
  schedule: document.getElementById("schedule"),
  skillsBar: document.getElementById("skillsBar"),
  confirmMode: document.getElementById("confirmMode"),
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

// Premium-style activity labels (verb phrases like Claude's feed)
const TOOL_LABELS = {
  get_page_state: "Reading page",
  screenshot: "Capturing page",
  click: "Clicking",
  click_at: "Clicking",
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
  remember: "Saving to memory",
  recall: "Recalling memory",
  wait: "Waiting",
};
const TOOL_ICON = {
  screenshot: "📸",
  read_pdf: "📄",
  extract_data: "📊",
  http_request: "🔌",
  remember: "💾",
  recall: "🧠",
  navigate: "🧭",
  open_tab: "🗂️",
  download: "⬇️",
};

function renderActivity(name, args, declined) {
  clearWelcome();
  const el = document.createElement("div");
  el.className = "activity";
  const label = TOOL_LABELS[name] || name;
  const icon = declined ? "🚫" : TOOL_ICON[name] || "•";
  const argStr = prettyArgs(args);
  el.innerHTML =
    `<span class="act-icon">${icon}</span>` +
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
    `<div class="plan-title">📋 Claude's plan${goal ? ": " + formatText(goal) : ""}</div>` +
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
function setUsage(total) {
  if (!total) return;
  els.usage.hidden = false;
  els.usage.textContent = `${total.toLocaleString()} tok`;
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
      setUsage(msg.total);
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

// ---- confirm-mode dropdown --------------------------------------------------

async function loadConfirmMode() {
  const s = await api.storage.local.get(["confirmMode"]);
  els.confirmMode.value = s.confirmMode || "risky";
}
els.confirmMode.addEventListener("change", () => {
  api.storage.local.set({ confirmMode: els.confirmMode.value });
});

// ---- model badge (from backend /health) -------------------------------------

async function loadModelBadge() {
  const s = await api.storage.local.get(["backendUrl"]);
  const url = (s.backendUrl || "http://localhost:8787").replace(/\/+$/, "");
  try {
    const r = await fetch(`${url}/health`);
    const j = await r.json();
    if (j.model) {
      const span = els.modelBadge.querySelector("span");
      if (span) span.textContent = j.model;
      els.modelBadge.hidden = false;
    }
  } catch (_) {}
}

// ---- skills (saved prompt macros) -------------------------------------------

async function getSkills() {
  const s = await api.storage.local.get(["skills"]);
  return Array.isArray(s.skills) ? s.skills : [];
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

// ---- init -------------------------------------------------------------------

connect();
setBusy(false);
restoreTranscript();
loadConfirmMode();
loadModelBadge();
renderSkills();
els.input.focus();
