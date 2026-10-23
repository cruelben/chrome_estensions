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

// --- CONVERSIONE WEBP ANIMATA -> GIF ANIMATA (Corretta) ---
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

  // Decodifica il primo frame per ottenere le dimensioni esatte
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
    
    // image.duration è in microsecondi, gifenc vuole millisecondi
    const delay = image.duration ? Math.round(image.duration / 1000) : 100;
    
    gif.writeFrame(index, canvas.width, canvas.height, { palette, delay });
    
    image.close(); 
  }
  
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}
// ----------------------------------------------------------------

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