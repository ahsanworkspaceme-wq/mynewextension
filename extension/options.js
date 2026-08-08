const api = globalThis.browser ?? globalThis.chrome;

const backendUrl = document.getElementById("backendUrl");
const maxSteps = document.getElementById("maxSteps");
const confirmMode = document.getElementById("confirmMode");
const saved = document.getElementById("saved");

async function load() {
  const cfg = await api.storage.local.get(["backendUrl", "maxSteps", "confirmMode"]);
  backendUrl.value = cfg.backendUrl || "http://localhost:8787";
  maxSteps.value = cfg.maxSteps || 20;
  confirmMode.value = cfg.confirmMode || "risky";
}

document.getElementById("save").addEventListener("click", async () => {
  await api.storage.local.set({
    backendUrl: backendUrl.value.trim().replace(/\/+$/, "") || "http://localhost:8787",
    maxSteps: Math.max(1, Math.min(40, Number(maxSteps.value) || 20)),
    confirmMode: confirmMode.value || "risky",
  });
  saved.classList.add("show");
  setTimeout(() => saved.classList.remove("show"), 1500);
});

load();
