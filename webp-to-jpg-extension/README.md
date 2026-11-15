# Technical Summary and Reset Prompt: "Salva WebP in JPG" Chrome Extension (v5.5)

This document contains the complete summary and final code of the Chrome extension we've been working on. It can be used as a "reset prompt" to start a new development session without losing context.

## 1. Project Goal
A Chrome extension (Manifest V3) that allows you to:
*   Save WebP, GIF, PNG, JPG, APNG, and AVIF images via the context menu (right-click) or via a floating quick-action icon.
*   **Automatic conversion to JPG**: static images are converted to JPG (with a white background to handle PNG/WebP transparency). Files that are already JPG are not re-compressed.
*   **Animation detection and conversion**: recognizes animated GIF, WebP, APNG, and AVIF. If the option is enabled, non-GIF animations are converted into an animated GIF using the `gifenc` library.
*   **Two configurable destination folders**: one for static images (JPG) and one for animations (GIF/WebP), saved silently without a dialog when configured and valid.
*   **Automatic folder selection on first use or when the configured folder is no longer valid**: if a folder for a category (JPG or anim) is missing, or if the saved one is no longer reachable (deleted, renamed, moved), a small popup window automatically opens to choose the destination folder. The choice is automatically saved in Options for that category, with a one-time notice (system notification) informing the user.
*   **Quick Action icon**: shows a floating download icon on images larger than a certain size (configurable, default 300×300) to save them with a single click, without going through the context menu.
*   **System notifications**: success or error notification at the end of each operation, including the "folder automatically set" notification when the picker is used.

## 2. Architecture and Structure
The extension is made up of the following files:

| File | Role |
|---|---|
| `manifest.json` | Defines permissions, the action, the options page, content script, and service worker. |
| `background.js` | Service Worker. Coordinates saving: receives the click from the context menu or the overlay icon, checks the validity of the configured folders, sends the image to the offscreen document for processing, and if no valid folder is found, opens the popup window (`picker.html`) to choose a new one. Also handles success/error notifications. |
| `offscreen.js` / `offscreen.html` | Invisible document (required in MV3 because the service worker has no access to Canvas/DOM). Fetches the image, sniffs its format, detects whether it's animated, converts it to JPG or GIF as needed, and writes the file to the configured folder. If writing fails because the folder is no longer reachable, it returns a fallback instead of raising an error, so the flow automatically moves on to the picker. |
| `gifenc.esm.js` | External library for encoding animated GIFs (color quantization + hand-written LZW encoding). |
| `idb.js` | IndexedDB wrapper, used to persistently store the references to the two folders (`FileSystemDirectoryHandle`) and the data of the last save. |
| `overlay.js` | Content script injected into every web page (`all_frames: true`). Shows the floating icon when the mouse hovers over a large enough image, and sends the save command to the background when clicked. Reads settings (icon color/position, minimum size) from `chrome.storage.local` and updates live if they change. |
| `options.html` / `options.js` | The extension's configuration page (opened by clicking the extension icon). Lets you: manually choose the two folders, remove them, enable/disable the quick-action icon and set its minimum size, choose the icon's color and position, enable/disable automatic GIF conversion, and view details of the last save. The folders shown here update automatically even when set via the picker, since both read/write from the same source (IndexedDB). |
| `picker.html` / `picker.js` | **New files.** Page shown in a small popup window when no valid folder is set for the requested category (JPG or GIF/animations). Lets the user choose the folder via Chrome's native picker (`showDirectoryPicker`); the chosen folder is automatically saved in Options for that category, the pending file is saved inside it, and two notifications are shown: one informing that the folder has been set, and the classic save-confirmation one. The window background is a soft orange, matching the extension's icon color. |

