// One-command setup + run for Glide.
//   npm run go
// Installs deps, generates icons, sets up backend/.env (asks for your Gemini
// API key if needed), then starts the backend. Cross-platform (Node only).
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND = join(ROOT, "backend");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const log = (m) => console.log(m);
const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, stdio: "inherit", shell: true });

log("\n➤  Glide setup\n────────────────");

// 1. Generate icons
log("\n[1/4] Generating icons…");
run(process.execPath, [join(ROOT, "scripts", "gen-icons.mjs")], ROOT);

// 2. Install backend deps (only if missing)
if (!existsSync(join(BACKEND, "node_modules"))) {
  log("\n[2/4] Installing backend dependencies…");
  run(npm, ["install"], BACKEND);
} else {
  log("\n[2/4] Backend dependencies already installed ✓");
}

// 3. Ensure backend/.env has a Gemini API key
log("\n[3/4] Checking backend configuration…");
const envPath = join(BACKEND, ".env");
const examplePath = join(BACKEND, ".env.example");
if (!existsSync(envPath)) copyFileSync(examplePath, envPath);
let env = readFileSync(envPath, "utf8");
const keyMatch = env.match(/^GEMINI_API_KEY=(.*)$/m);
const currentKey = keyMatch ? keyMatch[1].trim() : "";
const placeholder = !currentKey || /your-gemini-api-key-here|AIza\.\.\./.test(currentKey);

if (placeholder) {
  log("\n   You need a free Gemini API key: https://aistudio.google.com/apikey");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const key = (await rl.question("   Paste your Gemini API key: ")).trim();
  await rl.close();
  if (key) {
    env = keyMatch ? env.replace(/^GEMINI_API_KEY=.*$/m, `GEMINI_API_KEY=${key}`) : env + `\nGEMINI_API_KEY=${key}\n`;
    writeFileSync(envPath, env);
    log("   Saved to backend/.env ✓");
  } else {
    log("   ⚠ No key entered. Add it to backend/.env later, then run `npm run backend`.");
  }
} else {
  log("   API key already set ✓");
}

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
