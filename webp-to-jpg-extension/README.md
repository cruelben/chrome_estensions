# Riepilogo Tecnico e Reset Prompt: Estensione Chrome "Salva WebP in JPG" (v5.4)

Questo documento contiene il riepilogo completo e il codice finale dell'estensione Chrome su cui abbiamo lavorato. Può essere usato come "prompt di reset" per iniziare una nuova sessione di sviluppo senza perdere il contesto.

## 1. Obiettivo del Progetto
Sviluppo di un'estensione per Google Chrome (Manifest V3) che permette di:
*   Salvare immagini WebP, GIF, PNG, JPG, BMP e altri formati tramite il menu contestuale (tasto destro) o tramite un'icona rapida fluttuante.
*   **Conversione automatica in JPG**: Convertire le immagini statiche in JPG (con sfondo bianco per gestire le trasparenze di PNG/WebP). I file già JPG non vengono ricompressi.
*   **Rilevamento e conversione animazioni**: Riconosce GIF e WebP animate. Le WebP animate possono essere convertite in GIF animate (tramite la libreria `gifenc`).
*   **Doppia modalità di salvataggio**:
    *   **Cartella fissa (Silenzioso)**: Se configurata, salva i file in background senza aprire finestre.
    *   **Salva con nome (Fallback)**: Se i permessi delle cartelle sono scaduti o non configurati, usa un content script per aprire il dialog nativo di Windows.
*   **Icona Rapida (Quick Action)**: Mostra un'icona di download fluttuante sulle immagini più grandi di una certa dimensione (configurabile, default 300x300) per salvarle con un solo clic.
*   **Notifiche**: Notifica di successo o di errore al termine di ogni operazione.

## 2. Architettura e Struttura
L'estensione è suddivisa nei seguenti file:
*   `manifest.json`: Definisce i permessi, l'azione, le opzioni e l'iniezione del content script (con `all_frames: true`).
*   `background.js`: Service Worker. Gestisce il menu contestuale, l'icona rapida e coordina il salvataggio. Ottimizzato con `lifetime: "sw"` per chiudere l'offscreen e risparmiare RAM.
*   `offscreen.html` / `offscreen.js`: Documento invisibile per fetch CORS, conversioni canvas (JPG) ed encoding GIF (WebP -> GIF).
*   `content.js`: Iniettato nelle pagine. Gestisce il fallback "Salva con nome" e l'icona rapida (con calcolo delle coordinate per evitare hover-gap).
*   `options.html` / `options.js`: Interfaccia utente per cartelle, attivazione icona rapida, dimensione minima e conversione GIF.
*   `idb.js`: Wrapper per IndexedDB per memorizzare i riferimenti alle cartelle (`FileSystemDirectoryHandle`).
*   `gifenc.esm.js`: Libreria esterna (da scaricare a parte) per la codifica delle GIF animate.

## 3. Scelte Tecniche e Vincoli (Bug Risolti)
*   **Corruzione dei file**: Risolto usando stringhe DataURL per passare i file tra offscreen e background/content, evitando la corruzione degli ArrayBuffer.
*   **Multipli download**: Risolto iniettando `content.js` solo nel frame esatto e usando un flag `window.swjInjected`.
*   **Trasparenza JPG**: Il canvas viene riempito di bianco (`#ffffff`) prima di disegnare l'immagine.
*   **Bug WebP -> GIF (OffscreenCanvas)**: `track.codedWidth` restituiva `undefined` causando un crash. Risolto decodificando il primo frame e usando `image.displayWidth` e `image.displayHeight`.
*   **Bug YouTube (Icona su Video)**: L'icona appariva sui video di YouTube (che usano URL `blob:`). Risolto filtrando gli URL che iniziano con `blob:` o `data:`.
*   **Hover Gap (Icona che sparisce)**: Risolto abbandonando i timer e usando `document.elementsFromPoint` e un controllo matematico delle coordinate per verificare se il mouse è dentro l'immagine o dentro l'icona.
*   **Permessi Cartelle**: Chrome revoca i permessi di scrittura al reload. Implementata una cache (`cachedHandles`) in `options.js` per ri-chiedere i permessi in modo trasparente con un solo clic.

