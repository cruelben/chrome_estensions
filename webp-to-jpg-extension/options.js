import { idbGet, idbSet, idbDelete } from "./idb.js";

const $ = (id) => document.getElementById(id);

// Memorizziamo le cartelle in anticipo per non far perdere il "clic" a Chrome
let cachedHandles = {
  "handle-static": null,
  "handle-anim": null
};

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Carica i riferimenti alle cartelle PRIMA che l'utente clicchi
  cachedHandles["handle-static"] = await idbGet("handle-static");
  cachedHandles["handle-anim"] = await idbGet("handle-anim");

  await refreshUI();
  
  // 2. Carica le opzioni
  const storage = await chrome.storage.local.get({ 
    quickActionEnabled: false,
    convertWebpToGif: true,
    minImageSize: 300
  });
  
  const toggleQuick = $("toggle-quick-action");
  toggleQuick.checked = storage.quickActionEnabled;
  toggleQuick.addEventListener("change", (e) => {
    chrome.storage.local.set({ quickActionEnabled: e.target.checked });
  });

  const minSizeInput = $("min-size-input");
  minSizeInput.value = storage.minImageSize;
  minSizeInput.addEventListener("change", (e) => {
    let val = parseInt(e.target.value, 10);
    if (isNaN(val) || val < 10) val = 10;
    if (val > 5000) val = 5000;
    e.target.value = val;
    chrome.storage.local.set({ minImageSize: val });
  });

  const toggleWebp = $("toggle-webp-gif");
  toggleWebp.checked = storage.convertWebpToGif;
  toggleWebp.addEventListener("change", (e) => {
    chrome.storage.local.set({ convertWebpToGif: e.target.checked });
  });

  // 3. Collega i pulsanti
  $("pick-static").addEventListener("click", () => pickFolder("handle-static"));
  $("pick-anim").addEventListener("click", () => pickFolder("handle-anim"));
  
  $("clear-static").addEventListener("click", () => clearFolder("handle-static"));
  $("clear-anim").addEventListener("click", () => clearFolder("handle-anim"));
});

async function pickFolder(idbKey) {
  try {
    const existingHandle = cachedHandles[idbKey];
    
    if (existingHandle) {
      try {
        // Controlla se il permesso è ancora valido
        const perm = await existingHandle.queryPermission({ mode: "readwrite" });
        if (perm === "granted") {
          await refreshUI();
          return; // Già autorizzato, esce silenziosamente
        }
        
        // Se serve il permesso, chiedilo (apparirà il popup di Chrome)
        const req = await existingHandle.requestPermission({ mode: "readwrite" });
        if (req === "granted") {
          await refreshUI();
          return; 
        } else {
          return; // L'utente ha negato
        }
      } catch (err) {
        console.warn("Handle esistente non valido, apro il selettore.", err);
        // Se c'è un errore, prosegue e apre la finestra di selezione
      }
    }

    // Se arriviamo qui, dobbiamo far scegliere la cartella da zero
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await idbSet(idbKey, handle);
    cachedHandles[idbKey] = handle;
    await refreshUI();
  } catch (e) {
    if (e?.name !== "AbortError") console.warn("Selezione annullata:", e);
  }
}

async function clearFolder(idbKey) {
  await idbDelete(idbKey);
  cachedHandles[idbKey] = null;
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
  const h = cachedHandles[idbKey]; // Usa la cache
  
  if (!h) {
    el.textContent = "Non configurata (Chiederà dove salvare)";
    el.classList.add("empty");
    return;
  }
  
  try {
    const perm = await h.queryPermission({ mode: "readwrite" });
    if (perm === "granted") {
      el.textContent = h.name;
      el.classList.remove("empty");
    } else {
      el.textContent = h.name + " (Clicca 'Scegli cartella' per autorizzare)";
      el.classList.add("empty");
    }
  } catch (err) {
    el.textContent = "Cartella non accessibile (Rimuovi e scegli di nuovo)";
    el.classList.add("empty");
  }
}