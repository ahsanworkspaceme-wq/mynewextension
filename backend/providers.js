// providers.js — multi-provider LLM backend for Glide.
// The extension always speaks Gemini's format (contents + functionCall/
// functionResponse). This module translates that canonical format to/from each
// provider so any API key works: Gemini, OpenAI, Anthropic (Claude), OpenRouter,
// Groq, Mistral, and Ollama (local).

const env = process.env;

// ---- provider registry ------------------------------------------------------

const REGISTRY = {
  gemini: { kind: "gemini", key: env.GEMINI_API_KEY, base: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "gemini-flash-latest" },
  openai: { kind: "openai", key: env.OPENAI_API_KEY, base: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  openrouter: { kind: "openai", key: env.OPENROUTER_API_KEY, base: "https://openrouter.ai/api/v1", defaultModel: "google/gemini-2.0-flash-exp:free" },
  groq: { kind: "openai", key: env.GROQ_API_KEY, base: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile" },
  mistral: { kind: "openai", key: env.MISTRAL_API_KEY, base: "https://api.mistral.ai/v1", defaultModel: "mistral-large-latest" },
  ollama: { kind: "openai", key: "ollama", base: (env.OLLAMA_URL || "http://localhost:11434") + "/v1", defaultModel: env.OLLAMA_MODEL || "llama3.1" },
  anthropic: { kind: "anthropic", key: env.ANTHROPIC_API_KEY, base: "https://api.anthropic.com/v1", defaultModel: "claude-3-5-sonnet-latest" },
};

export const PROVIDER = (env.PROVIDER || "gemini").toLowerCase();
export function activeProvider() {
  const p = REGISTRY[PROVIDER];
  if (!p) throw new Error(`Unknown PROVIDER "${PROVIDER}". Use: ${Object.keys(REGISTRY).join(", ")}`);
  return { name: PROVIDER, ...p, model: env.MODEL || p.defaultModel };
}

// ---- helpers ----------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url, opts, attempts = 3) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      const resp = await fetch(url, opts);
      if (resp.ok || (resp.status !== 429 && resp.status < 500)) return resp;
      last = `HTTP ${resp.status}`;
    } catch (e) {
      last = String(e?.message || e);
    }
    if (i < attempts) await sleep(400 * 2 ** (i - 1));
  }
  return fetch(url, opts); // final try, let caller read the error body
}

// Gemini (UPPERCASE) schema -> JSON Schema (lowercase types)
function toJsonSchema(s) {
  if (!s || typeof s !== "object") return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "type" && typeof v === "string") out[k] = v.toLowerCase();
    else if (k === "properties") {
      out[k] = {};
      for (const [pk, pv] of Object.entries(v)) out[k][pk] = toJsonSchema(pv);
    } else if (k === "items") out[k] = toJsonSchema(v);
    else out[k] = v;
  }
  return out;
}

function geminiDecls(tools) {
  return (tools?.[0]?.function_declarations) || [];
}

// ---- Gemini -----------------------------------------------------------------