## 4. L'Ultima Versione del Codice

### `manifest.json`
```json
{
  "manifest_version": 3,
  "name": "Salva WebP in JPG",
  "version": "5.4",
  "description": "Converte e salva immagini WebP/GIF in JPG o nella cartella animazioni scelta.",
  "minimum_chrome_version": "116",
  "icons": {
    "16": "icon.png",
    "48": "icon.png",
    "128": "icon.png"
  },
  "action": {
    "default_icon": "icon.png",
    "default_title": "Configura Salva WebP in JPG"
  },
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true
  },
  "permissions": [
    "contextMenus",
    "downloads",
    "storage",
    "notifications",
    "offscreen",
    "scripting"
  ],
  "host_permissions": [
    "http://*/*",
    "https://*/*"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["content.js"],
      "run_at": "document_idle",
      "all_frames": true
    }
  ]
}
```

### `background.js`
```javascript
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
```

### `offscreen.html`
```html
<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"><title>Offscreen</title></head>
<body>
  <script type="module" src="offscreen.js"></script>
</body>
</html>
```

### `offscreen.js`
```javascript
import { idbGet, idbSet } from "./idb.js";
import { GIFEncoder, quantize, applyPalette } from './gifenc.esm.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "process-image") return;
  
  handleProcess(msg)
    .then((res) => sendResponse({ ok: true, ...res }))
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    
  return true;
});

async function handleProcess({ url, handleStaticValid, handleAnimValid, convertWebpToGif }) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("HTTP " + response.status);
  
  let originalBlob = await response.blob();
  const bytes = new Uint8Array(await originalBlob.arrayBuffer());

  const mime = sniffMime(bytes);
  let category, ext;
  
  if (mime === "image/gif") {
    const anim = isAnimatedGif(bytes);
    category = anim ? "anim" : "static";
    ext = anim ? "gif" : "jpg";
  } else if (mime === "image/webp") {
    const anim = isAnimatedWebp(bytes);
    category = anim ? "anim" : "static";
    ext = anim ? "webp" : "jpg";
    
    if (anim && convertWebpToGif) {
        try {
            const gifBlob = await convertWebpToGifBlob(originalBlob);
            originalBlob = gifBlob; 
            ext = "gif";
        } catch (e) {
            console.warn("Conversione WebP -> GIF fallita, salvo come WebP originale.", e);
        }
    }

  } else {
    category = "static";
    ext = "jpg";
  }

  const filename = buildFilename(ext);
  const isValidCategory = category === "anim" ? handleAnimValid : handleStaticValid;
  const handleKey = category === "anim" ? "handle-anim" : "handle-static";

  let finalBlob = originalBlob;
  
  if (ext === "jpg" && mime !== "image/jpeg") {
    finalBlob = await convertToJpgBlob(originalBlob);
  }

  if (isValidCategory) {
    const dir = await idbGet(handleKey);
    const fileHandle = await dir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(finalBlob);
    await writable.close();

    await idbSet("last-save", { filename, folder: dir.name, at: Date.now(), type: ext });
    return { filename, folder: dir.name, fallback: false };
  } else {
    const dataUrl = await blobToDataUrl(finalBlob);
    await idbSet("last-save", { filename, folder: "Salva con nome", at: Date.now(), type: ext });
    return { filename, fallback: true, dataUrl };
  }
}

async function convertWebpToGifBlob(webpBlob) {
  const decoder = new ImageDecoder({
    data: await webpBlob.arrayBuffer(),
    type: 'image/webp'
  });
  
  await decoder.tracks.ready;
  const track = decoder.tracks.selectedTrack;
  
  if (!track || track.frameCount <= 1) {
    throw new Error("Non è un'animazione valida");
  }

  const firstFrame = await decoder.decode({ frameIndex: 0 });
  const width = firstFrame.image.displayWidth;
  const height = firstFrame.image.displayHeight;

  if (!width || !height) {
    throw new Error("Impossibile leggere le dimensioni dell'immagine.");
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  
  const gif = GIFEncoder();
  
  for (let i = 0; i < track.frameCount; i++) {
    const { image } = await decoder.decode({ frameIndex: i });
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    const palette = quantize(imageData.data, 256);
    const index = applyPalette(imageData.data, palette);
    
    const delay = image.duration ? Math.round(image.duration / 1000) : 100;
    
    gif.writeFrame(index, canvas.width, canvas.height, { palette, delay });
    
    image.close(); 
  }
  
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function convertToJpgBlob(blob) {
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
  } catch (e) {
    throw new Error("Impossibile decodificare l'immagine per convertirla in JPG.");
  }
}

function buildFilename(ext) {
  const n = new Date();
  const p = (v, len = 2) => String(v).padStart(len, "0");
  return `${n.getFullYear()}${p(n.getMonth() + 1)}${p(n.getDate())}_${p(n.getHours())}${p(n.getMinutes())}${p(n.getSeconds())}${p(n.getMilliseconds(), 3)}.${ext}`;
}

function sniffMime(b) {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return "application/octet-stream";
}

function isAnimatedWebp(bytes) {
  if (bytes.length < 12) return false;
  let off = 12;
  while (off + 8 <= bytes.length) {
    const cc = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
    const size = (bytes[off + 4] | (bytes[off + 5] << 8) | (bytes[off + 6] << 16) | (bytes[off + 7] << 24)) >>> 0;
    if (cc === "ANIM" || cc === "ANMF") return true;
    off += 8 + size + (size % 2);
  }
  return false;
}

function isAnimatedGif(bytes) {
  if (bytes.length < 13) return false;
  const packed = bytes[10];
  let off = 13;
  if (packed & 0x80) off += 3 * (1 << ((packed & 0x07) + 1));
  let frames = 0;
  while (off < bytes.length) {
    const b = bytes[off];
    if (b === 0x3b) break;
    if (b === 0x21) {
      off += 2;
      while (off < bytes.length) { const len = bytes[off]; off += 1 + len; if (len === 0) break; }
    } else if (b === 0x2c) {
      frames++;
      if (frames > 1) return true;
      off += 10;
      const ip = bytes[off - 1];
      if (ip & 0x80) off += 3 * (1 << ((ip & 0x07) + 1));
      off += 1;
      while (off < bytes.length) { const len = bytes[off]; off += 1 + len; if (len === 0) break; }
    } else { break; }
  }
  return false;
}
```

