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
      
      // Troviamo l'immagine e controlliamo che sia un'immagine reale (HTTP/HTTPS)
      const img = elements.find(el => {
        if (el.tagName !== "IMG") return false;
        if (el.naturalWidth < MIN_SIZE || el.naturalHeight < MIN_SIZE) return false;
        
        // Ignoriamo blob:, data: e src vuoti (tipici dei video di YouTube o canvas dinamici)
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
        
        // Usiamo currentSrc (che è l'URL effettivo che il browser ha caricato)
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