## 3. Save Flow (updated)
1.  The user right-clicks an image (context menu) or clicks the floating quick-action icon (overlay).
2.  `background.js` checks whether a valid folder exists (handle present **and** permission still granted) for the relevant category (static or animated).
3.  The image is sent to the offscreen document (`offscreen.js`), which downloads it, analyzes it, and converts it to the correct format (JPG for static images, GIF for animations if the option is enabled).
4.  **Case A — valid and reachable folder**: the file is written directly to the folder, with a success notification.
5.  **Case B — missing folder, or configured but no longer reachable** (e.g. deleted or renamed): `offscreen.js` catches the write error, and the result comes back as a "fallback". `background.js` temporarily stores the file (as a Data URL) in `chrome.storage.session` and opens `picker.html` in a popup window.
6.  In the popup, the user chooses the destination folder. The choice is saved in Options (IndexedDB) for that category, the pending file is written there, and the notifications are shown ("Folder set" + "Save successful!").
7.  If the user cancels the folder selection, no file is saved; the check restarts from scratch on the next save attempt.

## 4. Technical Choices and Constraints (Fixed Bugs)
*   **File corruption**: fixed by using Data URL strings to pass files between offscreen and background, avoiding ArrayBuffer corruption.
*   **JPG transparency**: the canvas is filled white (`#ffffff`) before drawing the image.
*   **WebP/APNG/AVIF → GIF bug (OffscreenCanvas)**: `track.codedWidth` returned `undefined`, causing a crash; fixed by decoding the first frame and using `image.displayWidth`/`image.displayHeight`. For APNG, Chrome's `ImageDecoder` doesn't recognize the `image/apng` mime type: `image/png` is passed to the decoder instead.
*   **Folder no longer reachable**: `queryPermission` can still return "granted" even if the physical folder has been deleted or renamed in the meantime. Fixed by catching the error at the moment of actually writing the file (`getFileHandle`/`createWritable`) and redirecting to the fallback (picker) instead of raising a visible error to the user.
*   **`showDirectoryPicker` requires a real, immediate user interaction**: it cannot be invoked directly from the service worker or after long asynchronous operations (fetch, conversion). Fixed by opening a dedicated popup window (`picker.html`), which is a standalone extension page: clicking the "Choose folder…" button inside it is a valid user interaction in the right context.
*   **Extension context invalidated**: a normal error that appears in content scripts (`overlay.js`) already injected into a page when the extension is manually reloaded during development (`chrome://extensions` → reload). Not a bug: just reload the test web page too after each extension reload.
*   **Folder permissions**: Chrome can revoke write permissions after a browser restart; in that case the configured folder will be reported as "invalid" and the picker will automatically prompt for a new selection.

## 5. Full Code

