import { idbGet, idbSet, idbDelete } from "./idb.js";

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  await refreshUI();
  await loadSettings();

  $("pick-static").addEventListener("click", () => pickFolder("handle-static"));
  $("pick-anim").addEventListener("click", () => pickFolder("handle-anim"));

  $("clear-static").addEventListener("click", () => clearFolder("handle-static"));
  $("clear-anim").addEventListener("click", () => clearFolder("handle-anim"));

  $("enable-overlay").addEventListener("change", saveSettings);
  $("min-image-size").addEventListener("change", saveSettings);
  $("convert-anim-gif").addEventListener("change", saveSettings);
  
  document.querySelectorAll('input[name="iconColor"]').forEach((el) =>
    el.addEventListener("change", saveSettings)
  );
  document.querySelectorAll('input[name="iconPosition"]').forEach((el) =>
    el.addEventListener("change", saveSettings)
  );
});

async function loadSettings() {
  const r = await chrome.storage.local.get([
    "iconColor", "iconPosition", "enableOverlay", "minImageSize", "convertAnimToGif"
  ]);
  
  $("enable-overlay").checked = r.enableOverlay !== false;
  $("min-image-size").value = r.minImageSize || 300;
  
  // Conversione GIF attiva di default (true) se non è mai stata salvata
  $("convert-anim-gif").checked = r.convertAnimToGif !== false;

  const color = r.iconColor || "red";
  const pos = r.iconPosition || "follow";

  const colorEl = document.querySelector(`input[name="iconColor"][value="${color}"]`);
  const posEl = document.querySelector(`input[name="iconPosition"][value="${pos}"]`);
  if (colorEl) colorEl.checked = true;
  if (posEl) posEl.checked = true;
}

async function saveSettings() {
  const color = document.querySelector('input[name="iconColor"]:checked')?.value || "red";
  const pos = document.querySelector('input[name="iconPosition"]:checked')?.value || "follow";
  const enableOverlay = $("enable-overlay").checked;
  const minImageSize = parseInt($("min-image-size").value, 10) || 300;
  const convertAnimToGif = $("convert-anim-gif").checked;

  await chrome.storage.local.set({ 
    iconColor: color, 
    iconPosition: pos,
    enableOverlay,
    minImageSize,
    convertAnimToGif
  });
}

async function pickFolder(idbKey) {
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    const perm = await handle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") throw new Error("Permesso negato");

    await idbSet(idbKey, handle);
    await refreshUI();
  } catch (e) {
    if (e?.name !== "AbortError") console.warn("Selezione annullata:", e);
  }
}

async function clearFolder(idbKey) {
  await idbDelete(idbKey);
  await refreshUI();
}

async function refreshUI() {
  await renderHandle("handle-static", "path-static");
  await renderHandle("handle-anim", "path-anim");

  const s = await idbGet("last-save");
  $("last-save").textContent = s
    ? `${s.filename} → ${s.folder} (${new Date(s.at).toLocaleString("it-IT")})`
    : "—";
}

async function renderHandle(idbKey, elId) {
  const el = $(elId);
  const h = await idbGet(idbKey);

  if (!h) {
    el.textContent = "Non configurata (Chiederà dove salvare)";
    el.classList.add("empty");
    return;
  }

  const perm = await h.queryPermission({ mode: "readwrite" });
  if (perm === "granted") {
    el.textContent = h.name;
    el.classList.remove("empty");
  } else {
    el.textContent = h.name + " (Permesso scaduto - richiede ri-autorizzazione)";
    el.classList.add("empty");
  }
}