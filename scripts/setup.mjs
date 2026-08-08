// One-command setup + run for Glide.
//   npm run go
// Installs deps, generates icons, sets up backend/.env (asks for your Gemini
// API key if needed), then starts the backend. Cross-platform (Node only).
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND = join(ROOT, "backend");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const log = (m) => console.log(m);
const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, stdio: "inherit", shell: true });

log("\n➤  Glide setup\n────────────────");

// 1. Generate icons (import runs it in-process — avoids Windows path-with-spaces issues)
log("\n[1/4] Generating icons…");
await import(pathToFileURL(join(ROOT, "scripts", "gen-icons.mjs")).href);

// 2. Install backend deps (only if missing)
if (!existsSync(join(BACKEND, "node_modules"))) {
  log("\n[2/4] Installing backend dependencies…");
  run(npm, ["install"], BACKEND);
} else {
  log("\n[2/4] Backend dependencies already installed ✓");
}

// 3. Ensure a minimal .env exists (keys are set in the extension, not here)
log("\n[3/4] Preparing backend…");
const envPath = join(BACKEND, ".env");
const examplePath = join(BACKEND, ".env.example");
if (!existsSync(envPath) && existsSync(examplePath)) copyFileSync(examplePath, envPath);
log("   You'll pick your AI provider, paste your API key, and choose a model");
log("   inside the extension (click the 🔑 button) — no key needed here.");

// 4. Print the (manual) Chrome step, then start the backend
log("\n[4/4] Starting the backend…");
log("\n────────────────────────────────────────────────");
log("  ⬇ ONE manual step left — load the extension:");
log("    1. Open  chrome://extensions");
log("    2. Turn on  Developer mode  (top-right)");
log("    3. Click  Load unpacked  →  select the  extension  folder");
log("    4. Press  Ctrl+Shift+K  to open Glide");
log("────────────────────────────────────────────────");
log("\n  Backend logs (keep this window open, Ctrl+C to stop):\n");

const child = spawn(npm, ["start"], { cwd: BACKEND, stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code || 0));