### `manifest.json`
```json
{
  "manifest_version": 3,
  "name": "Salva WebP in JPG",
  "version": "5.5",
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
    "windows"
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
      "js": ["overlay.js"],
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

async function handleProcess({ url, handleStaticValid, handleAnimValid, convertAnimatedToGif }) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("HTTP " + response.status);
  
  let originalBlob = await response.blob();
  const bytes = new Uint8Array(await originalBlob.arrayBuffer());

  let mime = sniffMime(bytes);
  let category = "static";
  let ext = "jpg";
  let isAnimated = false;

  // 1. Rilevamento Animazione
  if (mime === "image/gif") {
    isAnimated = isAnimatedGif(bytes);
    if (isAnimated) { category = "anim"; ext = "gif"; }
  } else if (mime === "image/webp") {
    isAnimated = isAnimatedWebp(bytes);
    if (isAnimated) { category = "anim"; ext = "webp"; }
  } else if (mime === "image/apng" || mime === "image/png") {
    // FIX: ImageDecoder di Chrome non riconosce "image/apng". Dobbiamo usare "image/png".
    isAnimated = await checkIfAnimated(originalBlob, "image/png");
    if (isAnimated) {
      category = "anim";
      ext = "apng";
    }
  } else if (mime === "image/avif") {
    isAnimated = await checkIfAnimated(originalBlob, "image/avif");
    if (isAnimated) { category = "anim"; ext = "avif"; }
  }

  // 2. Conversione in GIF (se richiesto)
  if (isAnimated && convertAnimatedToGif && ext !== "gif") {
    try {
      // Passiamo "image/png" se è un APNG
      const decoderMime = (mime === "image/apng" || mime === "image/png") ? "image/png" : mime;
      const gifBlob = await convertToGifBlob(originalBlob, decoderMime);
      originalBlob = gifBlob; 
      ext = "gif";
    } catch (e) {
      console.warn(`Conversione ${mime} -> GIF fallita. Salvo nel formato originale (${ext}).`, e);
    }
  }

  // 3. Salvataggio JPG (se statico)
  if (category === "static" && mime !== "image/jpeg") {
    originalBlob = await convertToJpgBlob(originalBlob);
  }

  const filename = buildFilename(ext);
  const isValidCategory = category === "anim" ? handleAnimValid : handleStaticValid;
  const handleKey = category === "anim" ? "handle-anim" : "handle-static";

  if (isValidCategory) {
    try {
      const dir = await idbGet(handleKey);
      const fileHandle = await dir.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(originalBlob);
      await writable.close();

      await idbSet("last-save", { filename, folder: dir.name, at: Date.now(), type: ext });
      return { filename, folder: dir.name, fallback: false, category };
    } catch (e) {
      // La cartella configurata non è più raggiungibile (es. cancellata/spostata):
      // passiamo al fallback (selezione nuova cartella) invece di generare un errore.
      // (nessun log: è un comportamento previsto, non un errore reale)
    }
  }

  const dataUrl = await blobToDataUrl(originalBlob);
  await idbSet("last-save", { filename, folder: "Salva con nome", at: Date.now(), type: ext });
  return { filename, fallback: true, dataUrl, category };
}

// Funzione generica per convertire in GIF
async function convertToGifBlob(imageBlob, mimeType) {
  const arrayBuffer = await imageBlob.arrayBuffer();
  const decoder = new ImageDecoder({ data: arrayBuffer, type: mimeType });
  await decoder.tracks.ready;
  
  const track = decoder.tracks.selectedTrack;
  
  if (!track || track.frameCount <= 1) {
    throw new Error("Non è un'animazione valida");
  }

  const firstFrame = await decoder.decode({ frameIndex: 0 });
  const width = firstFrame.image.displayWidth;
  const height = firstFrame.image.displayHeight;

  if (!width || !height) throw new Error("Dimensioni non valide.");

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

async function checkIfAnimated(blob, mime) {
  try {
    const decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type: mime });
    await decoder.tracks.ready;
    return decoder.tracks.selectedTrack.frameCount > 1;
  } catch (e) {
    console.warn(`Impossibile verificare l'animazione per ${mime}`, e);
    return false;
  }
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
  
  // PNG / APNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    let off = 8;
    while (off + 8 <= b.length) {
      const len = (b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3];
      const type = String.fromCharCode(b[off + 4], b[off + 5], b[off + 6], b[off + 7]);
      if (type === "acTL") return "image/apng";
      if (type === "IDAT") break;
      off += 4 + 4 + len + 4;
    }
    return "image/png";
  }
  
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  
  // WebP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  
  // AVIF
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (brand === "avif" || brand === "avis") return "image/avif";
  }

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