let geminiModelCache = null;
async function geminiListModels(p) {
  if (geminiModelCache) return geminiModelCache;
  try {
    const r = await fetch(`${p.base}/models?pageSize=200`, { headers: { "x-goog-api-key": p.key } });
    const d = await r.json();
    const models = (d.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .filter((n) => /^gemini/.test(n) && !/embedding|aqa|image-generation/.test(n));
    if (models.length) geminiModelCache = models;
    return models;
  } catch (_) {
    return [];
  }
}
function geminiPick(models, prefer) {
  return (
    (prefer && models.includes(prefer) && prefer) ||
    models.find((m) => /flash-latest/.test(m)) ||
    models.find((m) => /2\.5-flash$/.test(m)) ||
    models.find((m) => /flash/.test(m)) ||
    models[0]
  );
}
async function geminiChat(p, { contents, model, systemPrompt, tools }) {
  const models = await geminiListModels(p);
  const useModel = models.length ? geminiPick(models, model || p.model) : model || p.model;
  const payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    tools,
    tool_config: { function_calling_config: { mode: "AUTO" } },
    generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
  };
  const resp = await fetchRetry(`${p.base}/models/${useModel}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": p.key },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw httpError(resp.status, data?.error?.message || `Gemini error ${resp.status}`);
  const cand = data?.candidates?.[0];
  return { parts: cand?.content?.parts || [{ text: `(No content. ${cand?.finishReason || ""})` }], usage: data?.usageMetadata, model: useModel };
}

// ---- OpenAI-compatible (openai/openrouter/groq/mistral/ollama) --------------

function toOpenAIMessages(contents, systemPrompt) {
  const msgs = [{ role: "system", content: systemPrompt }];
  let n = 0;
  let pending = []; // [{name,id,used}] from last assistant turn
  for (const c of contents) {
    const parts = c.parts || [];
    if (c.role === "model") {
      const text = parts.filter((x) => x.text).map((x) => x.text).join("");
      const calls = parts.filter((x) => x.functionCall).map((x) => x.functionCall);
      pending = [];
      const m = { role: "assistant" };
      if (text) m.content = text;
      if (calls.length) {
        m.tool_calls = calls.map((fc) => {
          const id = `call_${++n}`;
          pending.push({ name: fc.name, id, used: false });
          return { id, type: "function", function: { name: fc.name, arguments: JSON.stringify(fc.args || {}) } };
        });
        if (!text) m.content = null;
      }
      msgs.push(m);
    } else {
      const frs = parts.filter((x) => x.functionResponse);
      if (frs.length) {
        for (const p of frs) {
          const fr = p.functionResponse;
          const match = pending.find((t) => t.name === fr.name && !t.used);
          if (match) match.used = true;
          msgs.push({ role: "tool", tool_call_id: match ? match.id : `call_${++n}`, content: String(fr.response?.result ?? "") });
        }
        const imgs = parts.filter((x) => x.inlineData);
        if (imgs.length) msgs.push({ role: "user", content: imgs.map(imgPart) });
      } else {
        const content = [];
        for (const p of parts) {
          if (p.text) content.push({ type: "text", text: p.text });
          else if (p.inlineData) content.push(imgPart(p));
        }
        msgs.push({ role: "user", content: content.length === 1 && content[0].type === "text" ? content[0].text : content });
      }
    }
  }
  return msgs;
}
function imgPart(p) {
  return { type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } };
}
function openaiTools(tools) {
  return geminiDecls(tools).map((d) => ({
    type: "function",
    function: { name: d.name, description: d.description, parameters: toJsonSchema(d.parameters) || { type: "object", properties: {} } },
  }));
}
async function openaiListModels(p) {
  try {
    const r = await fetch(`${p.base}/models`, { headers: authHeaders(p) });
    const d = await r.json();
    const ids = (d.data || d.models || []).map((m) => m.id || m.name).filter(Boolean);
    return ids;
  } catch (_) {
    return [];
  }
}
async function openaiChat(p, { contents, model, systemPrompt, tools }) {
  const useModel = model || p.model;
  const body = {
    model: useModel,
    messages: toOpenAIMessages(contents, systemPrompt),
    tools: openaiTools(tools),
    tool_choice: "auto",
    temperature: 0.4,
  };
  const resp = await fetchRetry(`${p.base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(p) },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw httpError(resp.status, data?.error?.message || `${p.name} error ${resp.status}`);
  const msg = data.choices?.[0]?.message || {};
  const parts = [];
  for (const tc of msg.tool_calls || []) {
    let args = {};
    try {
      args = JSON.parse(tc.function.arguments || "{}");
    } catch (_) {}
    parts.push({ functionCall: { name: tc.function.name, args } });
  }
  if (msg.content) parts.push({ text: msg.content });
  const u = data.usage || {};
  return {
    parts: parts.length ? parts : [{ text: "(no response)" }],
    usage: { promptTokenCount: u.prompt_tokens, candidatesTokenCount: u.completion_tokens, totalTokenCount: u.total_tokens },
    model: useModel,
  };
}
function authHeaders(p) {
  const h = { Authorization: `Bearer ${p.key}` };
  if (p.name === "openrouter") h["HTTP-Referer"] = "https://glide.local"; // OpenRouter attribution (optional)
  return h;
}

// ---- Anthropic (Claude) -----------------------------------------------------

function toAnthropic(contents) {
  const messages = [];
  let n = 0;
  let pending = [];
  for (const c of contents) {
    const parts = c.parts || [];
    if (c.role === "model") {
      pending = [];
      const content = [];
      for (const p of parts) {
        if (p.text) content.push({ type: "text", text: p.text });
        else if (p.functionCall) {
          const id = `toolu_${++n}`;
          pending.push({ name: p.functionCall.name, id, used: false });
          content.push({ type: "tool_use", id, name: p.functionCall.name, input: p.functionCall.args || {} });
        }
      }
      messages.push({ role: "assistant", content });
    } else {
      const frs = parts.filter((x) => x.functionResponse);
      const content = [];
      if (frs.length) {
        for (const p of frs) {
          const fr = p.functionResponse;
          const match = pending.find((t) => t.name === fr.name && !t.used);
          if (match) match.used = true;
          content.push({ type: "tool_result", tool_use_id: match ? match.id : `toolu_${++n}`, content: String(fr.response?.result ?? "") });
        }
        for (const p of parts.filter((x) => x.inlineData)) content.push(anthImg(p));
      } else {
        for (const p of parts) {
          if (p.text) content.push({ type: "text", text: p.text });
          else if (p.inlineData) content.push(anthImg(p));
        }
      }
      messages.push({ role: "user", content });
    }
  }
  return messages;
}
function anthImg(p) {
  return { type: "image", source: { type: "base64", media_type: p.inlineData.mimeType, data: p.inlineData.data } };
}
function anthropicTools(tools) {
  return geminiDecls(tools).map((d) => ({ name: d.name, description: d.description, input_schema: toJsonSchema(d.parameters) || { type: "object", properties: {} } }));
}
async function anthropicListModels(p) {
  try {
    const r = await fetch(`${p.base}/models`, { headers: { "x-api-key": p.key, "anthropic-version": "2023-06-01" } });
    const d = await r.json();
    const ids = (d.data || []).map((m) => m.id).filter(Boolean);
    if (ids.length) return ids;
  } catch (_) {}
  return ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-3-opus-latest"];
}
async function anthropicChat(p, { contents, model, systemPrompt, tools }) {
  const useModel = model || p.model;
  const body = {
    model: useModel,
    max_tokens: 2048,
    system: systemPrompt,
    messages: toAnthropic(contents),
    tools: anthropicTools(tools),
    tool_choice: { type: "auto" },
  };
  const resp = await fetchRetry(`${p.base}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": p.key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw httpError(resp.status, data?.error?.message || `Anthropic error ${resp.status}`);
  const parts = [];
  for (const b of data.content || []) {
    if (b.type === "text") parts.push({ text: b.text });
    else if (b.type === "tool_use") parts.push({ functionCall: { name: b.name, args: b.input || {} } });
  }
  const u = data.usage || {};
  return {
    parts: parts.length ? parts : [{ text: "(no response)" }],
    usage: { promptTokenCount: u.input_tokens, candidatesTokenCount: u.output_tokens, totalTokenCount: (u.input_tokens || 0) + (u.output_tokens || 0) },
    model: useModel,
  };
}

// ---- dispatch ---------------------------------------------------------------

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export async function listModels() {
  const p = activeProvider();
  if (p.kind === "gemini") return geminiListModels(p);
  if (p.kind === "anthropic") return anthropicListModels(p);
  return openaiListModels(p);
}

export async function chat({ contents, model, systemPrompt, tools }) {
  const p = activeProvider();
  if (!p.key) throw httpError(500, `No API key set for provider "${p.name}". Add it to backend/.env.`);
  if (p.kind === "gemini") return geminiChat(p, { contents, model, systemPrompt, tools });
  if (p.kind === "anthropic") return anthropicChat(p, { contents, model, systemPrompt, tools });
  return openaiChat(p, { contents, model, systemPrompt, tools });
}

export async function defaultModel() {
  const p = activeProvider();
  const models = await listModels();
  if (!models.length) return p.model;
  if (models.includes(p.model)) return p.model;
  if (p.kind === "gemini") return geminiPick(models, p.model);
  return models[0];
}
