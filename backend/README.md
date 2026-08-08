# Glide — Backend

A tiny Express server that sits between the browser extension and the Gemini
API. It holds your **Gemini API key** so the key is never shipped inside the
extension, and it injects the agent's system prompt and tool definitions.

## Setup

```bash
cd backend
npm install
cp .env.example .env      # then edit .env and paste your Gemini API key
npm start
```

Get a free API key from **https://aistudio.google.com/apikey**.

You should see:

```
✦ Glide backend running on http://localhost:8787
```

Test it:

```bash
curl http://localhost:8787/health
# {"ok":true,"model":"gemini-2.5-flash"}
```

## Environment variables

| Variable          | Default            | Description                                   |
| ----------------- | ------------------ | --------------------------------------------- |
| `GEMINI_API_KEY`  | _(required)_       | Your Gemini API key.                          |
| `GEMINI_MODEL`    | `gemini-2.5-flash` | Model id. Try `gemini-2.5-pro` for harder tasks. |
| `PORT`            | `8787`             | Port to listen on.                            |
| `ALLOWED_ORIGINS` | `*`                | CORS origins (comma-separated). `*` for dev.  |

## API

### `POST /api/chat`

Request:

```json
{ "contents": [ { "role": "user", "parts": [ { "text": "..." } ] } ] }
```

Response:

```json
{ "parts": [ { "text": "..." } ], "finishReason": "STOP", "usage": { } }
```

`parts` may contain `functionCall` objects when the agent wants to act on the
page. The extension executes them and sends the results back in the next
`/api/chat` call.

## Deploying

This is a standard stateless Node/Express app — deploy it anywhere:

- **Render / Railway / Fly.io:** set the start command to `node server.js` and
  add `GEMINI_API_KEY` as an environment variable.
- **Vercel:** wrap `server.js` as a serverless function, or run it as a Node
  service.

After deploying, open the extension's **Settings** (⚙ in the side panel) and set
the **Backend URL** to your deployed URL. Also set `ALLOWED_ORIGINS` to your
extension origin for security, e.g. `chrome-extension://<your-extension-id>`.
