// providers.js — multi-provider LLM backend for Glide.
// Provider, API key, and model can come FROM THE REQUEST (configured in the
// extension UI) and fall back to backend/.env. The extension always speaks
// Gemini's canonical format; this module translates to/from each provider so any
// key works: Gemini, OpenAI, Anthropic (Claude), OpenRouter, Groq, Mistral,
// and Ollama (local).

const BASES = {
  gemini: { kind: "gemini", base: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "gemini-flash-latest", envKey: "GEMINI_API_KEY" },
  openai: { kind: "openai", base: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", envKey: "OPENAI_API_KEY" },
  openrouter: { kind: "openai", base: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4o-mini", envKey: "OPENROUTER_API_KEY" },
  groq: { kind: "openai", base: "https://api.groq.com/openai/v1", defaultModel: "llama-3.1-8b-instant", envKey: "GROQ_API_KEY" },
  mistral: { kind: "openai", base: "https://api.mistral.ai/v1", defaultModel: "mistral-large-latest", envKey: "MISTRAL_API_KEY" },
  ollama: { kind: "openai", base: "http://localhost:11434/v1", defaultModel: "llama3.2", envKey: null },
  anthropic: { kind: "anthropic", base: "https://api.anthropic.com/v1", defaultModel: "claude-3-5-sonnet-latest", envKey: "ANTHROPIC_API_KEY" },
  deepseek: { kind: "openai", base: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", envKey: "DEEPSEEK_API_KEY" },
  cohere: { kind: "openai", base: "https://api.cohere.com/v2", defaultModel: "command-r-plus", envKey: "COHERE_API_KEY" },
  together: { kind: "openai", base: "https://api.together.xyz/v1", defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", envKey: "TOGETHER_API_KEY" },
  fireworks: { kind: "openai", base: "https://api.fireworks.ai/inference/v1", defaultModel: "accounts/fireworks/models/llama-v3p1-70b-instruct", envKey: "FIREWORKS_API_KEY" },
  huggingface: { kind: "openai", base: "https://api-inference.huggingface.co/v1", defaultModel: "meta-llama/Meta-Llama-3.1-8B-Instruct", envKey: "HF_API_KEY" },
  novita: { kind: "openai", base: "https://api.novita.ai/v3/openai", defaultModel: "meta-llama/llama-3.1-70b-instruct", envKey: "NOVITA_API_KEY" },
  chutes: { kind: "openai", base: "https://api.chutes.ai/v1", defaultModel: "deepseek-ai/DeepSeek-V3", envKey: "CHUTES_API_KEY" },
  custom: { kind: "openai", base: "", defaultModel: "", envKey: null },
};

export const PROVIDER_NAMES = Object.keys(BASES);

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Build the effective provider config from a request override or backend/.env.
export function resolveProvider(o = {}) {
  const name = (o.provider || process.env.PROVIDER || "gemini").toLowerCase();
  const b = BASES[name];
  if (!b) throw httpError(400, `Unknown provider "${name}". Use one of: ${PROVIDER_NAMES.join(", ")}`);
  let base = b.base;
  // Custom provider: use the URL from the request
  if (name === "custom" && o.customUrl) {
    base = o.customUrl.replace(/\/+$/, "");
  }
  if (name === "ollama" && process.env.OLLAMA_URL) base = process.env.OLLAMA_URL.replace(/\/+$/, "") + "/v1";
  const key = o.apiKey || (b.envKey ? process.env[b.envKey] : "ollama") || "";
  const model = o.model || process.env.MODEL || (name === "ollama" && process.env.OLLAMA_MODEL) || b.defaultModel;
  return { name, kind: b.kind, base, key, model };
}

// ---- helpers ----------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchRetry(url, opts, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const resp = await fetch(url, opts);
      if (resp.ok || (resp.status !== 429 && resp.status < 500)) return resp;
    } catch (e) {
      if (i === attempts) throw e;
    }
    if (i < attempts) await sleep(400 * 2 ** (i - 1));
  }
  return fetch(url, opts);
}
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
const decls = (tools) => tools?.[0]?.function_declarations || [];

// ---- Gemini -----------------------------------------------------------------

async function geminiChat(p, { contents, systemPrompt, tools }) {
  const payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    tools,
    tool_config: { function_calling_config: { mode: "AUTO" } },
    generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
  };
  const resp = await fetchRetry(`${p.base}/models/${p.model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": p.key },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw httpError(resp.status, data?.error?.message || `Gemini error ${resp.status}`);
  const cand = data?.candidates?.[0];
  return { parts: cand?.content?.parts || [{ text: `(No content. ${cand?.finishReason || ""})` }], usage: data?.usageMetadata, model: p.model };
}
async function geminiModels(p) {
  const r = await fetch(`${p.base}/models?pageSize=200`, { headers: { "x-goog-api-key": p.key } });
  const d = await r.json();
  if (!r.ok) throw httpError(r.status, d?.error?.message || "key rejected");
  return (d.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => /^gemini/.test(n) && !/embedding|aqa|image-generation/.test(n));
}

// ---- OpenAI-compatible ------------------------------------------------------

function toOpenAIMessages(contents, systemPrompt) {
  const msgs = [{ role: "system", content: systemPrompt }];
  let n = 0;
  let pending = [];
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
const imgPart = (p) => ({ type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } });
function openaiToolDefs(tools) {
  return decls(tools).map((d) => ({ type: "function", function: { name: d.name, description: d.description, parameters: toJsonSchema(d.parameters) || { type: "object", properties: {} } } }));
}
function authHeaders(p) {
  const h = { Authorization: `Bearer ${p.key}` };
  if (p.name === "openrouter") h["HTTP-Referer"] = "https://glide.local";
  return h;
}
async function openaiChat(p, { contents, systemPrompt, tools }) {
  const body = { model: p.model, messages: toOpenAIMessages(contents, systemPrompt), tools: openaiToolDefs(tools), tool_choice: "auto", temperature: 0.4 };
  const resp = await fetchRetry(`${p.base}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(p) }, body: JSON.stringify(body) });
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
  return { parts: parts.length ? parts : [{ text: "(no response)" }], usage: { promptTokenCount: u.prompt_tokens, candidatesTokenCount: u.completion_tokens, totalTokenCount: u.total_tokens }, model: p.model };
}
async function openaiModels(p) {
  const r = await fetch(`${p.base}/models`, { headers: authHeaders(p) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw httpError(r.status, d?.error?.message || "key rejected");
  return (d.data || d.models || []).map((m) => m.id || m.name).filter(Boolean).sort();
}

// ---- Anthropic --------------------------------------------------------------

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
const anthImg = (p) => ({ type: "image", source: { type: "base64", media_type: p.inlineData.mimeType, data: p.inlineData.data } });
function anthropicToolDefs(tools) {
  return decls(tools).map((d) => ({ name: d.name, description: d.description, input_schema: toJsonSchema(d.parameters) || { type: "object", properties: {} } }));
}
async function anthropicChat(p, { contents, systemPrompt, tools }) {
  const body = { model: p.model, max_tokens: 2048, system: systemPrompt, messages: toAnthropic(contents), tools: anthropicToolDefs(tools), tool_choice: { type: "auto" } };
  const resp = await fetchRetry(`${p.base}/messages`, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": p.key, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body) });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw httpError(resp.status, data?.error?.message || `Anthropic error ${resp.status}`);
  const parts = [];
  for (const b of data.content || []) {
    if (b.type === "text") parts.push({ text: b.text });
    else if (b.type === "tool_use") parts.push({ functionCall: { name: b.name, args: b.input || {} } });
  }
  const u = data.usage || {};
  return { parts: parts.length ? parts : [{ text: "(no response)" }], usage: { promptTokenCount: u.input_tokens, candidatesTokenCount: u.output_tokens, totalTokenCount: (u.input_tokens || 0) + (u.output_tokens || 0) }, model: p.model };
}
async function anthropicModels(p) {
  try {
    const r = await fetch(`${p.base}/models`, { headers: { "x-api-key": p.key, "anthropic-version": "2023-06-01" } });
    const d = await r.json();
    if (r.ok && (d.data || []).length) return d.data.map((m) => m.id);
    if (!r.ok) throw httpError(r.status, d?.error?.message || "key rejected");
  } catch (e) {
    if (e.status) throw e;
  }
  return ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-3-opus-latest"];
}

// ---- dispatch ---------------------------------------------------------------

export async function chat(o) {
  const p = resolveProvider(o);
  if (!p.key) throw httpError(400, `No API key for provider "${p.name}". Add it in Glide's settings.`);
  if (p.kind === "gemini") return geminiChat(p, o);
  if (p.kind === "anthropic") return anthropicChat(p, o);
  return openaiChat(p, o);
}

export async function listModels(o) {
  const p = resolveProvider(o);
  if (!p.key) throw httpError(400, `No API key for provider "${p.name}".`);
  if (p.kind === "gemini") return geminiModels(p);
  if (p.kind === "anthropic") return anthropicModels(p);
  return openaiModels(p);
}
