const api = globalThis.browser ?? globalThis.chrome;

const backendUrl = document.getElementById("backendUrl");
const maxSteps = document.getElementById("maxSteps");
const confirmMode = document.getElementById("confirmMode");
const siteAccess = document.getElementById("siteAccess");
const blockedSites = document.getElementById("blockedSites");
const nativeInput = document.getElementById("nativeInput");
const saved = document.getElementById("saved");

async function load() {
  const cfg = await api.storage.local.get([
    "backendUrl",
    "maxSteps",
    "confirmMode",
    "siteAccess",
    "blockedSites",
    "nativeInput",
  ]);
  backendUrl.value = cfg.backendUrl || "http://localhost:8787";
  maxSteps.value = cfg.maxSteps || 20;
  confirmMode.value = cfg.confirmMode || "risky";
  siteAccess.value = cfg.siteAccess || "all";
  blockedSites.value =
    cfg.blockedSites ?? "chase.com, bankofamerica.com, wellsfargo.com, paypal.com, coinbase.com";
  nativeInput.checked = !!cfg.nativeInput;
}

// Requesting the debugger permission needs a user gesture — do it on toggle.
nativeInput.addEventListener("change", async () => {
  if (!nativeInput.checked) return;
  if (!(globalThis.chrome && !globalThis.browser)) {
    alert("Power mode (debugger API) is only available in Chrome/Edge.");
    nativeInput.checked = false;
    return;
  }
  try {
    const granted = await api.permissions.request({ permissions: ["debugger"] });
    if (!granted) {
      nativeInput.checked = false;
      alert("The debugger permission was not granted, so power mode stays off.");
    }
  } catch (_) {
    nativeInput.checked = false;
  }
});

document.getElementById("save").addEventListener("click", async () => {
  await api.storage.local.set({
    backendUrl: backendUrl.value.trim().replace(/\/+$/, "") || "http://localhost:8787",
    maxSteps: Math.max(1, Math.min(40, Number(maxSteps.value) || 20)),
    confirmMode: confirmMode.value || "risky",
    siteAccess: siteAccess.value || "all",
    blockedSites: blockedSites.value.trim(),
    nativeInput: !!nativeInput.checked,
  });
  saved.classList.add("show");
  setTimeout(() => saved.classList.remove("show"), 1500);
});

load();
