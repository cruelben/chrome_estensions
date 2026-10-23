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

// 1. Menu contestuale
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl) return;
  await processImage(info.srcUrl, tab, info.frameId || 0);
});

// 2. Icona rapida (solo se attivata)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "quick-save") {
    processImage(msg.url, sender.tab, sender.frameId || 0)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// Funzione principale che coordina il salvataggio
async function processImage(url, tab, frameId) {
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

    const settings = await chrome.storage.local.get({ convertWebpToGif: true });

    const result = await chrome.runtime.sendMessage({
      type: "process-image",
      url: url,
      handleStaticValid,
      handleAnimValid,
      convertWebpToGif: settings.convertWebpToGif
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || "Errore sconosciuto durante il salvataggio");
    }

    if (result.fallback) {
      if (tab && tab.id) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id, frameIds: [frameId] },
            files: ['content.js']
          });
          
          const dlResult = await chrome.tabs.sendMessage(tab.id, {
            type: "download",
            dataUrl: result.dataUrl,
            filename: result.filename
          }, { frameId: frameId });

          if (!dlResult || !dlResult.ok) {
            throw new Error(dlResult?.error || "Impossibile avviare il download nella pagina.");
          }
          
          await reportSuccess(result.filename, "Scelta dall'utente");

        } catch (err) {
          throw new Error("Impossibile avviare il salvataggio su questa pagina. Riprova da una pagina web normale.");
        }
      }
    } else {
      await reportSuccess(result.filename, result.folder);
    }

  } catch (err) {
    await reportError(err);
    throw err;
  }
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["BLOBS"],
    justification: "Scarica, converte e prepara i file",
    lifetime: "sw" // Chiude il documento offscreen quando il service worker va in pausa
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