### `overlay.js`
```javascript
if (!window.swjOverlayInjected) {
  window.swjOverlayInjected = true;

  const COLORS = {
    red: "#d32f2f",
    black: "#000000",
    darkblue: "#1565c0"
  };
  const ICON_SIZE = 36;
  const PADDING = 8;

  const settings = { 
    iconColor: "red", 
    iconPosition: "follow",
    enableOverlay: true,
    minImageSize: 300
  };

  const icon = document.createElement("div");
  icon.id = "swj-overlay-icon";
  icon.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 3v11m0 0l-4-4m4 4l4-4" stroke="white" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
            stroke="white" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;

  const styleEl = document.createElement("style");
  styleEl.textContent = `
    #swj-overlay-icon {
      position: fixed;
      width: ${ICON_SIZE}px;
      height: ${ICON_SIZE}px;
      border-radius: 50%;
      display: none;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 2147483647;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      transition: transform 0.15s, background 0.15s;
      user-select: none;
      -webkit-user-select: none;
    }
    #swj-overlay-icon:hover { transform: scale(1.08); }
    #swj-overlay-icon svg { width: 20px; height: 20px; display: block; pointer-events: none; }
    #swj-overlay-icon:active { transform: scale(0.95); }
  `;

  (document.head || document.documentElement).appendChild(styleEl);
  (document.body || document.documentElement).appendChild(icon);

  let currentImg = null;

  function applySettings() {
    icon.style.background = COLORS[settings.iconColor] || COLORS.red;
    if (!settings.enableOverlay) {
      icon.style.display = "none";
      currentImg = null;
    } else if (currentImg) {
      positionIcon();
    }
  }

  chrome.storage.local.get(["iconColor", "iconPosition", "enableOverlay", "minImageSize"], (r) => {
    if (r.iconColor) settings.iconColor = r.iconColor;
    if (r.iconPosition) settings.iconPosition = r.iconPosition;
    if (r.enableOverlay !== undefined) settings.enableOverlay = r.enableOverlay;
    if (r.minImageSize) settings.minImageSize = r.minImageSize;
    applySettings();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.iconColor) settings.iconColor = changes.iconColor.newValue;
    if (changes.iconPosition) settings.iconPosition = changes.iconPosition.newValue;
    if (changes.enableOverlay) settings.enableOverlay = changes.enableOverlay.newValue;
    if (changes.minImageSize) settings.minImageSize = changes.minImageSize.newValue;
    applySettings();
  });

  function positionIcon() {
    if (!currentImg || !settings.enableOverlay) {
      icon.style.display = "none";
      return;
    }
    const rect = currentImg.getBoundingClientRect();

    // B1: se l'immagine è completamente fuori dal viewport, nascondi.
    if (
      rect.bottom <= 0 || rect.top >= window.innerHeight ||
      rect.right <= 0 || rect.left >= window.innerWidth
    ) {
      icon.style.display = "none";
      return;
    }

    if (settings.iconPosition === "center") {
      const cx = (rect.left + rect.right) / 2;
      const cy = (rect.top + rect.bottom) / 2;
      // D: stessa logica B1 (se il centro è fuori viewport, nascondi).
      if (cx < 0 || cx > window.innerWidth || cy < 0 || cy > window.innerHeight) {
        icon.style.display = "none";
        return;
      }
      icon.style.top = (cy - ICON_SIZE / 2) + "px";
      icon.style.left = (cx - ICON_SIZE / 2) + "px";
    } else {
      // "follow": angolo in alto a destra della porzione visibile.
      const visTop = Math.max(rect.top, 0);
      const visRight = Math.min(rect.right, window.innerWidth);
      if (visRight - Math.max(rect.left, 0) < ICON_SIZE + PADDING * 2) {
        icon.style.display = "none";
        return;
      }
      icon.style.top = (visTop + PADDING) + "px";
      icon.style.left = (visRight - ICON_SIZE - PADDING) + "px";
    }
    icon.style.display = "flex";
  }

  function selectImage(img) {
    if (!settings.enableOverlay) return;
    if (img === currentImg) {
      positionIcon();
      return;
    }
    currentImg = img;
    positionIcon();
  }

  document.addEventListener("mouseover", (e) => {
    if (!settings.enableOverlay) return;
    const t = e.target;
    if (!t || t.tagName !== "IMG") return;
    if (t === icon || icon.contains(t)) return;
    
    // Nasconde l'icona se ALMENO UNA delle due dimensioni è inferiore al minimo
    if (t.offsetWidth < settings.minImageSize || t.offsetHeight < settings.minImageSize) return;
    
    const src = t.currentSrc || t.src || "";
    if (/\.svg(\?|#|$)/i.test(src)) return;
    if (t.type && /svg/i.test(t.type)) return;
    
    selectImage(t);
  }, true);

  window.addEventListener("scroll", () => {
    if (currentImg) positionIcon();
  }, { passive: true });

  window.addEventListener("resize", () => {
    if (currentImg) positionIcon();
  }, { passive: true });

  icon.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentImg) return;
    const url = currentImg.currentSrc || currentImg.src;
    if (!url) return;
    chrome.runtime.sendMessage(
      { type: "save-from-overlay", url },
      () => void chrome.runtime.lastError
    );
    // L'icona resta agganciata all'immagine.
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
  .radio-group { display: flex; flex-direction: column; gap: 6px; }
  .radio-group label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .radio-group input[type="radio"] { accent-color: #0b57d0; }
  .input-row { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
  .input-row input[type="number"] { padding: 6px 10px; border: 1px solid #ccc; border-radius: 6px; width: 100px; font: inherit; }
  .checkbox-label { display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 600; }
  .checkbox-label input[type="checkbox"] { accent-color: #0b57d0; width: 18px; height: 18px; }
  .desc { font-size: 13px; color: #555; margin-bottom: 12px; }
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
    <div class="desc">Se attivo, passando il mouse sulle immagini apparirà un'icona per salvarle al volo senza usare il tasto destro.</div>
    <label class="checkbox-label">
      <input type="checkbox" id="enable-overlay"> Abilita icona rapida
    </label>
    <div class="input-row">
      <label for="min-image-size">Dimensione minima (px):</label>
      <input type="number" id="min-image-size" min="16" step="10" value="300">
    </div>
  </div>

  <div class="card">
    <span class="label">Converti animazioni in GIF</span>
    <div class="desc">Se attivo, le animazioni (WebP, APNG, AVIF) verranno convertite in GIF animate prima del salvataggio.</div>
    <label class="checkbox-label">
      <input type="checkbox" id="convert-anim-gif" checked> Abilita conversione in GIF
    </label>
  </div>

  <div class="card">
    <span class="label">Colore icona sulle immagini</span>
    <div class="radio-group">
      <label><input type="radio" name="iconColor" value="red" checked> Rosso (predefinito)</label>
      <label><input type="radio" name="iconColor" value="black"> Nero</label>
      <label><input type="radio" name="iconColor" value="darkblue"> Azzurro scuro</label>
    </div>
  </div>

  <div class="card">
    <span class="label">Posizione icona</span>
    <div class="radio-group">
      <label><input type="radio" name="iconPosition" value="follow" checked> Segue lo scroll (sempre visibile)</label>
      <label><input type="radio" name="iconPosition" value="center"> Al centro dell'immagine</label>
    </div>
  </div>

  <hr>
  <div class="info">Ultimo salvataggio: <b id="last-save">—</b></div>

  <div class="note">
    Se le cartelle non sono configurate (o non sono più valide), l'estensione aprirà una finestra popup per scegliere dove salvare, e ricorderà la scelta per le volte successive.<br><br>
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
```

