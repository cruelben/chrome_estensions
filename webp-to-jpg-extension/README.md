# Riepilogo Tecnico e Reset Prompt: Estensione Chrome "Salva WebP in JPG" (v5.5)

Questo documento contiene il riepilogo completo e il codice finale dell'estensione Chrome su cui abbiamo lavorato. Può essere usato come "prompt di reset" per iniziare una nuova sessione di sviluppo senza perdere il contesto.

## 1. Obiettivo del Progetto
Estensione per Google Chrome (Manifest V3) che permette di:
*   Salvare immagini WebP, GIF, PNG, JPG, APNG, AVIF tramite il menu contestuale (tasto destro) o tramite un'icona rapida fluttuante al passaggio del mouse.
*   **Conversione automatica in JPG**: le immagini statiche vengono convertite in JPG (sfondo bianco per gestire le trasparenze di PNG/WebP). I file già JPG non vengono ricompressi.
*   **Rilevamento e conversione animazioni**: riconosce GIF, WebP, APNG e AVIF animate. Se l'opzione è attiva, le animazioni non-GIF vengono convertite in GIF animata tramite la libreria `gifenc`.
*   **Due cartelle di destinazione configurabili**: una per le immagini statiche (JPG) e una per le animazioni (GIF/WebP), salvate silenziosamente senza dialog quando configurate e valide.
*   **Selezione automatica della cartella al primo utilizzo o se quella configurata non è più valida**: se manca una cartella per una categoria (JPG o anim), oppure se quella salvata non è più raggiungibile (cancellata, rinominata, spostata), si apre automaticamente una piccola finestra popup dove scegliere la cartella di destinazione. La scelta viene salvata automaticamente nelle Opzioni per quella categoria, con un avviso (notifica di sistema) che informa l'utente la prima volta.
*   **Icona Rapida (Quick Action)**: mostra un'icona di download fluttuante sulle immagini più grandi di una certa dimensione (configurabile, default 300×300) per salvarle con un solo click, senza passare dal menu contestuale.
*   **Notifiche di sistema**: notifica di successo o di errore al termine di ogni operazione, inclusa la notifica di "cartella impostata automaticamente" quando viene usato il picker.

## 2. Architettura e Struttura
L'estensione è composta dai seguenti file:

| File | Ruolo |
|---|---|
| `manifest.json` | Definisce permessi, azione, pagina opzioni, content script e service worker. |
| `background.js` | Service Worker. Coordina il salvataggio: riceve il click dal menu contestuale o dall'icona overlay, controlla la validità delle cartelle configurate, invia l'immagine all'offscreen document per l'elaborazione, e se manca una cartella valida apre la finestra popup (`picker.html`) per sceglierne una nuova. Gestisce anche le notifiche di successo/errore. |
| `offscreen.js` / `offscreen.html` | Documento invisibile (richiesto in MV3 perché il service worker non ha accesso a Canvas/DOM). Esegue il fetch dell'immagine, la sniffa per riconoscerne il formato, rileva se è animata, converte in JPG o GIF a seconda dei casi, e scrive il file nella cartella configurata. Se la scrittura fallisce perché la cartella non è più raggiungibile, restituisce un fallback invece di generare un errore, così il flusso passa automaticamente al picker. |
| `gifenc.esm.js` | Libreria esterna per la codifica delle GIF animate (quantizzazione colori + encoding LZW). |
| `idb.js` | Wrapper per IndexedDB, usato per memorizzare in modo persistente i riferimenti alle due cartelle (`FileSystemDirectoryHandle`) e i dati dell'ultimo salvataggio. |
| `overlay.js` | Content script iniettato in ogni pagina web (`all_frames: true`). Mostra l'icona flottante quando il mouse passa sopra un'immagine abbastanza grande, e invia il comando di salvataggio al background quando viene cliccata. Legge le impostazioni (colore/posizione icona, dimensione minima) da `chrome.storage.local` e si aggiorna in tempo reale se cambiano. |
| `options.html` / `options.js` | Pagina di configurazione dell'estensione (apribile cliccando sull'icona dell'estensione). Permette di: scegliere manualmente le due cartelle, rimuoverle, attivare/disattivare l'icona rapida e impostarne la dimensione minima, scegliere colore e posizione dell'icona, attivare/disattivare la conversione automatica in GIF, e vedere i dettagli dell'ultimo salvataggio. Le cartelle mostrate qui si aggiornano automaticamente anche quando vengono impostate tramite il picker, perché entrambi leggono/scrivono dalla stessa fonte (IndexedDB). |
| `picker.html` / `picker.js` | **Nuovi file.** Pagina mostrata in una piccola finestra popup quando manca una cartella valida per la categoria richiesta (JPG o GIF/animazioni). Permette di scegliere la cartella tramite il selettore nativo di Chrome (`showDirectoryPicker`); la cartella scelta viene salvata automaticamente nelle Opzioni per quella categoria, il file in sospeso viene salvato al suo interno, e vengono mostrate due notifiche: una che avvisa che la cartella è stata impostata e quella classica di conferma salvataggio. Lo sfondo della finestra è arancione tenue, coerente con il colore dell'icona dell'estensione. |

