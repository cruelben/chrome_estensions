chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "save-webp-as-jpg",
      title: "Salva WebP in JPG",
      contexts: ["image"]
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "save-webp-as-jpg" || !info.srcUrl || !tab || !tab.id) return;

  // Calcola la data e l'ora esatta per un nome unico (es. 20260926_193015123.jpg)
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const sec = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');

  const filename = y + m + d + "_" + h + min + sec + ms + ".jpg";

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [info.srcUrl, filename],
    func: async (imageUrl, filename) => {
      try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();

        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0);

        const targetBlob = await new Promise(resolve => {
          canvas.toBlob(resolve, "image/jpeg", 0.92);
        });

        const blobUrl = URL.createObjectURL(targetBlob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      } catch (error) {
        console.error("Errore durante il salvataggio:", error);
      }
    }
  });
});