### `picker.html`
```html
<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<title>Scegli cartella di destinazione</title>
<style>
  html, body {
    height: 100%;
    margin: 0;
  }
  body {
    font: 14px system-ui, sans-serif;
    color: #222;
    text-align: center;
    background: #fdf0e3;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px;
    box-sizing: border-box;
  }
  h1 { font-size: 17px; margin: 0 0 8px; }
  p { color: #555; margin: 0 0 16px; line-height: 1.4; }
  .filename {
    font-family: monospace;
    background: #ffffff;
    padding: 6px 10px;
    border-radius: 6px;
    display: inline-block;
    margin-bottom: 20px;
    word-break: break-all;
    border: 1px solid #f0d9bd;
  }
  .btn-group { display: flex; gap: 10px; justify-content: center; }
  button {
    cursor: pointer;
    padding: 10px 20px;
    border: 1px solid #e0b98a;
    background: #ffffff;
    border-radius: 8px;
    font: inherit;
    font-weight: 600;
  }
  button:hover { background: #fff6ec; }
  button.primary { background: #e8822c; color: white; border-color: #e8822c; }
  button.primary:hover { background: #d4741f; }
</style>
</head>
<body>
  <h1>Cartella non configurata</h1>
  <p>Non è stata trovata una cartella valida per i file <b id="category-label"></b>.<br>Scegli dove salvare: verrà ricordata per le prossime volte.</p>
  <div class="filename" id="filename-label"></div>
  <div class="btn-group">
    <button id="cancel-btn">Annulla</button>
    <button id="choose-btn" class="primary">Scegli cartella…</button>
  </div>
  <script type="module" src="picker.js"></script>
</body>
</html>
```

### `picker.js`
```javascript
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
```

## 6. Remaining To-Dos (Optional)
*   **Icons**: the `icon.png` file and the 16/48/128px icons currently all point to the same base file; they should be exported at the correct sizes for a better result.
*   **GIF frame limit**: GIF conversion has no frame limit. For very long animations, the resulting GIF could be heavy or cause slowdowns. A maximum frame limit (e.g. 300) could be added.
*   **Video support**: explicitly excluded due to technical constraints (videos aren't images and would require screen-recording APIs).