### File non più utilizzati
*   `content.js`: era il vecchio meccanismo di fallback "Salva con nome" (tramite tag `<a download>` iniettato nella pagina). Non è più necessario dato che il nuovo fallback passa dal picker con `showDirectoryPicker`, e può essere eliminato dal progetto.

## 3. Flusso di Salvataggio (aggiornato)
1.  L'utente clicca col tasto destro su un'immagine (menu contestuale) oppure clicca sull'icona rapida flottante (overlay).
2.  `background.js` controlla se esiste una cartella valida (handle presente **e** permesso ancora concesso) per la categoria corrispondente (statica o animata).
3.  L'immagine viene inviata all'offscreen document (`offscreen.js`), che la scarica, la analizza, e la converte nel formato corretto (JPG per le statiche, GIF per le animazioni se l'opzione è attiva).
4.  **Caso A — cartella valida e raggiungibile**: il file viene scritto direttamente nella cartella, con notifica di successo.
5.  **Caso B — cartella mancante, oppure configurata ma non più raggiungibile** (es. cancellata o rinominata): `offscreen.js` intercetta l'errore di scrittura, e il risultato torna come "fallback". `background.js` salva temporaneamente il file (come Data URL) in `chrome.storage.session` e apre `picker.html` in una finestra popup.
6.  Nel popup, l'utente sceglie la cartella di destinazione. La scelta viene salvata nelle Opzioni (IndexedDB) per quella categoria, il file in sospeso viene scritto lì, e vengono mostrate le notifiche ("Cartella impostata" + "Salvataggio riuscito!").
7.  Se l'utente annulla la selezione della cartella, nessun file viene salvato; al prossimo tentativo di salvataggio il controllo riparte da zero.

## 4. Scelte Tecniche e Vincoli (Bug Risolti)
*   **Corruzione dei file**: risolto usando stringhe DataURL per passare i file tra offscreen e background, evitando la corruzione degli ArrayBuffer.
*   **Trasparenza JPG**: il canvas viene riempito di bianco (`#ffffff`) prima di disegnare l'immagine.
*   **Bug WebP/APNG/AVIF → GIF (OffscreenCanvas)**: `track.codedWidth` restituiva `undefined` causando un crash; risolto decodificando il primo frame e usando `image.displayWidth`/`image.displayHeight`. Per gli APNG, `ImageDecoder` di Chrome non riconosce il mime `image/apng`: viene passato `image/png` al decoder.
*   **Cartella non più raggiungibile**: `queryPermission` può restituire "granted" anche se la cartella fisica è stata cancellata o rinominata nel frattempo. Risolto intercettando l'errore al momento della scrittura effettiva del file (`getFileHandle`/`createWritable`) e reindirizzando al fallback (picker) invece di generare un errore visibile all'utente.
*   **`showDirectoryPicker` richiede un'interazione utente reale e immediata**: non può essere invocato direttamente dal service worker o dopo operazioni asincrone lunghe (fetch, conversione). Risolto aprendo una finestra popup dedicata (`picker.html`), che è una pagina dell'estensione a sé stante: il click sul pulsante "Scegli cartella…" al suo interno è un'interazione utente valida nel contesto giusto.
*   **Extension context invalidated**: errore normale che appare negli script di content (`overlay.js`) già iniettati in una pagina quando l'estensione viene ricaricata manualmente durante lo sviluppo (`chrome://extensions` → reload). Non è un bug: basta ricaricare anche la pagina web di test dopo ogni reload dell'estensione.
*   **Permessi Cartelle**: Chrome può revocare i permessi di scrittura dopo un riavvio del browser; in tal caso la cartella configurata risulterà "non valida" e scatterà automaticamente la richiesta di nuova selezione tramite il picker.

## 5. Il Codice Completo

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

## 6. Cosa resta da fare (Opzionale)
*   **Icone**: i file `icon.png` e le icone a 16/48/128px attualmente puntano allo stesso file base; andrebbero esportate nelle dimensioni corrette per una resa migliore.
*   **Limiti GIF**: la conversione in GIF non ha un limite di frame. Per animazioni molto lunghe, la GIF risultante potrebbe essere pesante o causare rallentamenti. Si potrebbe aggiungere un limite massimo di frame (es. 300).
*   **Supporto Video**: esplicitamente escluso per limiti tecnici (i video non sono immagini e richiederebbero API di registrazione schermo).
*   **Pulizia file obsoleti**: il file `content.js` (vecchio fallback "Salva con nome") non è più referenziato nel `manifest.json` e può essere rimosso dal progetto.