import { idbSet } from "./idb.js";

const $ = (id) => document.getElementById(id);

let pending = null;

init();

async function init() {
  const data = await chrome.storage.session.get("pendingSave");
  pending = data.pendingSave;

  if (!pending) {
    document.body.textContent = "Nessun salvataggio in sospeso.";
    return;
  }

  $("category-label").textContent = pending.category === "anim" ? "animazioni (GIF/WebP)" : "immagini (JPG)";
  $("filename-label").textContent = pending.filename;

  $("choose-btn").addEventListener("click", choose);
  $("cancel-btn").addEventListener("click", () => window.close());
}

async function choose() {
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    const perm = await handle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") throw new Error("Permesso negato");

    const idbKey = pending.category === "anim" ? "handle-anim" : "handle-static";
    await idbSet(idbKey, handle);

    const blob = await (await fetch(pending.dataUrl)).blob();
    const fileHandle = await handle.getFileHandle(pending.filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    await idbSet("last-save", {
      filename: pending.filename,
      folder: handle.name,
      at: Date.now(),
      type: pending.category
    });

    await chrome.storage.session.remove("pendingSave");

    // Avviso una tantum: la cartella è stata impostata
    await chrome.notifications.create("swj-autoset-" + Date.now(), {
      type: "basic",
      iconUrl: "icon.png",
      title: "Cartella impostata",
      message: `D'ora in poi i file ${pending.category === "anim" ? "GIF/animazioni" : "JPG"} verranno salvati automaticamente in "${handle.name}".`
    });

    // Notifica classica di conferma salvataggio, identica al flusso normale
    await chrome.notifications.create("swj-success-" + Date.now(), {
      type: "basic",
      iconUrl: "icon.png",
      title: "Salvataggio riuscito!",
      message: `File: ${pending.filename}\nDestinazione: ${handle.name}`
    });

    window.close();
  } catch (e) {
    if (e?.name !== "AbortError") {
      console.warn("Errore selezione cartella:", e);
    }
  }
}