### `content.js`
```javascript
// --- 1. GESTIONE FALLBACK (Salva con nome) ---
if (!window.swjInjected) {
  window.swjInjected = true;
  
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "download") {
      try {
        const a = document.createElement("a");
        a.href = msg.dataUrl;
        a.download = msg.filename;
        
        (document.body || document.documentElement).appendChild(a);
        a.click();
        (document.body || document.documentElement).removeChild(a);
        
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return true;
    }
  });
}

// --- 2. GESTIONE ICONA RAPIDA (Quick Action) ---
(function initQuickAction() {
  let MIN_SIZE = 300; 
  let isEnabled = false;
  let overlay = null;
  let innerCircle = null;
  
  let currentImg = null;
  let imgRect = null;
  let ovRect = null;

  chrome.storage.local.get({ quickActionEnabled: false, minImageSize: 300 }, (res) => {
    isEnabled = res.quickActionEnabled;
    MIN_SIZE = res.minImageSize;
    if (isEnabled) createOverlay();
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      if (changes.quickActionEnabled) {
        isEnabled = changes.quickActionEnabled.newValue;
        if (isEnabled) createOverlay();
        else removeOverlay();
      }
      if (changes.minImageSize) {
        MIN_SIZE = changes.minImageSize.newValue;
        hideOverlay();
      }
    }
  });

  function createOverlay() {
    if (overlay) return;
    
    overlay = document.createElement("div");
    overlay.id = "swj-quick-overlay";
    overlay.style.cssText = "position:fixed; z-index:2147483647; display:none; cursor:pointer; width:36px; height:36px; align-items:center; justify-content:center;";
    
    innerCircle = document.createElement("div");
    innerCircle.style.cssText = "width:28px; height:28px; background:rgba(0,0,0,0.65); border-radius:50%; display:flex; align-items:center; justify-content:center; transition: transform 0.1s, background 0.2s; backdrop-filter: blur(2px); box-shadow: 0 2px 5px rgba(0,0,0,0.3); pointer-events: none;";
    
    innerCircle.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
    
    overlay.appendChild(innerCircle);
    overlay.title = "Salva questa immagine";
    
    overlay.onmouseenter = () => {
      innerCircle.style.transform = "scale(1.15)";
      innerCircle.style.background = "rgba(0,0,0,0.8)";
    };
    
    overlay.onmouseleave = () => {
      innerCircle.style.transform = "scale(1)";
      innerCircle.style.background = "rgba(0,0,0,0.65)";
    };
    
    overlay.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (overlay.dataset.url) {
        hideOverlay(); 
        chrome.runtime.sendMessage({ type: "quick-save", url: overlay.dataset.url });
      }
    });
    
    document.body.appendChild(overlay);

    document.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("scroll", hideOverlay, { passive: true });
  }

  function removeOverlay() {
    if (overlay) overlay.remove();
    overlay = null;
    hideOverlay();
    document.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("scroll", hideOverlay);
  }

  function hideOverlay() {
    if (overlay) overlay.style.display = "none";
    currentImg = null;
    imgRect = null;
    ovRect = null;
  }

  function handleMouseMove(e) {
    if (!isEnabled || !overlay) return;

    if (currentImg) {
      const inImg = e.clientX >= imgRect.left && e.clientX <= imgRect.right && e.clientY >= imgRect.top && e.clientY <= imgRect.bottom;
      const inOv = ovRect && e.clientX >= ovRect.left && e.clientX <= ovRect.right && e.clientY >= ovRect.top && e.clientY <= ovRect.bottom;

      if (inImg || inOv) {
        overlay.style.display = "flex";
        return; 
      } else {
        hideOverlay(); 
      }
    }

    if (!currentImg) {
      const elements = document.elementsFromPoint(e.clientX, e.clientY);
      
      const img = elements.find(el => {
        if (el.tagName !== "IMG") return false;
        if (el.naturalWidth < MIN_SIZE || el.naturalHeight < MIN_SIZE) return false;
        
        const src = el.currentSrc || el.src;
        if (!src || src.startsWith("blob:") || src.startsWith("data:")) return false;
        
        return true;
      });
      
      if (img) {
        currentImg = img;
        imgRect = img.getBoundingClientRect();
        
        const topPos = imgRect.top + 8;
        const leftPos = imgRect.right - 46;
        
        overlay.style.top = topPos + "px";
        overlay.style.left = leftPos + "px";
        overlay.style.display = "flex";
        
        overlay.dataset.url = img.currentSrc || img.src;

        ovRect = {
          top: topPos,
          left: leftPos,
          right: leftPos + 36,
          bottom: topPos + 36
        };
      }
    }
  }
})();
```

