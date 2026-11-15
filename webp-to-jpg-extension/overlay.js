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
    
    // MODIFICA: Ora nasconde l'icona se ALMENO UNA delle due dimensioni è inferiore al minimo
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
    // C1: l'icona resta agganciata all'immagine.
  });
}