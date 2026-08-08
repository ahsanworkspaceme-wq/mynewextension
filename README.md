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
- 👁️ **Vision mode** — Gemini is multimodal, so the agent can take a **screenshot**,
  *see* the page, and click/type by **pixel coordinates** — for canvas apps, maps,
  and custom widgets where DOM reading isn't enough.
- 🖼️ **iframe & shadow DOM aware** — reads and acts inside same-origin iframes and
  open shadow roots, not just the top document.
- 🛡️ **Safety confirmations** — optionally asks before risky actions (navigating,
  submitting forms) or before every action. Configurable.
- ✨ **Visual highlight** — flashes the element (or the exact spot) it's about to
  interact with, so you can watch what it does.
- 🧠 **Plans first** — for non-trivial tasks it proposes a step-by-step plan and
  waits for your **Approve / Make changes** before acting.
- 🖐️ **Animated cursor + drag** — a visible agent cursor glides to each target,
  and it can drag on canvas UIs (sliders, node editors like **n8n**).
- 💾 **Long-term memory** — `remember` / `recall`; saved notes are recalled in
  future chats.
- ⚡ **Skills & schedules** — save a request as a reusable skill (⚡) and schedule
  it to run on an interval (⏰).
- 🔌 **API connector** — `http_request` lets it call REST APIs/webhooks (e.g. build
  an **n8n** workflow via the n8n API — more reliable than dragging nodes).
- 📄 **PDF & structured data** — reads PDFs and extracts tables/lists/links.
- 🙋 **Handover** — pauses and asks you for CAPTCHAs, 2FA, or decisions (`ask_user`).
- 📊 **Token usage** shown live in the header.
- 🗂️ **Multi-tab** — opens new tabs and switches between them to research across
  several sites and compile the results (`list_tabs`, `open_tab`, `switch_tab`, `close_tab`).
- ⚡ **Power mode (Chrome)** — optional OS-level mouse/keyboard input via the
  debugger API, which also enables clicking inside **cross-origin iframes**.
- 🚫 **Blocked & per-site access** — refuses to act on sensitive sites (banking,
  etc.) and can ask for approval before acting on each new site.
- 🛡️ **Prompt-injection defense** — page text is delimited as untrusted data and
  the model is instructed never to obey instructions found in page content.
- ⬇️ **Downloads** — can download files; opens the OS file chooser for uploads.
- ⏹️ **Stop button** — interrupt a running task at any time.
- 💾 **Conversation persists** — the chat survives closing/reopening the panel.
- 🎤 **Voice input** — dictate your request (Chrome Web Speech API).
- ⌨️ **Keyboard shortcut** — `Ctrl/Cmd + Shift + K` opens the side panel.
- 🔁 **Agentic loop** — it takes one step, re-reads the page (or re-screenshots),
  and continues until the task is done (bounded by a max-steps safety limit).
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

### 2. Build the extension icons (one time)

The icons are generated (not committed as binaries), so create them once:

```bash
npm run icons        # from the repo root — writes extension/icons/*.png
```

> Skip this and Chrome will refuse to load the extension with a
> "Could not load icon" error, since `manifest.json` references those files.

### 3. Load the extension

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

### 4. Use it

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
4. Gemini replies with either a **text answer** or a **tool call**. Tools come in
   two flavours:
   - **DOM / index** — `click`, `type_text` using the indexed element list.
   - **Vision / coordinate** — `screenshot` to see the page, then `click_at` /
     `type_at` using pixel coordinates read off the image.
   - plus `scroll`, `navigate`, `go_back`, `wait`.
5. If it's a tool call, the extension executes it on the page via the **content
   script** (highlighting the target first, and asking you to confirm if the
   action is risky), captures the result, and loops back to step 3. A
   `screenshot` result attaches the image so Gemini can see the page.
6. When Gemini returns plain text, that's shown as the final answer.

### Settings (⚙ in the side panel)

- **Backend URL** — where your server runs.
- **Max agent steps** — safety cap on actions per request.
- **Confirm before actions** — `Never`, `Risky only` (default: ask before
  navigating & submitting), or `Every action`.
- **Per-site access** — act on any site, or ask before each new site (remembered).
- **Blocked sites** — comma-separated hostnames the agent will refuse to act on.
- **Power mode (Chrome only)** — OS-level input via the debugger API; enables
  cross-origin iframe clicks. Grants the `debugger` permission on enable and shows
  Chrome's debugging banner while active.

### Extras

- **Keyboard shortcut:** `Ctrl+Shift+K` (macOS `Cmd+Shift+K`) opens the panel.
- **Voice:** click 🎤 to dictate (Chrome).
- **Stop:** click ■ Stop to interrupt a running task.
- **Persistence:** your conversation is saved; "＋ New chat" clears it.

### Honest limitations

- **Cross-origin iframes** only work in **Power mode** (Chrome debugger). Without
  it, only same-origin iframes are actionable — a browser security boundary.
- **File upload** can't be automated for security; the agent opens the OS file
  picker and you choose the file.
- Advanced features (power mode, side panel, voice) are **Chrome/Edge**-first;
  Firefox supports the core agent but not the debugger API or Web Speech.

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