### `idb.js`
```javascript
const DB_NAME = "swj-db";
const DB_VERSION = 1;
const STORE = "kv";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function idbDelete(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
```

### `options.html`
```html
<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<title>Configurazione - Salva WebP in JPG</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 20px auto; max-width: 600px; padding: 0 20px; color: #222; }
  h1 { font-size: 20px; margin-bottom: 20px; }
  .card { border: 1px solid #e3e3e3; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
  .card .label { font-weight: 600; margin-bottom: 6px; display: block; }
  .path-box { background: #f5f5f5; padding: 10px; border-radius: 6px; border: 1px solid #ddd; font-family: monospace; word-break: break-all; margin-bottom: 10px; }
  .path-box.empty { color: #888; font-style: italic; }
  .btn-group { display: flex; gap: 10px; }
  button { cursor: pointer; padding: 8px 16px; border: 1px solid #ccc; background: #f7f7f7; border-radius: 8px; font: inherit; font-weight: 600; }
  button:hover { background: #ececec; }
  button.danger { color: #d32f2f; border-color: #ffcdd2; background: #ffebee; }
  button.danger:hover { background: #ffcdd2; }
  .note { font-size: 13px; color: #555; background: #f9f9f9; padding: 12px; border-radius: 8px; border-left: 4px solid #0b57d0; margin-top: 20px; }
  .info { font-size: 13px; margin: 6px 0; color: #444; }
  .info b { color: #222; }
  hr { border: 0; border-top: 1px solid #eee; margin: 20px 0; }
  input[type="number"] { padding: 6px; border: 1px solid #ccc; border-radius: 6px; width: 80px; font: inherit; }
</style>
</head>
<body>
  <h1>Configurazione</h1>

  <div class="card">
    <span class="label">Cartella immagini (JPG)</span>
    <div id="path-static" class="path-box empty">Non configurata (Chiederà dove salvare)</div>
    <div class="btn-group">
      <button id="pick-static">Scegli cartella…</button>
      <button id="clear-static" class="danger">Rimuovi</button>
    </div>
  </div>

  <div class="card">
    <span class="label">Cartella animazioni (GIF/WebP)</span>
    <div id="path-anim" class="path-box empty">Non configurata (Chiederà dove salvare)</div>
    <div class="btn-group">
      <button id="pick-anim">Scegli cartella…</button>
      <button id="clear-anim" class="danger">Rimuovi</button>
    </div>
  </div>

  <div class="card">
    <span class="label">Icona rapida sulle immagini</span>
    <div class="info" style="margin-bottom: 10px;">Se attivo, passando il mouse sulle immagini apparirà un'icona per salvarle al volo senza usare il tasto destro.</div>
    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 600; margin-bottom: 10px;">
      <input type="checkbox" id="toggle-quick-action" style="width: 18px; height: 18px; cursor: pointer;"> 
      Abilita icona rapida
    </label>
    <div style="display: flex; align-items: center; gap: 8px;">
      <label for="min-size-input" style="font-weight: 600;">Dimensione minima (px):</label>
      <input type="number" id="min-size-input" value="300" min="10" max="5000">
    </div>
  </div>

  <div class="card">
    <span class="label">Converti WebP animate in GIF</span>
    <div class="info" style="margin-bottom: 10px;">Se attivo, le WebP animate verranno convertite in GIF animate prima del salvataggio.</div>
    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 600;">
      <input type="checkbox" id="toggle-webp-gif" style="width: 18px; height: 18px; cursor: pointer;" checked> 
      Abilita conversione WebP → GIF
    </label>
  </div>

  <hr>
  <div class="info">Ultimo salvataggio: <b id="last-save">—</b></div>

  <div class="note">
    Se le cartelle non sono configurate, l'estensione aprirà la finestra "Salva con nome" (ricordando l'ultima posizione).<br><br>
    <i>Se Chrome ti chiede di ri-autorizzare la cartella dopo un riavvio, è un limite di sicurezza di Chrome. Basta cliccare di nuovo su "Scegli cartella".</i>
  </div>

  <script type="module" src="options.js"></script>
</body>
</html>
```

### `options.js`
```javascript
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
        const perm = await existingHandle.queryPermission({ mode: "readwrite" });
        if (perm === "granted") {
          await refreshUI();
          return; 
        }
        
        const req = await existingHandle.requestPermission({ mode: "readwrite" });
        if (req === "granted") {
          await refreshUI();
          return; 
        } else {
          return; 
        }
      } catch (err) {
        console.warn("Handle esistente non valido, apro il selettore.", err);
      }
    }

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
  const h = cachedHandles[idbKey]; 
  
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
```

## 5. Cosa resta da fare (Opzionale)
*   **Icone**: I file `icon.png` e le icone a 16/48/128px attualmente puntano allo stesso file base, andrebbero esportate nelle dimensioni corrette per una resa migliore.
*   **Limiti GIF**: La conversione WebP -> GIF non ha un limite di frame. Per video o animazioni lunghissime, la GIF risultante potrebbe essere molto pesante o causare un crash del browser. Si potrebbe aggiungere un limite massimo di frame (es. 300).
*   **Supporto Video**: È stato esplicitamente escluso per limiti tecnici (i video non sono immagini e richiederebbero API di registrazione schermo).