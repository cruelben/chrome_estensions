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