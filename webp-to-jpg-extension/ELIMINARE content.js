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