import { idbGet } from "./idb.js";

const MENU_ID = "save-webp-as-jpg";

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Salva immagine (JPG/GIF)",
      contexts: ["image"]
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl) return;
  await handleSave(info.srcUrl, tab, info.frameId || 0);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "save-from-overlay" && msg.url && sender.tab) {
    handleSave(msg.url, sender.tab, sender.frameId || 0)
      .then((res) => sendResponse(res || { ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }
});

async function handleSave(url, tab, frameId) {
  try {
    const handleStatic = await idbGet("handle-static");
    const handleAnim = await idbGet("handle-anim");

    let handleStaticValid = false;
    let handleAnimValid = false;

    if (handleStatic) {
      const perm = await handleStatic.queryPermission({ mode: "readwrite" });
      if (perm === "granted") handleStaticValid = true;
    }
    if (handleAnim) {
      const perm = await handleAnim.queryPermission({ mode: "readwrite" });
      if (perm === "granted") handleAnimValid = true;
    }

    await ensureOffscreen();

    // Impostazione GIF attiva di default se non specificato altrimenti
    const settings = await chrome.storage.local.get("convertAnimToGif");
    const convertAnimatedToGif = settings.convertAnimToGif !== false;

    const result = await chrome.runtime.sendMessage({
      type: "process-image",
      url,
      handleStaticValid,
      handleAnimValid,
      convertAnimatedToGif
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || "Errore sconosciuto durante il salvataggio");
    }

    if (result.fallback) {
      // Nessuna cartella valida configurata per questa categoria:
      // apriamo una piccola finestra popup per scegliere la cartella.
      // Quella finestra salverà il file e imposterà la cartella scelta
      // come nuova cartella predefinita per la categoria (static/anim).
      await chrome.storage.session.set({
        pendingSave: {
          dataUrl: result.dataUrl,
          filename: result.filename,
          category: result.category
        }
      });
      await chrome.windows.create({
        url: chrome.runtime.getURL("picker.html"),
        type: "popup",
        width: 480,
        height: 320
      });
    } else {
      await reportSuccess(result.filename, result.folder);
    }

    return { ok: true };
  } catch (err) {
    await reportError(err);
    return { ok: false, error: err?.message || String(err) };
  }
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["BLOBS"],
    justification: "Scarica, converte e prepara i file"
  });
}

async function reportError(err) {
  const message = err?.message || String(err);
  console.error("[Salva WebP in JPG]", message);
  try {
    chrome.notifications.create("swj-error-" + Date.now(), {
      type: "basic",
      iconUrl: "icon.png",
      title: "Salvataggio non riuscito",
      message: message
    });
  } catch {}
}

async function reportSuccess(filename, folder) {
  try {
    chrome.notifications.create("swj-success-" + Date.now(), {
      type: "basic",
      iconUrl: "icon.png",
      title: "Salvataggio riuscito!",
      message: `File: ${filename}\nDestinazione: ${folder}`
    });
  } catch {}
}