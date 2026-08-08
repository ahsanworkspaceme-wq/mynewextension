// server.js — secure proxy between the browser extension and the Gemini API.
// The extension never sees the API key; it only talks to this server.
//
// POST /api/chat  { contents: [...] }  ->  { parts: [...] }
//   `contents` is the running Gemini conversation (user/model/functionResponse).
//   This server injects the system prompt + tool declarations and returns the
//   model's next set of parts (text and/or functionCall).

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const {
  GEMINI_API_KEY,
  GEMINI_MODEL = "gemini-2.5-flash",
  PORT = 8787,
  ALLOWED_ORIGINS = "*",
} = process.env;

if (!GEMINI_API_KEY) {
  console.error("\n❌  GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.\n");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "2mb" }));

const origins = ALLOWED_ORIGINS.trim();
app.use(
  cors({
    origin: origins === "*" ? true : origins.split(",").map((s) => s.trim()),
  })
);

// ---- system prompt ----------------------------------------------------------

const SYSTEM_PROMPT = `You are "Gemini Agent", an AI assistant embedded in a browser side panel. You help the user with the web page they are currently viewing and can take actions in their browser on their behalf.

You are given the current page's state (URL, title, an indexed list of interactive elements, and visible text) attached to the user's message. Interactive elements are listed as:
  [index] <kind> "label"
Use the numeric index to act on an element.

You have these tools:
- get_page_state(): Re-read the current page. Call this after any action that changes the page (click, type+submit, navigate, scroll) so your element indices are fresh. Indices become stale after the page changes.
- click(index): Click the element with that index.
- type_text(index, text, submit?): Type text into an input/textarea/contenteditable. Set submit=true to press Enter afterwards (e.g. to run a search).
- scroll(direction, pixels?): Scroll "up" or "down" to reveal more of the page.
- navigate(url): Load a different URL in the current tab.
- go_back(): Go to the previous page.
- wait(seconds): Pause briefly for the page to update (max 8s).

Guidelines:
- Think step by step. To accomplish a task, take ONE action at a time, then re-read the page state to see the result before the next action.
- Only act when the user asks you to DO something. For pure questions ("summarize this", "what does this say"), just answer from the page state — don't take actions.
- After acting, always confirm what happened by reading the new state before claiming success.
- Element indices are only valid for the most recently reported state. If an index might be stale, call get_page_state first.
- Be concise and friendly in your final answers. Reply in the same language the user writes in (English, Urdu/Hindi, etc.).
- If a page is a browser-internal page (chrome://, about:) you cannot read or act on it — say so.
- Never invent information that isn't in the page. If you can't find something, say so and suggest what to do.
- When you have completed the task or answered the question, respond with a normal text message (no tool call).`;

// ---- tool declarations ------------------------------------------------------

const TOOLS = [
  {
    function_declarations: [
      {
        name: "get_page_state",
        description:
          "Re-read the current page and return its URL, title, indexed interactive elements, and visible text. Call after any action that changes the page.",
        parameters: { type: "OBJECT", properties: {} },
      },
      {
        name: "click",
        description: "Click the interactive element with the given index from the page state.",
        parameters: {
          type: "OBJECT",
          properties: {
            index: { type: "INTEGER", description: "The [index] of the element to click." },
          },
          required: ["index"],
        },
      },
      {
        name: "type_text",
        description:
          "Type text into an input, textarea, or contenteditable element identified by its index. Optionally submit (press Enter) afterwards.",
        parameters: {
          type: "OBJECT",
          properties: {
            index: { type: "INTEGER", description: "The [index] of the field to type into." },
            text: { type: "STRING", description: "The text to type." },
            submit: {
              type: "BOOLEAN",
              description: "If true, press Enter after typing (e.g. to submit a search).",
            },
          },
          required: ["index", "text"],
        },
      },
      {
        name: "scroll",
        description: "Scroll the page up or down to reveal more content.",
        parameters: {
          type: "OBJECT",
          properties: {
            direction: { type: "STRING", enum: ["up", "down"], description: "Scroll direction." },
            pixels: { type: "INTEGER", description: "Optional pixel amount. Defaults to ~80% of the viewport." },
          },
          required: ["direction"],
        },
      },
      {
        name: "navigate",
        description: "Load a different URL in the current browser tab.",
        parameters: {
          type: "OBJECT",
          properties: {
            url: { type: "STRING", description: "The URL to open. https:// is added if missing." },
          },
          required: ["url"],
        },
      },
      {
        name: "go_back",
        description: "Navigate back to the previous page in the tab's history.",
        parameters: { type: "OBJECT", properties: {} },
      },
      {
        name: "wait",
        description: "Pause for a few seconds to let the page finish updating.",
        parameters: {
          type: "OBJECT",
          properties: {
            seconds: { type: "INTEGER", description: "Seconds to wait (max 8)." },
          },
          required: ["seconds"],
        },
      },
    ],
  },
];

const GEMINI_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// ---- routes -----------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({ ok: true, model: GEMINI_MODEL });
});

app.post("/api/chat", async (req, res) => {
  const { contents } = req.body || {};
  if (!Array.isArray(contents) || contents.length === 0) {
    return res.status(400).json({ error: "Body must include a non-empty `contents` array." });
  }

  const payload = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents,
    tools: TOOLS,
    tool_config: { function_calling_config: { mode: "AUTO" } },
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 2048,
    },
  };

  try {
    const resp = await fetch(GEMINI_URL(GEMINI_MODEL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    if (!resp.ok) {
      const message = data?.error?.message || `Gemini API error ${resp.status}`;
      console.error("Gemini error:", message);
      return res.status(resp.status).json({ error: message });
    }

    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    if (parts.length === 0) {
      const reason = candidate?.finishReason || "unknown";
      return res.json({
        parts: [{ text: `(The model returned no content. Finish reason: ${reason}.)` }],
        finishReason: reason,
      });
    }

    return res.json({
      parts,
      finishReason: candidate?.finishReason,
      usage: data?.usageMetadata,
    });
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(502).json({ error: `Failed to reach Gemini: ${String(err?.message || err)}` });
  }
});

app.listen(PORT, () => {
  console.log(`\n✦ Gemini Agent backend running on http://localhost:${PORT}`);
  console.log(`  Model: ${GEMINI_MODEL}`);
  console.log(`  Health check: http://localhost:${PORT}/health\n`);
});
