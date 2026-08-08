# ✦ Gemini Agent — AI Browser Assistant

An **agentic** AI assistant browser extension (Chrome + Firefox, Manifest V3),
inspired by Claude's browser extension but powered by **Gemini**. It lives in a
side panel, reads the page you're on, and can **take actions for you** — click
buttons, type into fields, scroll, and navigate — all driven by natural
language.

The Gemini API key lives on a small **backend server**, never inside the
extension, so your key stays secure.

```
┌──────────────────┐      ┌───────────────────┐      ┌─────────────┐
│  Extension        │      │  Backend server    │      │  Gemini API │
│ (Chrome+Firefox)  │─────▶│ (Node.js/Express)  │─────▶│             │
│  • Side panel chat│      │  • Holds API key   │      │             │
│  • Reads the page │◀─────│  • Injects tools   │◀─────│             │
│  • Runs actions   │      │  • /api/chat proxy │      │             │
└──────────────────┘      └───────────────────┘      └─────────────┘
```

## What it can do

- 💬 **Chat about the current page** — summarize, explain, translate, extract facts.
- 🖱️ **Take actions** — the agent can click, type + submit, scroll, and navigate
  to accomplish tasks like "search for X", "fill this form", "open the first result".
- 🔁 **Agentic loop** — it takes one step, re-reads the page, and continues until
  the task is done (bounded by a configurable max-steps safety limit).
- 🔒 **Key stays on the backend** — the extension only talks to your server.
- 🌗 **Light & dark** side panel UI.

---

## Quick start

### 1. Run the backend

```bash
cd backend
npm install
cp .env.example .env      # edit .env → paste your Gemini API key
npm start
```

Get a key at **https://aistudio.google.com/apikey**. See
[`backend/README.md`](backend/README.md) for details and deployment.

### 2. Load the extension

**Chrome / Edge**

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `extension/` folder
4. Click the extension's icon to open the side panel

**Firefox**

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select `extension/manifest.json`
4. Open the sidebar (View → Sidebar → Gemini Agent, or the toolbar icon)

### 3. Use it

Open the side panel on any web page and ask, e.g.:

- "Summarize this page."
- "Search this site for wireless headphones."
- "Click the login button."
- "Find the contact email on this page."

If the backend isn't running on the default `http://localhost:8787`, set the URL
in the extension's **Settings** (⚙ icon in the side panel).

---

## How it works

1. You type a message in the side panel.
2. The **background service worker** captures the current page's state (an
   indexed list of interactive elements + visible text) and sends it, with your
   message, to the backend.
3. The **backend** adds the system prompt + tool definitions and calls Gemini.
4. Gemini replies with either a **text answer** or a **tool call**
   (`click`, `type_text`, `scroll`, `navigate`, …).
5. If it's a tool call, the extension executes it on the page via the **content
   script**, captures the result, and loops back to step 3.
6. When Gemini returns plain text, that's shown as the final answer.

## Project structure

```
extension/
  manifest.json        Cross-browser MV3 manifest
  background.js        Agent orchestration loop (service worker)
  content.js           Reads page state + executes actions
  sidepanel/           Chat UI (html/css/js)
  options.html/.js     Settings (backend URL, max steps)
  icons/               Generated PNG icons
backend/
  server.js            Express proxy to Gemini (holds the API key)
  package.json
  .env.example
scripts/
  gen-icons.mjs        Regenerates the icons
```

## Security notes

- The API key is only ever on the backend. Keep `.env` out of git (it is
  `.gitignore`d).
- The agent can act on pages on your behalf — review what you ask it to do,
  especially on sites where you're logged in.
- For production, set `ALLOWED_ORIGINS` on the backend to your extension's
  origin instead of `*`.

## License

MIT
