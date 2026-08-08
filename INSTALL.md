# 📦 Glide — Complete Installation Guide

A full, step-by-step guide to get the **Glide** browser extension running
from scratch — backend + extension — on Chrome/Edge or Firefox.

> **Time needed:** ~10 minutes
> **You need:** a computer with internet, [Node.js 18+](https://nodejs.org),
> Chrome/Edge (or Firefox), and a free Gemini API key.

---

## Overview

The project has two parts that work together:

1. **Backend** — a tiny local server that holds your **Gemini API key** and talks
   to Google's Gemini API. (Your key never lives inside the extension.)
2. **Extension** — the browser side panel you chat with; it reads pages and takes
   actions, calling your backend for the AI.

```
Extension (browser)  ⇄  Backend (localhost:8787)  ⇄  Gemini API
```

You run the backend once, load the extension once, and you're set.

---

## Step 1 — Get the code

If you have `git`:

```bash
git clone https://github.com/ahsanworkspaceme-wq/mynewextension.git
cd mynewextension
```

Or download the repository as a ZIP from GitHub and unzip it, then open a terminal
in that folder.

---

## Step 2 — Get a free Gemini API key

1. Go to **https://aistudio.google.com/apikey**
2. Sign in with your Google account.
3. Click **Create API key** and copy it (looks like `AIza...`).

Keep it handy for the next step. **Never share this key or commit it to git.**

---

## Step 3 — Set up and run the backend

```bash
cd backend
npm install
cp .env.example .env
```

Now open `backend/.env` in any editor and paste your key:

```ini
GEMINI_API_KEY=AIza...your key here...
GEMINI_MODEL=gemini-2.5-flash
PORT=8787
ALLOWED_ORIGINS=*
```

Start it:

```bash
npm start
```

You should see:

```
✦ Glide backend running on http://localhost:8787
  Model: gemini-2.5-flash
```

**Verify** it works (in another terminal, or your browser):

```bash
curl http://localhost:8787/health
# {"ok":true,"model":"gemini-2.5-flash"}
```

> Leave this terminal running while you use the extension. To stop it, press
> `Ctrl+C`. To start it again later: `cd backend && npm start`.

---

## Step 4 — Build the extension icons (one time)

From the repository **root** (not the `backend` folder):

```bash
cd ..            # if you're still in backend/
npm run icons
```

This creates `extension/icons/*.png`. (They're generated, not committed.)

> Skip this and the browser will refuse to load the extension with a
> "Could not load icon" error.

---

## Step 5 — Load the extension in Chrome / Edge

1. Open a new tab and go to `chrome://extensions`
   (on Edge: `edge://extensions`).
2. Turn on **Developer mode** (toggle, top-right).
3. Click **Load unpacked**.
4. Select the **`extension`** folder inside the project (the folder that contains
   `manifest.json`).
5. The **Glide** card appears. Click its **✦ icon** in the toolbar to open
   the side panel. (If you don't see the icon, click the puzzle-piece 🧩 and pin it.)

**Shortcut:** press `Ctrl + Shift + K` (macOS `Cmd + Shift + K`) to open the panel
anytime.

### Firefox

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select `extension/manifest.json`
4. Open the sidebar: **View → Sidebar → Glide**.

> Firefox note: core chat + actions work. **Power mode** (debugger) and **voice**
> are Chrome/Edge only.

---

## Step 6 — Your first run (test safely)

1. Open any normal website (e.g. `https://en.wikipedia.org`).
2. Open the side panel.
3. Try a **read-only** request first:
   > "Summarize this page in 3 bullet points."
4. Then try an **action**:
   > "Type 'coffee' in the search box and search."

You'll see the agent's **activity feed** (Reading page, Capturing page, Clicking…)
and a moving cursor on the page. For risky steps it asks you to **Approve** first.

If the panel says it can't reach the backend, make sure Step 3 is still running and
that the **Backend URL** in Settings matches (default `http://localhost:8787`).

---

## Step 7 — Settings walkthrough (⚙ in the panel)

| Setting | What it does |
| --- | --- |
| **Backend URL** | Where your server runs. Default `http://localhost:8787`. |
| **Max agent steps** | Safety cap on actions per request (default 20–24). |
| **Confirm before actions** | `Ask before acting` (risky only), `Ask every step`, or `Act freely`. Also switchable from the pill at the bottom of the panel. |
| **Per-site access** | Act on any site, or ask before each new site (remembered). |
| **Blocked sites** | Comma-separated hostnames the agent will refuse to act on (e.g. banking). |
| **Power mode (Chrome)** | OS-level input via the debugger API; enables cross-origin iframe clicks. Grants the `debugger` permission and shows Chrome's debugging banner while active. |

---

## Feature quick-reference

- **🧠 Plans first** — for bigger tasks it shows a plan; click **Approve** or **Make changes**.
- **🖐️ Cursor + drag** — a visible cursor; can drag on canvas editors (n8n, etc.).
- **🗂️ Multi-tab** — "research these 3 sites and compare" opens/uses several tabs.
- **👁️ Vision** — it screenshots and clicks by sight when the DOM isn't enough.
- **💾 Memory** — "remember that I prefer metric units" persists across chats.
- **⚡ Skills** — click ⚡ to save a request; run it later from the chips row.
- **⏰ Schedule** — click ⏰ to run a saved skill on an interval.
- **🔌 API connector** — it can call REST APIs (`http_request`), e.g. build an **n8n**
  workflow via the n8n API.
- **📄 PDF / 📊 data** — reads PDFs and extracts tables/lists/links.
- **🙋 Handover** — pauses and asks you for CAPTCHAs / 2FA / decisions.
- **🎤 Voice** — dictate with the mic. **⏹️ Stop** — interrupt anytime.

---

## Using it with n8n (build workflows)

Two ways, and the agent will suggest the best one in its plan:

1. **Via the n8n UI** — screenshot + drag/click to place and connect nodes. Works,
   but complex workflows are fiddly (true for any browser agent on a canvas).
2. **Via the n8n API (recommended)** — ask it to build the workflow through n8n's
   REST API using `http_request`. Give it your n8n base URL and API key when asked;
   it can then create/import a workflow reliably as JSON.

Example prompt:
> "Plan and create an n8n workflow that posts a Slack message when a webhook fires.
> Use the n8n REST API — I'll give you the API key."

---

## Deploying the backend (optional)

To use it from anywhere, deploy `backend/` to any Node host:

- **Render / Railway / Fly.io:** start command `node server.js`, add
  `GEMINI_API_KEY` as an environment variable.
- Then set the extension's **Backend URL** (Settings) to your deployed URL, and set
  `ALLOWED_ORIGINS` on the server to your extension origin
  (`chrome-extension://<id>`).

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Could not reach the backend" | Make sure `npm start` is running in `backend/` and the URL matches Settings. |
| "Could not load icon" on load | Run `npm run icons` from the repo root, then reload the extension. |
| "API key not valid" | Re-check `GEMINI_API_KEY` in `backend/.env` and restart the backend. |
| Nothing happens on a page | Some pages (`chrome://`, the Web Store) block extensions. Try a normal site. |
| Can't click inside an embedded box (iframe) | Enable **Power mode** (Chrome) in Settings for cross-origin iframes. |
| CORS error in the backend logs | Set `ALLOWED_ORIGINS=*` for local dev (already the default). |
| Voice/mic missing | Web Speech API is Chrome/Edge only. |
| Debugging banner won't go away | That's Chrome's notice while Power mode is active; turn Power mode off in Settings to remove it. |

---

## Updating

```bash
git pull
cd backend && npm install   # if dependencies changed
npm run icons               # from repo root, if needed
```

Then reload the extension at `chrome://extensions` (click the ↻ on its card).

---

Enjoy your agent! For the architecture and full feature list, see the main
[README](README.md).
