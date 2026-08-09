const api = globalThis.browser ?? globalThis.chrome;

const backendUrl = document.getElementById("backendUrl");
const maxSteps = document.getElementById("maxSteps");
const confirmMode = document.getElementById("confirmMode");
const siteAccess = document.getElementById("siteAccess");
const blockedSites = document.getElementById("blockedSites");
const nativeInput = document.getElementById("nativeInput");
const saved = document.getElementById("saved");

// ---- Fill Profile -----------------------------------------------------------
const PROFILE_FIELDS = ["pfName", "pfFirstName", "pfLastName", "pfEmail", "pfPhone", "pfAddress", "pfCity", "pfState", "pfZip", "pfCountry"];
const PROFILE_KEYS = ["name", "firstName", "lastName", "email", "phone", "address", "city", "state", "zip", "country"];
const profileSelect = document.getElementById("profileSelect");
const profileSaved = document.getElementById("profileSaved");

function getProfileFieldValues() {
  const fields = {};
  PROFILE_FIELDS.forEach((id, i) => { fields[PROFILE_KEYS[i]] = document.getElementById(id).value.trim(); });
  return fields;
}
function setProfileFieldValues(fields) {
  PROFILE_FIELDS.forEach((id, i) => { document.getElementById(id).value = fields[PROFILE_KEYS[i]] || ""; });
}
function clearProfileFields() {
  PROFILE_FIELDS.forEach((id) => { document.getElementById(id).value = ""; });
}

async function loadProfiles() {
  const s = await api.storage.local.get(["profiles", "activeProfile"]);
  const profiles = Array.isArray(s.profiles) ? s.profiles : [];
  profileSelect.innerHTML = '<option value="">— New profile —</option>';
  profiles.forEach((p, i) => {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = p.name;
    profileSelect.appendChild(opt);
  });
  if (s.activeProfile) profileSelect.value = s.activeProfile;
  if (profiles.length && s.activeProfile) {
    const p = profiles.find(x => x.name === s.activeProfile);
    if (p) setProfileFieldValues(p.fields || {});
  }
  return profiles;
}

profileSelect.addEventListener("change", async () => {
  const s = await api.storage.local.get(["profiles"]);
  const profiles = Array.isArray(s.profiles) ? s.profiles : [];
  const p = profiles.find(x => x.name === profileSelect.value);
  if (p) setProfileFieldValues(p.fields || {});
  else clearProfileFields();
  await api.storage.local.set({ activeProfile: profileSelect.value });
});

document.getElementById("saveProfile").addEventListener("click", async () => {
  const name = document.getElementById("pfName").value.trim();
  if (!name) { alert("Profile name is required."); return; }
  const fields = getProfileFieldValues();
  const s = await api.storage.local.get(["profiles"]);
  const profiles = Array.isArray(s.profiles) ? s.profiles : [];
  const idx = profiles.findIndex(p => p.name === name);
  const entry = { name, fields };
  if (idx >= 0) profiles[idx] = entry; else profiles.push(entry);
  await api.storage.local.set({ profiles, activeProfile: name });
  await loadProfiles();
  profileSelect.value = name;
  profileSaved.classList.add("show");
  setTimeout(() => profileSaved.classList.remove("show"), 1500);
});

document.getElementById("deleteProfile").addEventListener("click", async () => {
  const name = profileSelect.value;
  if (!name) { alert("Select a profile to delete."); return; }
  if (!confirm(`Delete profile "${name}"?`)) return;
  const s = await api.storage.local.get(["profiles"]);
  const profiles = (Array.isArray(s.profiles) ? s.profiles : []).filter(p => p.name !== name);
  await api.storage.local.set({ profiles, activeProfile: "" });
  clearProfileFields();
  await loadProfiles();
});

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
loadProfiles();
