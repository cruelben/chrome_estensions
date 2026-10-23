/* ============================================================
   GIF FRAME MASTER
   app.js - versione completa (parte 1/3)
   ============================================================ */


/* ============================================================
   VARIABILI GLOBALI
   ============================================================ */

let originalFrames = [];
let composedFrames = [];

let selectedFrames = new Set();

let gifWidth = 0;
let gifHeight = 0;

let cropRect = {
    x: 0,
    y: 0,
    width: 0,
    height: 0
};

let cropInteraction = null;

let cropPreviewOverrideIndex = null;

let currentExportData = null;

let speedMultiplier = 1;

let undoStack = [];

const UNDO_LIMIT = 20;


/* Modalità della label file: "load" | "import" */
let fileButtonMode = "load";


/* Tab attualmente attiva */
let currentTab = "load";


/* Stato drag & drop riordino frame */
let dragSourceIndices = [];
let dragTargetIndex = null;


/* Ultimo frame cliccato (per selezione con SHIFT) */
let lastSelectedFrameIndex = null;


/* Stato anteprima animata (tab 2 - frames) */
let animTimerId = null;
let animCurrentIndex = -1;
let animPlaying = false;


/* Stato anteprima animata (tab 4 - crop) */
let cropAnimTimerId = null;
let cropAnimCurrentIndex = -1;
let cropAnimPlaying = false;


/* Nome del file GIF originale (solo la prima GIF caricata) */
let originalFileName = "";


/* Dimensione in byte del file GIF originale */
let originalFileSize = 0;


/* ============================================================
   RESIZE - STATO
   ============================================================ */

let resizeWidth = 0;
let resizeHeight = 0;

let resizeLockAspect = true;

let resizeAspectRatio = 1;

const RESIZE_MAX_SIDE = 4000;

let resizePreviewTimer = null;


/* ============================================================
   GIFSICLE - STATO
   ============================================================ */

const GIFSICLE_LEVELS = {

    lossless: {
        optimize: "-O1",
        lossy: null,
        defaultColors: 256,
        defaultDither: true
    },

    light: {
        optimize: "-O1",
        lossy: 20,
        defaultColors: 256,
        defaultDither: true
    },

    balanced: {
        optimize: "-O1",
        lossy: 40,
        defaultColors: 256,
        defaultDither: true
    },

    aggressive: {
        optimize: "-O1",
        lossy: 80,
        defaultColors: 256,
        defaultDither: true
    },

    extreme: {
        optimize: "-O1",
        lossy: 80,
        defaultColors: 128,
        defaultDither: true
    },

    custom: {
        optimize: "-O1",
        lossy: null,
        defaultColors: 256,
        defaultDither: true
    }
};


/* Risultati intermedi per la tabella di confronto */
let lastGifshotSizeBytes = 0;
let lastOptimizedSizeBytes = 0;
let lastOptimizationSucceeded = false;


/* ============================================================
   FUNZIONE DI SUPPORTO DOM
   ============================================================ */

function $(id) {
    return document.getElementById(id);
}


/* ============================================================
   GESTIONE ERRORI - BOX IN UI
   ============================================================ */

function showErrorBox(boxId, messageId, techId, message, error) {

    const box = $(boxId);
    const msgEl = $(messageId);
    const techEl = $(techId);

    if (!box || !msgEl) {
        alert(message + (error ? "\n\n" + error.message : ""));
        return;
    }

    msgEl.textContent = message;

    if (techEl) {
        techEl.textContent = error
            ? (error.stack || error.message || String(error))
            : "";
    }

    box.classList.add("visible");
}

function hideErrorBox(boxId) {

    const box = $(boxId);

    if (box) {
        box.classList.remove("visible");
    }
}


/* ============================================================
   RIFERIMENTI ELEMENTI HTML
   ============================================================ */

const fileInput = $("gif-file");
const loading = $("loading");
const workspace = $("workspace");
const cropWorkspace = $("crop-workspace");
const exportWorkspace = $("export-workspace");

const framesGrid = $("frames-grid");
const frameCount = $("frame-count");
const gifDimensions = $("gif-dimensions");

const cropCanvas = $("crop-canvas");
const cropContainer = $("crop-container");
const cropSelection = $("crop-selection");

const cropX = $("crop-x");
const cropY = $("crop-y");
const cropWidth = $("crop-width");
const cropHeight = $("crop-height");

const exportStatus = $("export-status");
const exportPreview = $("export-preview");


/* ============================================================
   CONTROLLO ELEMENTI PRINCIPALI
   ============================================================ */

if (!fileInput) {
    console.error("GIF Frame Master: #gif-file not found.");
}

if (!framesGrid) {
    console.error("GIF Frame Master: #frames-grid not found.");
}


/* ============================================================
   GESTIONE UNDO
   ============================================================ */

function pushUndoSnapshot() {

    undoStack.push({
        composedFrames: composedFrames.slice(),
        selectedFrames: new Set(selectedFrames)
    });

    if (undoStack.length > UNDO_LIMIT) {
        undoStack.shift();
    }
}

function undoLastAction() {

    if (undoStack.length === 0) {
        return;
    }

    const snapshot = undoStack.pop();

    composedFrames = snapshot.composedFrames;
    selectedFrames = snapshot.selectedFrames;
    lastSelectedFrameIndex = null;

    renderFramesGrid();
    updateFrameCount();
    updateCropPreview();
    updateSpeedPreview();
    updateAnimPreview();
}

const undoButton = $("undo-action");

if (undoButton) {
    undoButton.addEventListener("click", function () {
        undoLastAction();
    });
}


/* ============================================================
   GESTIONE TAB
   ============================================================ */

function switchTab(name) {

    currentTab = name;

    const tabButtons = document.querySelectorAll(".tab-button");

    tabButtons.forEach(function (btn) {
        if (btn.dataset.tab === name) {
            btn.classList.add("active");
        }
        else {
            btn.classList.remove("active");
        }
    });

    const tabPanels = document.querySelectorAll(".tab-panel");

    tabPanels.forEach(function (panel) {
        if (panel.dataset.panel === name) {
            panel.classList.add("active");
        }
        else {
            panel.classList.remove("active");
        }
    });

    updateTabStates();

    window.scrollTo({ top: 0, behavior: "smooth" });

    if (name === "crop") {
        resizeCropCanvasDisplay();
        updateCropSelectionDisplay();
    }

    if (name === "import") {
        resizeImportWindowDisplay();
        updateImportTransformDisplay();
    }

    if (name === "resize") {
        syncResizeTabFromCrop();
        renderResizePreview();
    }

    if (name === "export") {
        updateExportSourceLabel();
    }

    if (name !== "frames" && animPlaying) {
        stopAnimPreview();
    }

    if (name !== "crop" && cropAnimPlaying) {
        stopCropAnimPreview();
    }
}

function updateTabStates() {

    const hasFrames = composedFrames.length > 0;
    const hasImportInProgress = importFrames.length > 0;

    const tabButtons = document.querySelectorAll(".tab-button");

    tabButtons.forEach(function (btn) {

        const tab = btn.dataset.tab;

        if (tab === "load") {
            btn.disabled = false;
            return;
        }

        if (
            tab === "frames" ||
            tab === "crop" ||
            tab === "resize" ||
            tab === "export"
        ) {
            btn.disabled = !hasFrames;
            return;
        }

        if (tab === "import") {
            btn.disabled = !hasImportInProgress;
            return;
        }
    });

    const cropDot = document.getElementById("tab-dot-crop");

    if (cropDot) {

        const isFullFrame =
            cropRect.x === 0 &&
            cropRect.y === 0 &&
            cropRect.width === gifWidth &&
            cropRect.height === gifHeight;

        cropDot.style.display =
            (hasFrames && !isFullFrame)
                ? "inline-block"
                : "none";
    }

    const resizeDot = document.getElementById("tab-dot-resize");

    if (resizeDot) {

        const isSameAsCrop =
            resizeWidth === cropRect.width &&
            resizeHeight === cropRect.height;

        resizeDot.style.display =
            (hasFrames && !isSameAsCrop)
                ? "inline-block"
                : "none";
    }

    const tab1Next = document.getElementById("tab1-next");

    if (tab1Next) {
        tab1Next.disabled = !hasFrames;
    }

    if (currentTab === "import" && !hasImportInProgress) {
        switchTab(hasFrames ? "frames" : "load");
    }

    if (
        (currentTab === "frames" ||
         currentTab === "crop" ||
         currentTab === "resize" ||
         currentTab === "export") &&
        !hasFrames
    ) {
        switchTab("load");
    }

    updateTabCounters();
}

function updateTabCounters() {

    const counterFrames =
        document.getElementById("tab-counter-frames");

    if (counterFrames) {

        const total = composedFrames.length;
        const removed = selectedFrames.size;
        const active = total - removed;

        if (total > 0) {
            counterFrames.textContent = String(active);
            counterFrames.style.display = "inline-block";
        }
        else {
            counterFrames.textContent = "";
            counterFrames.style.display = "none";
        }
    }

    const counterCrop =
        document.getElementById("tab-counter-crop");

    if (counterCrop) {

        const isFullFrame =
            cropRect.x === 0 &&
            cropRect.y === 0 &&
            cropRect.width === gifWidth &&
            cropRect.height === gifHeight;

        if (gifWidth > 0 && gifHeight > 0 && !isFullFrame) {

            counterCrop.textContent =
                `${Math.round(cropRect.width)}×${Math.round(cropRect.height)}`;

            counterCrop.style.display = "inline-block";
        }
        else {
            counterCrop.textContent = "";
            counterCrop.style.display = "none";
        }
    }

    const counterResize =
        document.getElementById("tab-counter-resize");

    if (counterResize) {

        const isSameAsCrop =
            resizeWidth === cropRect.width &&
            resizeHeight === cropRect.height;

        if (
            resizeWidth > 0 &&
            resizeHeight > 0 &&
            !isSameAsCrop
        ) {

            counterResize.textContent =
                `${Math.round(resizeWidth)}×${Math.round(resizeHeight)}`;

            counterResize.style.display = "inline-block";
        }
        else {
            counterResize.textContent = "";
            counterResize.style.display = "none";
        }
    }
}


/* ============================================================
   LISTENER DEI TAB
   ============================================================ */

const tabBar = document.getElementById("tab-bar");

if (tabBar) {

    tabBar.addEventListener("click", function (event) {

        const btn = event.target.closest(".tab-button");

        if (!btn) {
            return;
        }

        if (btn.disabled) {
            return;
        }

        switchTab(btn.dataset.tab);
    });
}


/* ============================================================
   LISTENER NEXT / BACK
   ============================================================ */

document.addEventListener("click", function (event) {

    const btn = event.target.closest(
        "button[data-next], button[data-prev]"
    );

    if (!btn) {
        return;
    }

    if (btn.disabled) {
        return;
    }

    const target = btn.dataset.next || btn.dataset.prev;

    if (target) {
        switchTab(target);
    }
});


/* ============================================================
   AGGIORNA STATO PULSANTE FILE
   ============================================================ */

function updateFileButtonState() {

    const label = $("gif-file-label");
    const description = $("file-description");
    const cardTitle = $("file-card-title");
    const clearAllTab1 = $("clear-all-tab1");

    if (!label || !description) {
        return;
    }

    const tab1Button =
        document.querySelector('.tab-button[data-tab="load"]');

    if (composedFrames.length === 0) {

        fileButtonMode = "load";

        label.textContent = "Select GIF";

        description.textContent =
            "Select an animated GIF to edit";

        if (cardTitle) {
            cardTitle.textContent = "1. Load a GIF";
        }

        if (tab1Button) {
            tab1Button.textContent = "1. Load";
        }

        if (clearAllTab1) {
            clearAllTab1.style.display = "none";
        }
    }
    else {

        fileButtonMode = "import";

        label.textContent = "➕ Add GIF to queue";

        description.textContent =
            "Append another GIF to the existing sequence";

        if (cardTitle) {
            cardTitle.textContent = "1. Add a GIF to the queue";
        }

        if (tab1Button) {
            tab1Button.textContent = "1. Add";
        }

        if (clearAllTab1) {
            clearAllTab1.style.display = "inline-block";
        }
    }

    if (typeof updateTabStates === "function") {
        updateTabStates();
    }
}


/* ============================================================
   NOME FILE SORGENTE (tab 6)
   ============================================================ */

function updateExportSourceLabel() {

    const el = $("export-source-name");

    if (!el) {
        return;
    }

    if (originalFileName) {
        el.textContent = originalFileName;
    }
    else {
        el.textContent = "-";
    }
}


/* ============================================================
   NOME FILE ESPORTATO
   ============================================================ */

function getExportFileName() {

    if (!originalFileName) {
        return "GIF_Frame_Master.gif";
    }

    const baseName = originalFileName.replace(/\.gif$/i, "");

    if (!baseName) {
        return "GIF_Frame_Master.gif";
    }

    return baseName + "_edited.gif";
}


/* ============================================================
   UTILITY: FORMATTAZIONE NUMERI
   ============================================================ */

function formatBytes(bytes) {

    if (!Number.isFinite(bytes) || bytes < 0) {
        return "-";
    }

    if (bytes < 1024) {
        return bytes + " B";
    }

    if (bytes < 1024 * 1024) {
        return (bytes / 1024).toFixed(2) + " KB";
    }

    if (bytes < 1024 * 1024 * 1024) {
        return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    }

    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}


function formatDuration(ms) {

    if (!Number.isFinite(ms) || ms < 0) {
        return "-";
    }

    return (ms / 1000).toFixed(2) + " s";
}


function formatPercentChange(newValue, oldValue) {

    if (!Number.isFinite(oldValue) || oldValue === 0) {
        return null;
    }

    const pct = ((newValue - oldValue) / oldValue) * 100;

    const sign = pct > 0 ? "+" : "";

    return sign + pct.toFixed(0) + "%";
}


/* ============================================================
   ANTEPRIMA A GRANDEZZA REALE DI UN FOTOGRAMMA (singolo)
   ============================================================ */

function openFramePreview(frameCanvas, index) {

    const dataUrl = frameCanvas.toDataURL("image/png");

    const previewWindow = window.open("", "_blank");

    if (!previewWindow) {

        alert(
            "The browser blocked the new window.\n\n" +
            "Allow popups for this page and try again."
        );

        return;
    }

    previewWindow.document.title =
        `Frame #${index + 1} - ${frameCanvas.width}×${frameCanvas.height}`;

    const body = previewWindow.document.body;

    body.style.margin = "0";
    body.style.background = "#111827";
    body.style.display = "flex";
    body.style.alignItems = "center";
    body.style.justifyContent = "center";
    body.style.minHeight = "100vh";

    const img = previewWindow.document.createElement("img");

    img.src = dataUrl;
    img.width = frameCanvas.width;
    img.height = frameCanvas.height;
    img.style.imageRendering = "pixelated";

    body.appendChild(img);
}


/* ============================================================
   ANTEPRIMA ANIMATA 1:1 IN NUOVA SCHEDA
   ============================================================
   Apre una nuova scheda con un player HTML che cicla i frame
   originali (senza crop/resize). Il player ha:
     - Canvas che scala a max 90vh (image-rendering: pixelated)
     - Badge #N semitrasparente in alto a destra, sempre
       visibile, con numero frame corrente in tempo reale
     - Slider per saltare a un frame specifico
     - Pulsante Play/Stop
     - Selettore velocità (0.25x / 0.5x / 1x) con default 0.5x
     - Numero frame corrente + delay sotto il canvas
   ============================================================ */


/* ============================================================
   ANTEPRIMA ANIMATA 1:1 IN NUOVA SCHEDA (via player.html)
   ============================================================
   Apre player.html in una nuova scheda e gli passa i dati
   dei frame via postMessage. Il player gestisce:
     - canvas animato con badge #N
     - slider per saltare a un frame
     - pulsante Play/Stop
     - bottoni velocità (0.25x / 0.5x / 1x)

   Questa architettura è compatibile con la CSP delle
   estensioni Chrome MV3 (niente script inline).
   ============================================================ */

function openAnimatedPreview(frames, width, height) {

    if (!frames || !frames.length) {
        return;
    }

    /* Se troppi frame, avvisa prima di procedere */

    if (frames.length > 200) {

        const ok = confirm(
            `This GIF has ${frames.length} frames.\n\n` +
            `Opening the 1:1 animated preview may use a lot ` +
            `of memory and slow down the browser.\n\n` +
            `Continue?`
        );

        if (!ok) {
            return;
        }
    }

    /* Serializza i frame in data URL PNG */

    const dataUrls = [];

    for (let i = 0; i < frames.length; i++) {

        const frame = frames[i];

        if (!frame || !frame.canvas) {
            continue;
        }

        try {

            const url = frame.canvas.toDataURL("image/png");

            dataUrls.push({
                url: url,
                delay: frame.delay || 100
            });
        }
        catch (e) {
            console.warn("Could not serialize frame", i, e);
        }
    }

    if (!dataUrls.length) {
        alert("No frames to preview.");
        return;
    }

    /* Apri la nuova scheda con player.html */

    const win = window.open("player.html", "_blank");

    if (!win) {

        alert(
            "The browser blocked the new window.\n\n" +
            "Allow popups for this page and try again."
        );

        return;
    }

    /* Aspetta che player.html sia pronto, poi invia i dati.
       La nuova scheda ha il suo script player.js che aspetta
       un postMessage con "type: gif-frame-master-preview".

       Inviamo il messaggio DUE volte (a 100ms e 500ms) perché
       non possiamo sapere esattamente quando la nuova scheda
       ha completato il caricamento. Il player gestisce il
       primo messaggio ricevuto e ignora eventuali duplicati. */

    const payload = {
        type: "gif-frame-master-preview",
        payload: {
            frames: dataUrls,
            width: width,
            height: height
        }
    };

    function sendPayload() {

        try {

            if (win && !win.closed) {
                win.postMessage(payload, "*");
            }
        }
        catch (err) {
            console.warn("Could not send payload to player:", err);
        }
    }

    /* Tentativo 1: appena possibile */

    setTimeout(sendPayload, 100);

    /* Tentativo 2: dopo mezzo secondo (fallback) */

    setTimeout(sendPayload, 500);

    /* Tentativo 3: dopo un secondo (ulteriore fallback) */

    setTimeout(sendPayload, 1200);
}




/* ============================================================
   VALORE NUMERICO SOGLIA DUPLICATI
   ============================================================ */

const duplicateThresholdInput = $("duplicate-threshold");
const duplicateThresholdValue = $("duplicate-threshold-value");

function updateDuplicateThresholdLabel() {

    if (!duplicateThresholdInput || !duplicateThresholdValue) {
        return;
    }

    const val = parseFloat(duplicateThresholdInput.value);

    duplicateThresholdValue.textContent =
        val.toFixed(1) + "%";
}

if (duplicateThresholdInput) {

    duplicateThresholdInput.addEventListener(
        "input",
        updateDuplicateThresholdLabel
    );

    updateDuplicateThresholdLabel();
}


/* ============================================================
   CONTROLLO GIFUCT-JS
   ============================================================ */

function getGifuct() {

    if (
        window.gifuct &&
        typeof window.gifuct.parseGIF === "function" &&
        typeof window.gifuct.decompressFrames === "function"
    ) {
        return { type: "modern", library: window.gifuct };
    }

    if (
        window.gifuctjs &&
        typeof window.gifuctjs.parseGIF === "function" &&
        typeof window.gifuctjs.decompressFrames === "function"
    ) {
        return { type: "modern", library: window.gifuctjs };
    }

    if (typeof window.GIF === "function") {
        return { type: "legacy", library: window.GIF };
    }

    return null;
}


/* ============================================================
   CONTROLLO GIFSHOT
   ============================================================ */

function getGifshot() {

    if (
        window.gifshot &&
        typeof window.gifshot.createGIF === "function"
    ) {
        return window.gifshot;
    }

    return null;
}


/* ============================================================
   CONTROLLO GIFSICLE
   ============================================================ */

function getGifsicle() {

    if (
        window.gifsicle &&
        typeof window.gifsicle.run === "function"
    ) {
        return window.gifsicle;
    }

    return null;
}


/* ============================================================
   CARICAMENTO FILE GIF
   ============================================================ */

if (fileInput) {

    fileInput.addEventListener("change", async function (event) {

        const file = event.target.files[0];

        if (!file) {
            return;
        }

        hideErrorBox("load-error-box");
        hideErrorBox("import-error-box");

        if (
            file.type !== "image/gif" &&
            !file.name.toLowerCase().endsWith(".gif")
        ) {

            alert("The selected file is not a GIF.");

            fileInput.value = "";

            return;
        }


        /* ----------------------------------------------------
           MODALITÀ IMPORT: accoda all'esistente
           ---------------------------------------------------- */

        if (
            fileButtonMode === "import" &&
            composedFrames.length > 0
        ) {

            try {

                const buffer = await file.arrayBuffer();

                await loadImportGif(buffer);
            }
            catch (error) {

                console.error("IMPORT GIF ERROR:", error);

                showErrorBox(
                    "import-error-box",
                    "import-error-message",
                    "import-error-technical",
                    "Could not read the GIF to append.",
                    error
                );

                updateTabStates();

                if (importFrames.length > 0) {
                    switchTab("import");
                }
                else {
                    switchTab("load");
                }
            }
            finally {

                fileInput.value = "";
            }

            return;
        }


        /* ----------------------------------------------------
           MODALITÀ LOAD: carica GIF principale
           ---------------------------------------------------- */

        if (loading) {
            loading.style.display = "inline";
        }

        if (exportPreview) {
            exportPreview.style.display = "none";
        }


        selectedFrames.clear();

        undoStack = [];

        importFrames = [];
        importGifWidth = 0;
        importGifHeight = 0;
        importPreviewOverrideIndex = null;
        importDragState = null;

        speedMultiplier = 1;

        lastGifshotSizeBytes = 0;
        lastOptimizedSizeBytes = 0;
        lastOptimizationSucceeded = false;

        const speedSliderReset = $("speed-slider");

        if (speedSliderReset) {
            speedSliderReset.value = "1";
        }

        if (exportStatus) exportStatus.textContent = "";

        hideExportComparison();

        const oldDownloadButton = $("download-gif");

        if (oldDownloadButton) {
            oldDownloadButton.remove();
        }


        originalFileName = file.name;
        originalFileSize = file.size;


        try {

            console.log(
                "GIF Frame Master: loading:",
                file.name,
                "(" + formatBytes(file.size) + ")"
            );

            const buffer = await file.arrayBuffer();

            await loadGif(buffer);

            console.log("GIF loaded successfully.");
        }
        catch (error) {

            console.error("GIF ERROR:", error);

            showErrorBox(
                "load-error-box",
                "load-error-message",
                "load-error-technical",
                "Could not load the GIF. Check that the file is a valid animated GIF.",
                error
            );
        }
        finally {

            if (loading) loading.style.display = "none";

            fileInput.value = "";
        }
    });
}


/* ============================================================
   LETTURA GIF
   ============================================================ */

async function loadGif(buffer) {

    const gifuct = getGifuct();

    if (!gifuct) {

        throw new Error(
            "gifuct-js was not found. Make sure gifuct-js.min.js " +
            "is in the extension folder."
        );
    }

    console.log("gifuct-js found:", gifuct.type);

    let gif = null;
    let frames = null;


    if (gifuct.type === "modern") {

        console.log("Using gifuct-js modern API.");

        gif = gifuct.library.parseGIF(buffer);

        frames = gifuct.library.decompressFrames(gif, true);
    }
    else if (gifuct.type === "legacy") {

        console.log("Using gifuct-js legacy API.");

        const decoder = new gifuct.library(buffer);

        frames = decoder.decompressFrames(true);
    }


    if (!frames || !Array.isArray(frames) || frames.length === 0) {
        throw new Error("No frames found in the GIF.");
    }

    console.log("Frames found:", frames.length);


    if (gif && gif.lsd && gif.lsd.width && gif.lsd.height) {
        gifWidth = gif.lsd.width;
        gifHeight = gif.lsd.height;
    }
    else if (frames[0].dims) {
        gifWidth = frames[0].dims.width;
        gifHeight = frames[0].dims.height;
    }

    if (!gifWidth || !gifHeight) {
        throw new Error("Could not determine GIF dimensions.");
    }


    originalFrames = frames;

    selectedFrames.clear();


    composedFrames = composeAllFrames(
        frames,
        gifWidth,
        gifHeight
    );

    if (!composedFrames.length) {
        throw new Error("Could not rebuild frames.");
    }


    if (gifDimensions) {
        gifDimensions.textContent =
            `${gifWidth} × ${gifHeight} px`;
    }

    renderFramesGrid();

    cropPreviewOverrideIndex = null;

    const cropPreviewFrameReset = $("crop-preview-frame");

    if (cropPreviewFrameReset) {

        cropPreviewFrameReset.value = "1";

        cropPreviewFrameReset.max = composedFrames.length;
    }

    resetCrop();

    syncResizeTabFromCrop();

    updateCropPreview();

    updateFrameCount();

    updateSpeedPreview();

    updateAnimPreview();

    updateFileButtonState();

    updateExportSourceLabel();

    updateTabStates();

    switchTab("frames");
}


/* ============================================================
   RICOSTRUZIONE COMPLETA DEI FRAME
   ============================================================ */

function composeAllFrames(frames, width, height) {

    const result = [];

    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext(
        "2d",
        { willReadFrequently: true }
    );

    ctx.clearRect(0, 0, width, height);

    let previousFrame = null;
    let previousCanvasData = null;

    for (let i = 0; i < frames.length; i++) {

        const frame = frames[i];

        if (previousFrame) {

            if (previousFrame.disposalType === 2) {

                const d = previousFrame.dims;

                ctx.clearRect(
                    d.left,
                    d.top,
                    d.width,
                    d.height
                );
            }
            else if (
                previousFrame.disposalType === 3 &&
                previousCanvasData
            ) {

                ctx.putImageData(previousCanvasData, 0, 0);
            }
        }

        if (frame.disposalType === 3) {
            previousCanvasData =
                ctx.getImageData(0, 0, width, height);
        }
        else {
            previousCanvasData = null;
        }

        if (frame.patch && frame.dims) {

            const imageData = new ImageData(
                frame.patch,
                frame.dims.width,
                frame.dims.height
            );

            ctx.putImageData(
                imageData,
                frame.dims.left,
                frame.dims.top
            );
        }

        const frameCanvas = document.createElement("canvas");

        frameCanvas.width = width;
        frameCanvas.height = height;

        const frameCtx = frameCanvas.getContext("2d");

        frameCtx.drawImage(canvas, 0, 0);

        result.push({
            canvas: frameCanvas,
            delay: normalizeDelay(frame.delay),
            disposalType: frame.disposalType || 0
        });

        previousFrame = frame;
    }

    return result;
}


/* ============================================================
   NORMALIZZAZIONE DEL DELAY
   ============================================================ */

function normalizeDelay(delay) {

    let value = Number(delay);

    if (!Number.isFinite(value) || value <= 0) {
        value = 100;
    }

    return Math.max(10, Math.round(value));
}


/* ============================================================
   RENDER GRIGLIA (con drag & drop per riordinare)
   ============================================================ */

function renderFramesGrid() {

    if (!framesGrid) {
        return;
    }

    framesGrid.innerHTML = "";

    composedFrames.forEach(function (frameData, index) {

        const card = document.createElement("div");

        card.className = "frame-card";
        card.dataset.index = index;
        card.draggable = true;

        if (selectedFrames.has(index)) {
            card.classList.add("selected");
        }

        const badge = document.createElement("div");
        badge.className = "frame-badge";
        badge.textContent = `#${index + 1}`;

        const canvas = document.createElement("canvas");
        canvas.width = gifWidth;
        canvas.height = gifHeight;
        canvas.getContext("2d").drawImage(frameData.canvas, 0, 0);

        const info = document.createElement("div");
        info.className = "frame-info";
        info.textContent = `${frameData.delay} ms`;

        card.appendChild(badge);
        card.appendChild(canvas);
        card.appendChild(info);


        card.addEventListener("click", function (event) {

            pushUndoSnapshot();

            if (event.shiftKey && lastSelectedFrameIndex !== null) {

                const start = Math.min(
                    lastSelectedFrameIndex,
                    index
                );

                const end = Math.max(
                    lastSelectedFrameIndex,
                    index
                );

                for (let i = start; i <= end; i++) {
                    selectedFrames.add(i);
                }
            }
            else {
                toggleFrameSelection(index);
            }

            lastSelectedFrameIndex = index;

            renderFramesGrid();
            updateFrameCount();
            updateCropPreview();
            updateSpeedPreview();
            updateAnimPreview();
        });


        card.addEventListener("dblclick", function (event) {

            event.stopPropagation();

            openFramePreview(frameData.canvas, index);
        });


        card.addEventListener("dragstart", function (event) {

            if (!selectedFrames.has(index)) {

                selectedFrames.clear();
                selectedFrames.add(index);

                renderFramesGrid();

                event.preventDefault();

                return;
            }

            dragSourceIndices =
                Array.from(selectedFrames).sort((a, b) => a - b);

            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(
                "text/plain",
                dragSourceIndices.join(",")
            );

            card.classList.add("dragging");
        });

        card.addEventListener("dragend", function () {

            card.classList.remove("dragging");

            clearDropIndicators();

            dragSourceIndices = [];
            dragTargetIndex = null;
        });

        card.addEventListener("dragover", function (event) {

            if (dragSourceIndices.length === 0) {
                return;
            }

            event.preventDefault();
            event.dataTransfer.dropEffect = "move";

            const rect = card.getBoundingClientRect();

            const isTopHalf =
                (event.clientY - rect.top) < rect.height / 2;

            clearDropIndicators();

            if (isTopHalf) {
                card.classList.add("drop-before");
                dragTargetIndex = index;
            }
            else {
                card.classList.add("drop-after");
                dragTargetIndex = index + 1;
            }
        });

        card.addEventListener("dragleave", function () {

            card.classList.remove("drop-before", "drop-after");
        });

        card.addEventListener("drop", function (event) {

            event.preventDefault();

            if (dragSourceIndices.length === 0) {
                return;
            }

            moveFrames(
                dragSourceIndices,
                dragTargetIndex !== null
                    ? dragTargetIndex
                    : index
            );

            clearDropIndicators();

            dragSourceIndices = [];
            dragTargetIndex = null;
        });

        framesGrid.appendChild(card);
    });

    updateFrameCount();
}

/* ============================================================
   ANTEPRIMA ANIMATA (tab 2 - frames)
   ============================================================ */

const previewAnimCanvas = $("preview-anim-canvas");
const previewAnimToggle = $("preview-anim-toggle");
const previewAnimFrameLabel = $("preview-anim-frame");
const previewAnimDelayLabel = $("preview-anim-delay");


const ANIM_PREVIEW_MAX_W = 320;
const ANIM_PREVIEW_MAX_H = 240;


function getActiveFrameIndices() {

    const list = [];

    for (let i = 0; i < composedFrames.length; i++) {

        if (!selectedFrames.has(i)) {
            list.push(i);
        }
    }

    return list;
}


function resizeAnimPreviewCanvas() {

    if (!previewAnimCanvas || !gifWidth || !gifHeight) {
        return;
    }

    const scale = Math.min(
        1,
        ANIM_PREVIEW_MAX_W / gifWidth,
        ANIM_PREVIEW_MAX_H / gifHeight
    );

    const displayWidth = Math.max(
        1,
        Math.round(gifWidth * scale)
    );

    const displayHeight = Math.max(
        1,
        Math.round(gifHeight * scale)
    );

    previewAnimCanvas.width = gifWidth;
    previewAnimCanvas.height = gifHeight;

    previewAnimCanvas.style.width = `${displayWidth}px`;
    previewAnimCanvas.style.height = `${displayHeight}px`;
}


function drawAnimPreviewFrame(frameIndex) {

    if (!previewAnimCanvas) {
        return;
    }

    const ctx = previewAnimCanvas.getContext("2d");

    ctx.clearRect(
        0,
        0,
        previewAnimCanvas.width,
        previewAnimCanvas.height
    );

    if (frameIndex < 0 || frameIndex >= composedFrames.length) {
        return;
    }

    const frame = composedFrames[frameIndex];

    if (!frame || !frame.canvas) {
        return;
    }

    ctx.drawImage(frame.canvas, 0, 0);


    const activeIndices = getActiveFrameIndices();

    const positionInActive =
        activeIndices.indexOf(frameIndex) + 1;

    if (previewAnimFrameLabel) {

        if (positionInActive > 0) {
            previewAnimFrameLabel.textContent =
                `${positionInActive} / ${activeIndices.length}`;
        }
        else {
            previewAnimFrameLabel.textContent =
                `excluded (${frameIndex + 1})`;
        }
    }

    if (previewAnimDelayLabel) {
        previewAnimDelayLabel.textContent =
            `${frame.delay} ms`;
    }
}


function stopAnimPreview() {

    if (animTimerId !== null) {

        clearTimeout(animTimerId);

        animTimerId = null;
    }

    animPlaying = false;

    if (previewAnimToggle) {
        previewAnimToggle.textContent = "▶ Play";
    }
}


function scheduleNextAnimFrame() {

    const activeIndices = getActiveFrameIndices();

    if (activeIndices.length === 0) {

        if (previewAnimCanvas) {

            const ctx = previewAnimCanvas.getContext("2d");

            ctx.clearRect(
                0,
                0,
                previewAnimCanvas.width,
                previewAnimCanvas.height
            );
        }

        if (previewAnimFrameLabel) {
            previewAnimFrameLabel.textContent = "-";
        }

        if (previewAnimDelayLabel) {
            previewAnimDelayLabel.textContent = "-";
        }

        stopAnimPreview();

        return;
    }

    let position = activeIndices.indexOf(animCurrentIndex);

    if (position === -1) {
        position = -1;
    }

    position = (position + 1) % activeIndices.length;

    const nextIndex = activeIndices[position];

    animCurrentIndex = nextIndex;

    drawAnimPreviewFrame(nextIndex);


    const frame = composedFrames[nextIndex];

    const delay = frame && frame.delay ? frame.delay : 100;

    animTimerId = setTimeout(
        scheduleNextAnimFrame,
        delay
    );
}


function startAnimPreview() {

    if (composedFrames.length === 0) {
        return;
    }

    const activeIndices = getActiveFrameIndices();

    if (activeIndices.length === 0) {
        return;
    }

    stopAnimPreview();

    animPlaying = true;

    if (previewAnimToggle) {
        previewAnimToggle.textContent = "■ Stop";
    }

    if (activeIndices.indexOf(animCurrentIndex) === -1) {
        animCurrentIndex = -1;
    }

    scheduleNextAnimFrame();
}


function updateAnimPreview() {

    resizeAnimPreviewCanvas();

    if (!animPlaying) {

        const activeIndices = getActiveFrameIndices();

        if (activeIndices.length === 0) {

            if (previewAnimCanvas) {

                const ctx =
                    previewAnimCanvas.getContext("2d");

                ctx.clearRect(
                    0,
                    0,
                    previewAnimCanvas.width,
                    previewAnimCanvas.height
                );
            }

            if (previewAnimFrameLabel) {
                previewAnimFrameLabel.textContent = "-";
            }

            if (previewAnimDelayLabel) {
                previewAnimDelayLabel.textContent = "-";
            }

            return;
        }

        const first = activeIndices[0];

        animCurrentIndex = first;

        drawAnimPreviewFrame(first);
    }
}


if (previewAnimToggle) {

    previewAnimToggle.addEventListener("click", function () {

        if (animPlaying) {
            stopAnimPreview();
        }
        else {
            startAnimPreview();
        }
    });
}


/* Doppio click sul canvas di anteprima del tab 2:
   apre la vista 1:1 animata in una nuova scheda.
   Mostra i frame ORIGINALI (senza crop/resize). */

if (previewAnimCanvas) {

    previewAnimCanvas.addEventListener("dblclick", function () {

        if (composedFrames.length === 0) {
            return;
        }

        const originalFramesData = composedFrames.map(
            function (f) { return { canvas: f.canvas, delay: f.delay }; }
        );

        openAnimatedPreview(
            originalFramesData,
            gifWidth,
            gifHeight
        );
    });
}


/* ============================================================
   ANTEPRIMA ANIMATA (tab 4 - crop)
   ============================================================ */

const cropAnimToggle = $("crop-anim-toggle");
const cropAnimFrameLabel = $("crop-anim-frame");
const cropAnimDelayLabel = $("crop-anim-delay");


function drawCropFrameForPlay(frameIndex) {

    if (!cropCanvas) {
        return;
    }

    if (frameIndex < 0 || frameIndex >= composedFrames.length) {
        return;
    }

    const frame = composedFrames[frameIndex];

    if (!frame || !frame.canvas) {
        return;
    }

    cropCanvas.width = gifWidth;
    cropCanvas.height = gifHeight;

    const ctx = cropCanvas.getContext("2d");

    ctx.clearRect(0, 0, gifWidth, gifHeight);

    ctx.drawImage(frame.canvas, 0, 0);

    resizeCropCanvasDisplay();

    updateCropSelectionDisplay();

    if (cropAnimFrameLabel) {
        cropAnimFrameLabel.textContent =
            `${frameIndex + 1} / ${composedFrames.length}`;
    }

    if (cropAnimDelayLabel) {
        cropAnimDelayLabel.textContent =
            `${frame.delay} ms`;
    }
}


function stopCropAnimPreview() {

    if (cropAnimTimerId !== null) {

        clearTimeout(cropAnimTimerId);

        cropAnimTimerId = null;
    }

    cropAnimPlaying = false;

    if (cropAnimToggle) {
        cropAnimToggle.textContent = "▶ Play";
    }

    if (cropSelection) {
        cropSelection.classList.remove("locked");
    }

    updateCropPreview();
}


function scheduleNextCropAnimFrame() {

    if (composedFrames.length === 0) {
        stopCropAnimPreview();
        return;
    }

    cropAnimCurrentIndex =
        (cropAnimCurrentIndex + 1) % composedFrames.length;

    drawCropFrameForPlay(cropAnimCurrentIndex);

    const frame = composedFrames[cropAnimCurrentIndex];

    const delay = frame && frame.delay ? frame.delay : 100;

    cropAnimTimerId = setTimeout(
        scheduleNextCropAnimFrame,
        delay
    );
}


function startCropAnimPreview() {

    if (composedFrames.length === 0) {
        return;
    }

    stopCropAnimPreview();

    cropAnimPlaying = true;

    cropAnimCurrentIndex = 0;

    if (cropAnimToggle) {
        cropAnimToggle.textContent = "■ Stop";
    }

    if (cropSelection) {
        cropSelection.classList.add("locked");
    }

    drawCropFrameForPlay(cropAnimCurrentIndex);

    const frame = composedFrames[cropAnimCurrentIndex];

    const delay = frame && frame.delay ? frame.delay : 100;

    cropAnimTimerId = setTimeout(
        scheduleNextCropAnimFrame,
        delay
    );
}


if (cropAnimToggle) {

    cropAnimToggle.addEventListener("click", function () {

        if (cropAnimPlaying) {
            stopCropAnimPreview();
        }
        else {
            startCropAnimPreview();
        }
    });
}


/* ============================================================
   RIORDINO FRAME (drag & drop)
   ============================================================ */

function moveFrames(sourceIndices, targetIndex) {

    if (!sourceIndices.length) {
        return;
    }

    pushUndoSnapshot();

    const sources = sourceIndices.slice().sort((a, b) => a - b);

    const moving = sources.map(i => composedFrames[i]);

    const sourcesBeforeTarget =
        sources.filter(i => i < targetIndex).length;

    for (let i = sources.length - 1; i >= 0; i--) {
        composedFrames.splice(sources[i], 1);
    }

    const insertAt = targetIndex - sourcesBeforeTarget;

    composedFrames.splice(insertAt, 0, ...moving);

    selectedFrames.clear();

    for (let i = 0; i < moving.length; i++) {
        selectedFrames.add(insertAt + i);
    }

    lastSelectedFrameIndex = insertAt;

    renderFramesGrid();
    updateFrameCount();
    updateCropPreview();
    updateSpeedPreview();
    updateAnimPreview();
}

function clearDropIndicators() {

    if (!framesGrid) {
        return;
    }

    framesGrid
        .querySelectorAll(".drop-before, .drop-after")
        .forEach(function (el) {
            el.classList.remove("drop-before", "drop-after");
        });
}


/* ============================================================
   SELEZIONE FRAME
   ============================================================ */

function toggleFrameSelection(index) {

    if (selectedFrames.has(index)) {
        selectedFrames.delete(index);
    }
    else {
        selectedFrames.add(index);
    }
}


/* ============================================================
   SELEZIONA TUTTI
   ============================================================ */

const selectAllButton = $("select-all");

if (selectAllButton) {

    selectAllButton.addEventListener("click", function () {

        pushUndoSnapshot();

        selectedFrames.clear();

        for (let i = 0; i < composedFrames.length; i++) {
            selectedFrames.add(i);
        }

        lastSelectedFrameIndex = null;

        renderFramesGrid();
        updateCropPreview();
        updateSpeedPreview();
        updateAnimPreview();
    });
}


/* ============================================================
   DESELEZIONA TUTTI
   ============================================================ */

const deselectAllButton = $("deselect-all");

if (deselectAllButton) {

    deselectAllButton.addEventListener("click", function () {

        pushUndoSnapshot();

        selectedFrames.clear();

        lastSelectedFrameIndex = null;

        renderFramesGrid();
        updateCropPreview();
        updateSpeedPreview();
        updateAnimPreview();
    });
}


/* ============================================================
   INVERTI SELEZIONE
   ============================================================ */

const invertSelectionButton = $("invert-selection");

if (invertSelectionButton) {

    invertSelectionButton.addEventListener("click", function () {

        pushUndoSnapshot();

        const inverted = new Set();

        for (let i = 0; i < composedFrames.length; i++) {

            if (!selectedFrames.has(i)) {
                inverted.add(i);
            }
        }

        selectedFrames = inverted;

        lastSelectedFrameIndex = null;

        renderFramesGrid();
        updateFrameCount();
        updateCropPreview();
        updateSpeedPreview();
        updateAnimPreview();
    });
}


/* ============================================================
   DECIMAZIONE: RIMUOVI 1 FRAME OGNI N
   ============================================================ */

const decimateButton = $("decimate-frames");
const decimateInput = $("decimate-n");

if (decimateButton) {

    decimateButton.addEventListener("click", function () {

        let n = decimateInput
            ? parseInt(decimateInput.value, 10)
            : 2;

        if (!Number.isFinite(n) || n < 2) {
            n = 2;
        }

        pushUndoSnapshot();

        const activeIndices = [];

        for (let i = 0; i < composedFrames.length; i++) {

            if (!selectedFrames.has(i)) {
                activeIndices.push(i);
            }
        }

        for (let i = 0; i < activeIndices.length; i++) {

            if ((i + 1) % n === 0) {
                selectedFrames.add(activeIndices[i]);
            }
        }

        lastSelectedFrameIndex = null;

        renderFramesGrid();
        updateFrameCount();
        updateCropPreview();
        updateSpeedPreview();
        updateAnimPreview();
    });
}


/* ============================================================
   RILEVAMENTO FRAME DUPLICATI / QUASI IDENTICI
   ============================================================ */

const DEDUPE_THUMB_W = 32;
const DEDUPE_THUMB_H = 24;

function getFrameThumbnailGray(frameCanvas) {

    const thumb = document.createElement("canvas");

    thumb.width = DEDUPE_THUMB_W;
    thumb.height = DEDUPE_THUMB_H;

    const ctx = thumb.getContext(
        "2d",
        { willReadFrequently: true }
    );

    ctx.drawImage(
        frameCanvas,
        0,
        0,
        DEDUPE_THUMB_W,
        DEDUPE_THUMB_H
    );

    const data = ctx.getImageData(
        0,
        0,
        DEDUPE_THUMB_W,
        DEDUPE_THUMB_H
    ).data;

    const gray = new Uint8ClampedArray(
        DEDUPE_THUMB_W * DEDUPE_THUMB_H
    );

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {

        gray[p] =
            data[i] * 0.299 +
            data[i + 1] * 0.587 +
            data[i + 2] * 0.114;
    }

    return gray;
}

function frameDiffPercentage(grayA, grayB) {

    let sum = 0;

    for (let i = 0; i < grayA.length; i++) {
        sum += Math.abs(grayA[i] - grayB[i]);
    }

    const maxSum = grayA.length * 255;

    return (sum / maxSum) * 100;
}

const detectDuplicatesButton = $("detect-duplicates");

if (detectDuplicatesButton) {

    detectDuplicatesButton.addEventListener("click", function () {

        if (composedFrames.length === 0) {
            return;
        }

        let threshold = duplicateThresholdInput
            ? parseFloat(duplicateThresholdInput.value)
            : 1.5;

        if (!Number.isFinite(threshold) || threshold < 0) {
            threshold = 1.5;
        }

        pushUndoSnapshot();

        let referenceGray = null;
        let markedCount = 0;

        for (let i = 0; i < composedFrames.length; i++) {

            if (selectedFrames.has(i)) {
                continue;
            }

            const gray = getFrameThumbnailGray(
                composedFrames[i].canvas
            );

            if (referenceGray) {

                const diff = frameDiffPercentage(
                    referenceGray,
                    gray
                );

                if (diff <= threshold) {

                    selectedFrames.add(i);
                    markedCount++;
                    continue;
                }
            }

            referenceGray = gray;
        }

        lastSelectedFrameIndex = null;

        renderFramesGrid();
        updateFrameCount();
        updateCropPreview();
        updateSpeedPreview();
        updateAnimPreview();

        alert(
            `Detected and selected ${markedCount} ` +
            `similar frames (threshold ${threshold}%).`
        );
    });
}


/* ============================================================
   RIMUOVI SELEZIONATI DALLA VISTA
   ============================================================ */

const removeSelectedButton = $("remove-selected");

if (removeSelectedButton) {

    removeSelectedButton.addEventListener("click", function () {

        if (selectedFrames.size === 0) {

            alert(
                "No frames selected to remove."
            );

            return;
        }

        pushUndoSnapshot();

        const kept = [];

        for (let i = 0; i < composedFrames.length; i++) {

            if (!selectedFrames.has(i)) {
                kept.push(composedFrames[i]);
            }
        }

        composedFrames = kept;

        selectedFrames.clear();

        lastSelectedFrameIndex = null;

        renderFramesGrid();
        updateFrameCount();
        updateCropPreview();
        updateSpeedPreview();
        updateAnimPreview();
    });
}


/* ============================================================
   FUNZIONE CONDIVISA: SVUOTA TUTTO
   ============================================================ */

function performClearAll() {

    stopAnimPreview();
    stopCropAnimPreview();

    originalFrames = [];
    composedFrames = [];

    originalFileName = "";
    originalFileSize = 0;

    selectedFrames.clear();

    undoStack = [];

    lastSelectedFrameIndex = null;

    gifWidth = 0;
    gifHeight = 0;

    cropRect = { x: 0, y: 0, width: 0, height: 0 };

    cropInteraction = null;
    cropPreviewOverrideIndex = null;

    resizeWidth = 0;
    resizeHeight = 0;
    resizeAspectRatio = 1;
    resizeLockAspect = true;

    speedMultiplier = 1;

    currentExportData = null;

    animCurrentIndex = -1;
    cropAnimCurrentIndex = -1;

    lastGifshotSizeBytes = 0;
    lastOptimizedSizeBytes = 0;
    lastOptimizationSucceeded = false;

    importFrames = [];
    importGifWidth = 0;
    importGifHeight = 0;
    importPreviewOverrideIndex = null;
    importDragState = null;

    const speedSliderReset = $("speed-slider");

    if (speedSliderReset) {
        speedSliderReset.value = "1";
    }

    const exportQualityReset = $("export-quality");

    if (exportQualityReset) {
        exportQualityReset.value = "10";
    }

    updateExportQualityLabel();

    const pingPongReset = $("pingpong-toggle");

    if (pingPongReset) {
        pingPongReset.checked = false;
    }

    const thumbReset = $("thumb-size-slider");

    if (thumbReset) {

        thumbReset.value = "80";

        document.documentElement.style.setProperty(
            "--thumb-size",
            "80px"
        );

        updateThumbSizeLabel();
    }

    const resizeWidthInputReset = $("resize-width");
    const resizeHeightInputReset = $("resize-height");
    const resizeLockInputReset = $("resize-lock");

    if (resizeWidthInputReset) resizeWidthInputReset.value = "0";
    if (resizeHeightInputReset) resizeHeightInputReset.value = "0";
    if (resizeLockInputReset) resizeLockInputReset.checked = true;

    updateResizeScaleFromFields();

    if (exportStatus) exportStatus.textContent = "";

    if (exportPreview) {

        exportPreview.src = "";

        exportPreview.style.display = "none";
    }

    hideExportComparison();

    if (frameCount) {
        frameCount.textContent = "0 frames";
    }

    if (gifDimensions) {
        gifDimensions.textContent = "-";
    }

    const oldDownloadButton = $("download-gif");

    if (oldDownloadButton) {
        oldDownloadButton.remove();
    }

    if (framesGrid) {
        framesGrid.innerHTML = "";
    }

    if (previewAnimCanvas) {

        previewAnimCanvas.width = 1;
        previewAnimCanvas.height = 1;
        previewAnimCanvas.style.width = "1px";
        previewAnimCanvas.style.height = "1px";
    }

    if (previewAnimFrameLabel) {
        previewAnimFrameLabel.textContent = "-";
    }

    if (previewAnimDelayLabel) {
        previewAnimDelayLabel.textContent = "-";
    }

    if (cropSelection) {
        cropSelection.style.display = "none";
        cropSelection.classList.remove("locked");
    }

    if (cropAnimFrameLabel) {
        cropAnimFrameLabel.textContent = "-";
    }

    if (cropAnimDelayLabel) {
        cropAnimDelayLabel.textContent = "-";
    }

    const resizePreviewCanvasReset = $("resize-preview-canvas");

    if (resizePreviewCanvasReset) {

        resizePreviewCanvasReset.width = 1;
        resizePreviewCanvasReset.height = 1;
        resizePreviewCanvasReset.style.width = "1px";
        resizePreviewCanvasReset.style.height = "1px";
    }

    const resizeCurrentSizeReset = $("resize-current-size");

    if (resizeCurrentSizeReset) {
        resizeCurrentSizeReset.textContent = "-";
    }

    if (fileInput) {
        fileInput.value = "";
    }

    hideErrorBox("load-error-box");
    hideErrorBox("import-error-box");
    hideErrorBox("export-error-box");

    updateFileButtonState();

    updateSpeedPreview();

    updateExportSourceLabel();

    updateTabStates();

    switchTab("load");
}


/* ============================================================
   SVUOTA TUTTO (tab 2)
   ============================================================ */

const clearAllButton = $("clear-all");

if (clearAllButton) {

    clearAllButton.addEventListener("click", function () {

        if (
            composedFrames.length === 0 &&
            importFrames.length === 0
        ) {
            return;
        }

        const ok = confirm(
            "Clear everything?\n\n" +
            "All frames, crop, speed, and previews will " +
            "be removed."
        );

        if (!ok) {
            return;
        }

        performClearAll();
    });
}


/* ============================================================
   SVUOTA TUTTO (tab 1)
   ============================================================ */

const clearAllTab1Button = $("clear-all-tab1");

if (clearAllTab1Button) {

    clearAllTab1Button.addEventListener("click", function () {

        if (composedFrames.length === 0) {
            return;
        }

        const ok = confirm(
            "Clear everything?\n\n" +
            "All frames, crop, speed, and previews will " +
            "be removed."
        );

        if (!ok) {
            return;
        }

        performClearAll();
    });
}


/* ============================================================
   CONTEGGIO FRAME
   ============================================================ */

function updateFrameCount() {

    if (frameCount) {

        const total = composedFrames.length;
        const removed = selectedFrames.size;
        const active = total - removed;

        frameCount.textContent =
            `${active} active frames (${removed} removed)`;
    }

    if (typeof updateTabCounters === "function") {
        updateTabCounters();
    }
}


/* ============================================================
   PRIMO FRAME ATTIVO
   ============================================================ */

function getFirstActiveFrameIndex() {

    for (let i = 0; i < composedFrames.length; i++) {

        if (!selectedFrames.has(i)) {
            return i;
        }
    }

    return -1;
}


/* ============================================================
   FRAME SCELTO MANUALMENTE PER L'ANTEPRIMA DI CROP
   ============================================================ */

function getCropPreviewFrameIndex() {

    if (
        cropPreviewOverrideIndex !== null &&
        cropPreviewOverrideIndex >= 0 &&
        cropPreviewOverrideIndex < composedFrames.length
    ) {
        return cropPreviewOverrideIndex;
    }

    return getFirstActiveFrameIndex();
}


/* ============================================================
   ANTEPRIMA CROP
   ============================================================ */

function updateCropPreview() {

    if (!cropCanvas) {
        return;
    }

    if (cropAnimPlaying) {
        return;
    }

    const index = getCropPreviewFrameIndex();

    if (index === -1) {

        if (cropSelection) {
            cropSelection.style.display = "none";
        }

        return;
    }

    const frame = composedFrames[index];

    cropCanvas.width = gifWidth;
    cropCanvas.height = gifHeight;

    const ctx = cropCanvas.getContext("2d");

    ctx.clearRect(0, 0, gifWidth, gifHeight);

    ctx.drawImage(frame.canvas, 0, 0);

    resizeCropCanvasDisplay();

    updateCropSelectionDisplay();
}


/* ============================================================
   DIMENSIONI DISPLAY CROP
   ============================================================ */

function resizeCropCanvasDisplay() {

    if (!cropCanvas || !gifWidth || !gifHeight) {
        return;
    }

    const maxWidth = 850;
    const maxHeight = 500;

    const scale = Math.min(
        1,
        maxWidth / gifWidth,
        maxHeight / gifHeight
    );

    const displayWidth = Math.round(gifWidth * scale);
    const displayHeight = Math.round(gifHeight * scale);

    cropCanvas.style.width = `${displayWidth}px`;
    cropCanvas.style.height = `${displayHeight}px`;

    if (cropContainer) {

        cropContainer.style.width = `${displayWidth}px`;
        cropContainer.style.height = `${displayHeight}px`;
    }
}


/* ============================================================
   RESET CROP
   ============================================================ */

function resetCrop() {

    cropRect = {
        x: 0,
        y: 0,
        width: gifWidth,
        height: gifHeight
    };

    updateCropSelectionDisplay();

    syncResizeTabFromCrop();
}

const resetCropButton = $("reset-crop");

if (resetCropButton) {

    resetCropButton.addEventListener("click", function () {
        resetCrop();
    });
}


/* ============================================================
   SCELTA MANUALE DEL FRAME DA MOSTRARE NEL CROP
   ============================================================ */

const cropPreviewFrameInput = $("crop-preview-frame");
const cropPreviewRefreshButton = $("crop-preview-refresh");

function applyCropPreviewFrameChoice() {

    if (!cropPreviewFrameInput) {
        return;
    }

    if (composedFrames.length === 0) {
        return;
    }

    let n = parseInt(cropPreviewFrameInput.value, 10);

    if (!Number.isFinite(n) || n < 1) {
        n = 1;
    }

    if (n > composedFrames.length) {
        n = composedFrames.length;
    }

    cropPreviewFrameInput.value = n;

    cropPreviewOverrideIndex = n - 1;

    updateCropPreview();
}

if (cropPreviewRefreshButton) {

    cropPreviewRefreshButton.addEventListener("click", function () {
        applyCropPreviewFrameChoice();
    });
}

if (cropPreviewFrameInput) {

    cropPreviewFrameInput.addEventListener(
        "keydown",
        function (event) {

            if (event.key === "Enter") {

                event.preventDefault();

                applyCropPreviewFrameChoice();
            }
        }
    );
}


/* ============================================================
   VISUALIZZAZIONE RETTANGOLO CROP
   ============================================================ */

function updateCropSelectionDisplay() {

    if (
        !cropSelection ||
        !cropCanvas ||
        !gifWidth ||
        !gifHeight
    ) {
        return;
    }

    const rect = cropCanvas.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
        return;
    }

    const scaleX = rect.width / gifWidth;
    const scaleY = rect.height / gifHeight;

    cropSelection.style.display = "block";

    cropSelection.style.left = `${cropRect.x * scaleX}px`;
    cropSelection.style.top = `${cropRect.y * scaleY}px`;
    cropSelection.style.width = `${cropRect.width * scaleX}px`;
    cropSelection.style.height = `${cropRect.height * scaleY}px`;

    if (cropX) cropX.textContent = Math.round(cropRect.x);
    if (cropY) cropY.textContent = Math.round(cropRect.y);
    if (cropWidth) cropWidth.textContent = Math.round(cropRect.width);
    if (cropHeight) cropHeight.textContent = Math.round(cropRect.height);

    if (typeof updateTabCounters === "function") {
        updateTabCounters();
    }
}


/* ============================================================
   RESIZE - LOGICA
   ============================================================ */

const resizeWidthInput = $("resize-width");
const resizeHeightInput = $("resize-height");
const resizeLockInput = $("resize-lock");
const resizeScaleSlider = $("resize-scale");
const resizeScaleValue = $("resize-scale-value");
const resizeWarning = $("resize-warning");
const resizeCurrentSizeLabel = $("resize-current-size");
const resizePreviewCanvas = $("resize-preview-canvas");

const RESIZE_SCALE_MIN = 10;
const RESIZE_SCALE_MAX = 200;


function syncResizeTabFromCrop() {

    if (!cropRect.width || !cropRect.height) {
        return;
    }

    resizeWidth = Math.round(cropRect.width);
    resizeHeight = Math.round(cropRect.height);

    resizeAspectRatio =
        resizeHeight > 0
            ? resizeWidth / resizeHeight
            : 1;

    if (resizeWidthInput) {
        resizeWidthInput.value = String(resizeWidth);
    }

    if (resizeHeightInput) {
        resizeHeightInput.value = String(resizeHeight);
    }

    if (resizeWidthInput) {
        resizeWidthInput.classList.remove("input-warning");
    }

    if (resizeHeightInput) {
        resizeHeightInput.classList.remove("input-warning");
    }

    if (resizeWarning) {
        resizeWarning.classList.remove("visible");
    }

    if (resizeCurrentSizeLabel) {

        resizeCurrentSizeLabel.textContent =
            `${Math.round(cropRect.width)} × ${Math.round(cropRect.height)} px`;
    }

    updateResizeScaleFromFields();

    renderResizePreview();

    if (typeof updateTabCounters === "function") {
        updateTabCounters();
    }
}


function updateResizeScaleFromFields() {

    if (!cropRect.width || !cropRect.height) {
        return;
    }

    const scalePct = Math.round(
        (resizeWidth / cropRect.width) * 100
    );

    if (resizeScaleSlider) {

        let clamped = scalePct;

        if (clamped < RESIZE_SCALE_MIN) {
            clamped = RESIZE_SCALE_MIN;
        }

        if (clamped > RESIZE_SCALE_MAX) {
            clamped = RESIZE_SCALE_MAX;
        }

        resizeScaleSlider.value = String(clamped);
    }

    if (resizeScaleValue) {
        resizeScaleValue.textContent = scalePct + "%";
    }
}


function applyScalePercent(percent) {

    if (!cropRect.width || !cropRect.height) {
        return;
    }

    const factor = percent / 100;

    let w = Math.round(cropRect.width * factor);
    let h = Math.round(cropRect.height * factor);

    const clampedW = clampResizeValue(w);
    const clampedH = clampResizeValue(h);

    const wasClamped =
        clampedW !== w || clampedH !== h;

    resizeWidth = clampedW;
    resizeHeight = clampedH;

    if (resizeWidthInput) {
        resizeWidthInput.value = String(resizeWidth);
    }

    if (resizeHeightInput) {
        resizeHeightInput.value = String(resizeHeight);
    }

    showResizeWarningIfNeeded(wasClamped);

    renderResizePreview();

    if (typeof updateTabCounters === "function") {
        updateTabCounters();
    }
}


function clampResizeValue(value) {

    let v = Math.round(value);

    if (!Number.isFinite(v) || v < 1) {
        v = 1;
    }

    if (v > RESIZE_MAX_SIDE) {
        v = RESIZE_MAX_SIDE;
    }

    return v;
}


function showResizeWarningIfNeeded(wasClamped) {

    if (!resizeWarning) {
        return;
    }

    if (wasClamped) {
        resizeWarning.classList.add("visible");

        if (resizeWidthInput && parseInt(resizeWidthInput.value, 10) >= RESIZE_MAX_SIDE) {
            resizeWidthInput.classList.add("input-warning");
        }
        else if (resizeWidthInput) {
            resizeWidthInput.classList.remove("input-warning");
        }

        if (resizeHeightInput && parseInt(resizeHeightInput.value, 10) >= RESIZE_MAX_SIDE) {
            resizeHeightInput.classList.add("input-warning");
        }
        else if (resizeHeightInput) {
            resizeHeightInput.classList.remove("input-warning");
        }
    }
}


function handleResizeWidthInput() {

    if (!resizeWidthInput) {
        return;
    }

    let raw = parseInt(resizeWidthInput.value, 10);

    if (!Number.isFinite(raw) || raw < 1) {
        raw = 1;
    }

    const wasClamped = raw > RESIZE_MAX_SIDE;

    resizeWidth = clampResizeValue(raw);

    resizeWidthInput.value = String(resizeWidth);

    if (resizeLockAspect && resizeAspectRatio > 0) {

        let h = Math.round(resizeWidth / resizeAspectRatio);

        const hClamped = h > RESIZE_MAX_SIDE || h < 1;

        resizeHeight = clampResizeValue(h);

        if (resizeHeightInput) {
            resizeHeightInput.value = String(resizeHeight);
        }

        showResizeWarningIfNeeded(wasClamped || hClamped);
    }
    else {
        showResizeWarningIfNeeded(wasClamped);
    }

    updateResizeScaleFromFields();

    renderResizePreview();

    if (typeof updateTabCounters === "function") {
        updateTabCounters();
    }
}


function handleResizeHeightInput() {

    if (!resizeHeightInput) {
        return;
    }

    let raw = parseInt(resizeHeightInput.value, 10);

    if (!Number.isFinite(raw) || raw < 1) {
        raw = 1;
    }

    const wasClamped = raw > RESIZE_MAX_SIDE;

    resizeHeight = clampResizeValue(raw);

    resizeHeightInput.value = String(resizeHeight);

    if (resizeLockAspect && resizeAspectRatio > 0) {

        let w = Math.round(resizeHeight * resizeAspectRatio);

        const wClamped = w > RESIZE_MAX_SIDE || w < 1;

        resizeWidth = clampResizeValue(w);

        if (resizeWidthInput) {
            resizeWidthInput.value = String(resizeWidth);
        }

        showResizeWarningIfNeeded(wasClamped || wClamped);
    }
    else {
        showResizeWarningIfNeeded(wasClamped);
    }

    updateResizeScaleFromFields();

    renderResizePreview();

    if (typeof updateTabCounters === "function") {
        updateTabCounters();
    }
}


function renderResizePreview() {

    if (!resizePreviewCanvas) {
        return;
    }

    const index = getCropPreviewFrameIndex();

    if (index === -1 || !cropRect.width || !cropRect.height) {
        return;
    }

    const frame = composedFrames[index];

    if (!frame || !frame.canvas) {
        return;
    }

    const croppedCanvas = createCroppedCanvas(frame.canvas);

    resizePreviewCanvas.width = resizeWidth;
    resizePreviewCanvas.height = resizeHeight;

    const ctx = resizePreviewCanvas.getContext("2d");

    ctx.clearRect(0, 0, resizeWidth, resizeHeight);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.drawImage(
        croppedCanvas,
        0,
        0,
        resizeWidth,
        resizeHeight
    );

    applyResizePreviewDisplaySize();
}


function applyResizePreviewDisplaySize() {

    if (!resizePreviewCanvas) {
        return;
    }

    if (!resizeWidth || !resizeHeight) {
        return;
    }

    const maxW = 850;
    const maxH = 500;

    const scale = Math.min(
        1,
        maxW / resizeWidth,
        maxH / resizeHeight
    );

    const dw = Math.max(1, Math.round(resizeWidth * scale));
    const dh = Math.max(1, Math.round(resizeHeight * scale));

    resizePreviewCanvas.style.width = `${dw}px`;
    resizePreviewCanvas.style.height = `${dh}px`;
}


/* ============================================================
   RESIZE - LISTENER UI
   ============================================================ */

if (resizeWidthInput) {

    resizeWidthInput.addEventListener(
        "change",
        handleResizeWidthInput
    );

    resizeWidthInput.addEventListener(
        "input",
        function () {

            if (resizePreviewTimer !== null) {
                clearTimeout(resizePreviewTimer);
            }

            resizePreviewTimer = setTimeout(
                function () {

                    resizePreviewTimer = null;

                    handleResizeWidthInput();
                },
                250
            );
        }
    );

    resizeWidthInput.addEventListener(
        "keydown",
        function (event) {

            if (event.key === "Enter") {

                event.preventDefault();

                resizeWidthInput.blur();
            }
        }
    );
}

if (resizeHeightInput) {

    resizeHeightInput.addEventListener(
        "change",
        handleResizeHeightInput
    );

    resizeHeightInput.addEventListener(
        "input",
        function () {

            if (resizePreviewTimer !== null) {
                clearTimeout(resizePreviewTimer);
            }

            resizePreviewTimer = setTimeout(
                function () {

                    resizePreviewTimer = null;

                    handleResizeHeightInput();
                },
                250
            );
        }
    );

    resizeHeightInput.addEventListener(
        "keydown",
        function (event) {

            if (event.key === "Enter") {

                event.preventDefault();

                resizeHeightInput.blur();
            }
        }
    );
}

if (resizeLockInput) {

    resizeLockInput.addEventListener("change", function () {

        resizeLockAspect = resizeLockInput.checked;

        if (resizeLockAspect && resizeAspectRatio > 0) {

            let h = Math.round(resizeWidth / resizeAspectRatio);

            resizeHeight = clampResizeValue(h);

            if (resizeHeightInput) {
                resizeHeightInput.value = String(resizeHeight);
            }

            updateResizeScaleFromFields();

            renderResizePreview();

            if (typeof updateTabCounters === "function") {
                updateTabCounters();
            }
        }
    });
}

if (resizeScaleSlider) {

    resizeScaleSlider.addEventListener("input", function () {

        const pct = parseFloat(resizeScaleSlider.value) || 100;

        applyScalePercent(pct);
    });
}

document.querySelectorAll(".preset-row button").forEach(function (btn) {

    btn.addEventListener("click", function () {

        const pct = parseFloat(btn.dataset.preset);

        if (!Number.isFinite(pct)) {
            return;
        }

        if (resizeScaleSlider) {

            let v = pct;

            if (v < RESIZE_SCALE_MIN) {
                v = RESIZE_SCALE_MIN;
            }

            if (v > RESIZE_SCALE_MAX) {
                v = RESIZE_SCALE_MAX;
            }

            resizeScaleSlider.value = String(v);
        }

        applyScalePercent(pct);
    });
});


/* ============================================================
   GIFSICLE - UI
   ============================================================ */

const optimizeToggle = $("optimize-toggle");
const optimizeFields = $("optimize-fields");
const optimizeLevelSelect = $("optimize-level");
const optimizeLossyInput = $("optimize-lossy");
const optimizeColorsSelect = $("optimize-colors");
const optimizeDitherInput = $("optimize-dither");


function updateOptimizeFieldsState() {

    if (!optimizeToggle || !optimizeFields) {
        return;
    }

    if (optimizeToggle.checked) {
        optimizeFields.classList.remove("disabled");
    }
    else {
        optimizeFields.classList.add("disabled");
    }
}

if (optimizeToggle) {

    optimizeToggle.addEventListener(
        "change",
        updateOptimizeFieldsState
    );

    updateOptimizeFieldsState();
}


function updateFieldsFromLevel() {

    if (!optimizeLevelSelect) {
        return;
    }

    const level = optimizeLevelSelect.value;
    const config = GIFSICLE_LEVELS[level];

    if (!config) {
        return;
    }

    /* Lossy */
    if (optimizeLossyInput) {

        if (level === "lossless") {

            optimizeLossyInput.disabled = true;
            optimizeLossyInput.value = "";
        }
        else if (level === "custom") {

            optimizeLossyInput.disabled = false;

            if (!optimizeLossyInput.value) {
                optimizeLossyInput.value = "40";
            }
        }
        else {

            optimizeLossyInput.disabled = false;

            if (config.lossy !== null && config.lossy !== undefined) {
                optimizeLossyInput.value = String(config.lossy);
            }
        }
    }

    /* Colors */
    if (optimizeColorsSelect) {

        if (level === "custom") {
            /* Custom: non tocco colors */
        }
        else if (config.defaultColors) {
            optimizeColorsSelect.value = String(config.defaultColors);
        }
    }

    /* Dither */
    if (optimizeDitherInput) {

        if (level === "custom") {
            /* Custom: non tocco dither */
        }
        else {
            optimizeDitherInput.checked = !!config.defaultDither;
        }
    }
}

if (optimizeLevelSelect) {

    optimizeLevelSelect.addEventListener(
        "change",
        updateFieldsFromLevel
    );

    updateFieldsFromLevel();
}


/* ============================================================
   CROP - POINTER DOWN
   ============================================================ */

if (cropSelection) {

    cropSelection.addEventListener(
        "pointerdown",
        function (event) {

            if (cropAnimPlaying) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const handle = event.target.dataset.handle;

            cropInteraction = {

                mode: handle || "move",

                startX: event.clientX,
                startY: event.clientY,

                original: {
                    x: cropRect.x,
                    y: cropRect.y,
                    width: cropRect.width,
                    height: cropRect.height
                }
            };

            try {
                cropSelection.setPointerCapture(event.pointerId);
            }
            catch (error) {
                /* ignoriamo */
            }
        }
    );


    cropSelection.addEventListener(
        "pointermove",
        function (event) {

            if (!cropInteraction) {
                return;
            }

            if (cropAnimPlaying) {
                return;
            }

            event.preventDefault();

            const rect = cropCanvas.getBoundingClientRect();

            if (rect.width <= 0 || rect.height <= 0) {
                return;
            }

            const scaleX = gifWidth / rect.width;
            const scaleY = gifHeight / rect.height;

            const dx =
                (event.clientX - cropInteraction.startX) * scaleX;

            const dy =
                (event.clientY - cropInteraction.startY) * scaleY;

            const original = cropInteraction.original;

            let x = original.x;
            let y = original.y;
            let width = original.width;
            let height = original.height;

            const minSize = 2;

            if (cropInteraction.mode === "move") {

                x = original.x + dx;
                y = original.y + dy;

                x = Math.max(
                    0,
                    Math.min(x, gifWidth - original.width)
                );

                y = Math.max(
                    0,
                    Math.min(y, gifHeight - original.height)
                );
            }
            else if (cropInteraction.mode === "nw") {

                x = original.x + dx;
                y = original.y + dy;

                width = original.width - dx;
                height = original.height - dy;

                if (width < minSize) {
                    width = minSize;
                    x = original.x + original.width - minSize;
                }

                if (height < minSize) {
                    height = minSize;
                    y = original.y + original.height - minSize;
                }

                x = Math.max(0, x);
                y = Math.max(0, y);
            }
            else if (cropInteraction.mode === "ne") {

                y = original.y + dy;
                width = original.width + dx;
                height = original.height - dy;

                if (width < minSize) {
                    width = minSize;
                }

                if (height < minSize) {
                    height = minSize;
                    y = original.y + original.height - minSize;
                }

                width = Math.min(width, gifWidth - original.x);
                y = Math.max(0, y);
            }
            else if (cropInteraction.mode === "sw") {

                x = original.x + dx;
                width = original.width - dx;
                height = original.height + dy;

                if (width < minSize) {
                    width = minSize;
                    x = original.x + original.width - minSize;
                }

                if (height < minSize) {
                    height = minSize;
                }

                x = Math.max(0, x);
                height = Math.min(height, gifHeight - original.y);
            }
            else if (cropInteraction.mode === "se") {

                width = original.width + dx;
                height = original.height + dy;

                width = Math.max(minSize, width);
                height = Math.max(minSize, height);

                width = Math.min(width, gifWidth - original.x);
                height = Math.min(height, gifHeight - original.y);
            }

            cropRect = {
                x: Math.round(x),
                y: Math.round(y),
                width: Math.round(width),
                height: Math.round(height)
            };

            updateCropSelectionDisplay();
        }
    );


    cropSelection.addEventListener(
        "pointerup",
        function (event) {

            cropInteraction = null;

            try {
                cropSelection.releasePointerCapture(event.pointerId);
            }
            catch (error) {
                /* ignoriamo */
            }

            if (cropAnimPlaying) {
                return;
            }

            syncResizeTabFromCrop();
        }
    );

    cropSelection.addEventListener(
        "pointercancel",
        function () {
            cropInteraction = null;
        }
    );
}


/* ============================================================
   RIDIMENSIONAMENTO FINESTRA
   ============================================================ */

window.addEventListener(
    "resize",
    function () {

        resizeCropCanvasDisplay();
        updateCropSelectionDisplay();
        resizeImportWindowDisplay();
        updateImportTransformDisplay();
        updateAnimPreview();
        applyResizePreviewDisplaySize();
    }
);


/* ============================================================
   AGGIUNTA DI UNA SECONDA GIF IN CODA
   ============================================================ */

let importFrames = [];

let importGifWidth = 0;
let importGifHeight = 0;

let importScale = 1;
let importPanX = 0;
let importPanY = 0;

let importBackgroundColor = "#ffffff";

let importPreviewOverrideIndex = null;

let importDragState = null;

const importWorkspace = $("import-workspace");
const importWindow = $("import-window");
const importDragCanvas = $("import-drag-canvas");

const importPreviewFrameInput = $("import-preview-frame");
const importPreviewRefreshButton = $("import-preview-refresh");

const importZoomSlider = $("import-zoom");
const importBgColorInput = $("import-bgcolor");

const importPresetCoverButton = $("import-preset-cover");
const importPresetContainButton = $("import-preset-contain");

const importConfirmButton = $("import-confirm");
const importCancelButton = $("import-cancel");

const importTargetDimsLabel = $("import-target-dims");


/* ----------------------------------------------------------
   CARICAMENTO DELLA SECONDA GIF
   ---------------------------------------------------------- */

async function loadImportGif(buffer) {

    const gifuct = getGifuct();

    if (!gifuct) {
        throw new Error("gifuct-js was not found.");
    }

    let gif = null;
    let frames = null;

    if (gifuct.type === "modern") {

        gif = gifuct.library.parseGIF(buffer);

        frames = gifuct.library.decompressFrames(gif, true);
    }
    else if (gifuct.type === "legacy") {

        const decoder = new gifuct.library(buffer);

        frames = decoder.decompressFrames(true);
    }

    if (!frames || !Array.isArray(frames) || frames.length === 0) {
        throw new Error(
            "No frames found in the GIF to append."
        );
    }

    let w = 0;
    let h = 0;

    if (gif && gif.lsd && gif.lsd.width && gif.lsd.height) {
        w = gif.lsd.width;
        h = gif.lsd.height;
    }
    else if (frames[0].dims) {
        w = frames[0].dims.width;
        h = frames[0].dims.height;
    }

    if (!w || !h) {
        throw new Error(
            "Could not determine the GIF dimensions " +
            "of the file to append."
        );
    }

    importFrames = composeAllFrames(frames, w, h);

    importGifWidth = w;
    importGifHeight = h;

    if (!importFrames.length) {
        throw new Error(
            "Could not rebuild the frames of the GIF to append."
        );
    }

    importPreviewOverrideIndex = null;

    if (importPreviewFrameInput) {

        importPreviewFrameInput.value = "1";
        importPreviewFrameInput.max = importFrames.length;
    }

    if (importTargetDimsLabel) {
        importTargetDimsLabel.textContent =
            `${gifWidth} × ${gifHeight} px`;
    }

    if (importBgColorInput) {
        importBackgroundColor =
            importBgColorInput.value || "#ffffff";
    }

    applyImportPreset("cover");

    renderImportPreviewFrame();

    updateTabStates();

    switchTab("import");
}


/* ----------------------------------------------------------
   SCELTA DEL FOTOGRAMMA DI ANTEPRIMA (GIF DA ACCODARE)
   ---------------------------------------------------------- */

function getImportPreviewFrameIndex() {

    if (
        importPreviewOverrideIndex !== null &&
        importPreviewOverrideIndex >= 0 &&
        importPreviewOverrideIndex < importFrames.length
    ) {
        return importPreviewOverrideIndex;
    }

    return 0;
}

function renderImportPreviewFrame() {

    if (!importDragCanvas || importFrames.length === 0) {
        return;
    }

    const index = getImportPreviewFrameIndex();

    const frame = importFrames[index];

    importDragCanvas.width = importGifWidth;
    importDragCanvas.height = importGifHeight;

    const ctx = importDragCanvas.getContext("2d");

    ctx.clearRect(0, 0, importGifWidth, importGifHeight);

    ctx.drawImage(frame.canvas, 0, 0);

    resizeImportWindowDisplay();

    updateImportTransformDisplay();
}

if (importPreviewRefreshButton) {

    importPreviewRefreshButton.addEventListener(
        "click",
        function () {
            applyImportPreviewFrameChoice();
        }
    );
}

if (importPreviewFrameInput) {

    importPreviewFrameInput.addEventListener(
        "keydown",
        function (event) {

            if (event.key === "Enter") {

                event.preventDefault();

                applyImportPreviewFrameChoice();
            }
        }
    );
}

function applyImportPreviewFrameChoice() {

    if (!importPreviewFrameInput || importFrames.length === 0) {
        return;
    }

    let n = parseInt(importPreviewFrameInput.value, 10);

    if (!Number.isFinite(n) || n < 1) {
        n = 1;
    }

    if (n > importFrames.length) {
        n = importFrames.length;
    }

    importPreviewFrameInput.value = n;

    importPreviewOverrideIndex = n - 1;

    renderImportPreviewFrame();
}


/* ----------------------------------------------------------
   DIMENSIONI DISPLAY DELLA FINESTRA DI IMPORT
   ---------------------------------------------------------- */

function resizeImportWindowDisplay() {

    if (!importWindow || !gifWidth || !gifHeight) {
        return;
    }

    const maxWidth = 850;
    const maxHeight = 500;

    const scale = Math.min(
        1,
        maxWidth / gifWidth,
        maxHeight / gifHeight
    );

    const displayWidth = Math.round(gifWidth * scale);
    const displayHeight = Math.round(gifHeight * scale);

    importWindow.style.width = `${displayWidth}px`;
    importWindow.style.height = `${displayHeight}px`;
}


/* ----------------------------------------------------------
   AGGIORNAMENTO POSIZIONE/ZOOM DEL FOTOGRAMMA DA ACCODARE
   ---------------------------------------------------------- */

function updateImportTransformDisplay() {

    if (
        !importDragCanvas ||
        !importWindow ||
        !gifWidth ||
        !gifHeight
    ) {
        return;
    }

    importWindow.style.background = importBackgroundColor;

    const rect = importWindow.getBoundingClientRect();

    if (rect.width <= 0) {
        return;
    }

    const displayScale = rect.width / gifWidth;

    const drawWidth =
        importGifWidth * importScale * displayScale;

    const drawHeight =
        importGifHeight * importScale * displayScale;

    importDragCanvas.style.width = `${drawWidth}px`;
    importDragCanvas.style.height = `${drawHeight}px`;
    importDragCanvas.style.left = `${importPanX * displayScale}px`;
    importDragCanvas.style.top = `${importPanY * displayScale}px`;
}


/* ----------------------------------------------------------
   PRESET: COVER / CONTAIN
   ---------------------------------------------------------- */

function applyImportPreset(kind) {

    if (
        !importGifWidth ||
        !importGifHeight ||
        !gifWidth ||
        !gifHeight
    ) {
        return;
    }

    let scale;

    if (kind === "contain") {

        scale = Math.min(
            gifWidth / importGifWidth,
            gifHeight / importGifHeight
        );
    }
    else {

        scale = Math.max(
            gifWidth / importGifWidth,
            gifHeight / importGifHeight
        );
    }

    importScale = scale;

    importPanX =
        (gifWidth - importGifWidth * scale) / 2;

    importPanY =
        (gifHeight - importGifHeight * scale) / 2;

    if (importZoomSlider) {

        const minZoom = parseFloat(importZoomSlider.min) || 0.05;
        const maxZoom = parseFloat(importZoomSlider.max) || 5;

        const clamped = Math.max(
            minZoom,
            Math.min(maxZoom, scale)
        );

        importZoomSlider.value = clamped.toFixed(2);
    }

    updateImportTransformDisplay();
}

if (importPresetCoverButton) {

    importPresetCoverButton.addEventListener(
        "click",
        function () {
            applyImportPreset("cover");
        }
    );
}

if (importPresetContainButton) {

    importPresetContainButton.addEventListener(
        "click",
        function () {
            applyImportPreset("contain");
        }
    );
}


/* ----------------------------------------------------------
   ZOOM MANUALE
   ---------------------------------------------------------- */

if (importZoomSlider) {

    importZoomSlider.addEventListener(
        "input",
        function () {

            const newScale =
                parseFloat(importZoomSlider.value) || 1;

            const centerX =
                importPanX +
                (importGifWidth * importScale) / 2;

            const centerY =
                importPanY +
                (importGifHeight * importScale) / 2;

            importScale = newScale;

            importPanX =
                centerX - (importGifWidth * importScale) / 2;

            importPanY =
                centerY - (importGifHeight * importScale) / 2;

            updateImportTransformDisplay();
        }
    );
}


/* ----------------------------------------------------------
   COLORE DI SFONDO
   ---------------------------------------------------------- */

if (importBgColorInput) {

    importBgColorInput.addEventListener(
        "input",
        function () {

            importBackgroundColor =
                importBgColorInput.value || "#ffffff";

            if (importWindow) {
                importWindow.style.background =
                    importBackgroundColor;
            }
        }
    );
}


/* ----------------------------------------------------------
   TRASCINAMENTO (PAN) DEL FOTOGRAMMA DA POSIZIONARE
   ---------------------------------------------------------- */

if (importDragCanvas) {

    importDragCanvas.addEventListener(
        "pointerdown",
        function (event) {

            event.preventDefault();

            importDragState = {
                startX: event.clientX,
                startY: event.clientY,
                originalPanX: importPanX,
                originalPanY: importPanY
            };

            try {
                importDragCanvas.setPointerCapture(event.pointerId);
            }
            catch (error) {
                /* ignoriamo */
            }
        }
    );

    importDragCanvas.addEventListener(
        "pointermove",
        function (event) {

            if (!importDragState) {
                return;
            }

            event.preventDefault();

            const rect = importWindow.getBoundingClientRect();

            if (rect.width <= 0) {
                return;
            }

            const displayScale = rect.width / gifWidth;

            const dx =
                (event.clientX - importDragState.startX) /
                displayScale;

            const dy =
                (event.clientY - importDragState.startY) /
                displayScale;

            importPanX = importDragState.originalPanX + dx;
            importPanY = importDragState.originalPanY + dy;

            updateImportTransformDisplay();
        }
    );

    importDragCanvas.addEventListener(
        "pointerup",
        function (event) {

            importDragState = null;

            try {
                importDragCanvas.releasePointerCapture(
                    event.pointerId
                );
            }
            catch (error) {
                /* ignoriamo */
            }
        }
    );

    importDragCanvas.addEventListener(
        "pointercancel",
        function () {
            importDragState = null;
        }
    );
}


/* ----------------------------------------------------------
   ANNULLA IMPORT
   ---------------------------------------------------------- */

function closeImportWorkspace() {

    importFrames = [];

    importGifWidth = 0;
    importGifHeight = 0;

    importPreviewOverrideIndex = null;

    importDragState = null;

    updateTabStates();
}

if (importCancelButton) {

    importCancelButton.addEventListener(
        "click",
        function () {
            closeImportWorkspace();
        }
    );
}


/* ----------------------------------------------------------
   CONFERMA: ACCODA I FOTOGRAMMI TRASFORMATI
   ---------------------------------------------------------- */

if (importConfirmButton) {

    importConfirmButton.addEventListener(
        "click",
        function () {
            confirmImportAppend();
        }
    );
}

function confirmImportAppend() {

    if (importFrames.length === 0) {

        alert("No GIF to append.");

        return;
    }

    pushUndoSnapshot();

    const drawWidth = importGifWidth * importScale;
    const drawHeight = importGifHeight * importScale;

    for (let i = 0; i < importFrames.length; i++) {

        const sourceFrame = importFrames[i];

        const outCanvas = document.createElement("canvas");

        outCanvas.width = gifWidth;
        outCanvas.height = gifHeight;

        const ctx = outCanvas.getContext("2d");

        ctx.fillStyle = importBackgroundColor || "#ffffff";

        ctx.fillRect(0, 0, gifWidth, gifHeight);

        ctx.drawImage(
            sourceFrame.canvas,
            0,
            0,
            importGifWidth,
            importGifHeight,
            importPanX,
            importPanY,
            drawWidth,
            drawHeight
        );

        composedFrames.push({
            canvas: outCanvas,
            delay: normalizeDelay(sourceFrame.delay),
            disposalType: 0
        });
    }

    closeImportWorkspace();

    renderFramesGrid();
    updateFrameCount();
    updateCropPreview();
    updateSpeedPreview();
    updateAnimPreview();
    updateFileButtonState();

    updateTabStates();

    switchTab("frames");
}


/* ============================================================
   CREA CANVAS CROPPATO
   ============================================================ */

function createCroppedCanvas(sourceCanvas) {

    const output = document.createElement("canvas");

    output.width = Math.max(
        1,
        Math.round(cropRect.width)
    );

    output.height = Math.max(
        1,
        Math.round(cropRect.height)
    );

    const ctx = output.getContext("2d");

    ctx.clearRect(0, 0, output.width, output.height);

    ctx.drawImage(
        sourceCanvas,
        cropRect.x,
        cropRect.y,
        cropRect.width,
        cropRect.height,
        0,
        0,
        output.width,
        output.height
    );

    return output;
}


/* ============================================================
   CREA CANVAS CROPPATO + RESIZE
   ============================================================ */

function createFinalCanvas(sourceCanvas) {

    const cropped = createCroppedCanvas(sourceCanvas);

    const w = Math.max(1, Math.round(resizeWidth));
    const h = Math.max(1, Math.round(resizeHeight));

    if (cropped.width === w && cropped.height === h) {
        return cropped;
    }

    const output = document.createElement("canvas");

    output.width = w;
    output.height = h;

    const ctx = output.getContext("2d");

    ctx.clearRect(0, 0, w, h);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.drawImage(
        cropped,
        0,
        0,
        w,
        h
    );

    return output;
}


/* ============================================================
   MASSIMO COMUN DIVISORE
   ============================================================ */

function gcd(a, b) {

    a = Math.abs(Math.round(a));
    b = Math.abs(Math.round(b));

    while (b !== 0) {

        const temp = a % b;

        a = b;
        b = temp;
    }

    return a || 1;
}


/* ============================================================
   DELAY BASE
   ============================================================ */

function calculateBaseDelay(frames) {

    if (!frames.length) {
        return 100;
    }

    let result = normalizeDelay(frames[0].delay);

    for (let i = 1; i < frames.length; i++) {

        result = gcd(
            result,
            normalizeDelay(frames[i].delay)
        );
    }

    return Math.max(10, result);
}


/* ============================================================
   VELOCITÀ DI RIPRODUZIONE
   ============================================================ */

function getActiveFrameDataForSpeed() {

    const list = [];

    for (let i = 0; i < composedFrames.length; i++) {

        if (!selectedFrames.has(i)) {
            list.push(composedFrames[i]);
        }
    }

    return list;
}

function updateSpeedPreview() {

    const speedValueLabel = $("speed-value");
    const speedDelayPreview = $("speed-delay-preview");

    if (speedValueLabel) {
        speedValueLabel.textContent =
            speedMultiplier.toFixed(1) + "x";
    }

    if (speedDelayPreview) {

        const activeData = getActiveFrameDataForSpeed();

        if (activeData.length === 0) {

            speedDelayPreview.textContent = "";

            return;
        }

        const base = calculateBaseDelay(activeData);

        const effective = Math.max(
            10,
            Math.round(base / speedMultiplier)
        );

        speedDelayPreview.textContent =
            `(${effective} ms/frame)`;
    }
}

const speedSlider = $("speed-slider");

if (speedSlider) {

    speedSlider.addEventListener(
        "input",
        function () {

            speedMultiplier =
                parseFloat(speedSlider.value) || 1;

            updateSpeedPreview();
        }
    );
}


/* ============================================================
   SLIDER QUALITÀ EXPORT
   ============================================================ */

const exportQualityInput = $("export-quality");
const exportQualityLabel = $("export-quality-value");

function updateExportQualityLabel() {

    if (!exportQualityInput || !exportQualityLabel) {
        return;
    }

    exportQualityLabel.textContent =
        exportQualityInput.value;
}

if (exportQualityInput) {

    exportQualityInput.addEventListener(
        "input",
        updateExportQualityLabel
    );

    updateExportQualityLabel();
}


/* ============================================================
   DIMENSIONE DI UNA DATA URL IN BYTE
   ============================================================ */

function getDataUrlSizeBytes(dataUrl) {

    const commaIndex = dataUrl.indexOf(",");

    if (commaIndex === -1) {
        return 0;
    }

    const base64 = dataUrl.slice(commaIndex + 1);

    let padding = 0;

    if (base64.endsWith("==")) {
        padding = 2;
    }
    else if (base64.endsWith("=")) {
        padding = 1;
    }

    return Math.floor((base64.length * 3) / 4) - padding;
}


/* ============================================================
   DATA URL -> BLOB
   ============================================================ */

function dataUrlToBlob(dataUrl) {

    const parts = dataUrl.split(",");

    const mime = parts[0]
        .match(/:(.*?);/)[1];

    const binary = atob(parts[1]);

    const len = binary.length;

    const bytes = new Uint8Array(len);

    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return new Blob([bytes], { type: mime });
}


/* ============================================================
   BLOB -> BYTE SIZE
   ============================================================ */

function getBlobSizeBytes(blob) {

    if (!blob) {
        return 0;
    }

    if (typeof blob.size === "number") {
        return blob.size;
    }

    return 0;
}


/* ============================================================
   GIFSICLE - OTTIMIZZAZIONE
   ============================================================ */

async function optimizeWithGifsicle(inputBlob, options) {

    const gifsicle = getGifsicle();

    if (!gifsicle) {
        throw new Error(
            "gifsicle-wasm-browser was not loaded. Make sure " +
            "gifsicle.min.js is in the extension folder."
        );
    }

    const cmdParts = [];

    if (options.optimize) {
        cmdParts.push(options.optimize);
    }

    if (
        options.colors !== null &&
        options.colors !== undefined &&
        Number.isFinite(parseInt(options.colors, 10))
    ) {
        cmdParts.push("--colors " + parseInt(options.colors, 10));
    }

    if (options.dither) {
        cmdParts.push("--dither");
    }

    if (options.lossy !== null && options.lossy !== undefined) {

        const lossyValue = parseInt(options.lossy, 10);

        if (Number.isFinite(lossyValue) && lossyValue > 0) {
            cmdParts.push("--lossy=" + lossyValue);
        }
    }

    const command =
        cmdParts.join(" ") +
        " input.gif -o /out/output.gif";


    console.log("Gifsicle command:", command);


    const result = await gifsicle.run({
        input: [{
            file: inputBlob,
            name: "input.gif"
        }],
        command: [command]
    });


    if (!result || !result.length) {
        throw new Error(
            "Gifsicle did not return an output file."
        );
    }

    const output = result[0];

    if (!output || typeof output.size !== "number" || output.size === 0) {
        throw new Error(
            "Gifsicle returned an empty file."
        );
    }

    return output;
}


/* ============================================================
   CONFRONTO ORIGINALE vs EDITATO vs OTTIMIZZATO
   ============================================================ */

function hideExportComparison() {

    const el = $("export-comparison");

    if (el) {
        el.classList.remove("visible");
    }
}


function computeFrameStats(frameList) {

    if (!frameList.length) {
        return { duration: 0, avgDelay: 0 };
    }

    let total = 0;

    for (let i = 0; i < frameList.length; i++) {
        total += normalizeDelay(frameList[i].delay);
    }

    return {
        duration: total,
        avgDelay: total / frameList.length
    };
}


function showExportComparison(
    editedFrameCount,
    editedWidth,
    editedHeight,
    gifshotSizeBytes,
    optimizedSizeBytes,
    optimizationApplied,
    editedFrameData
) {

    const comparison = $("export-comparison");

    if (!comparison) {
        return;
    }

    const origFrames = originalFrames.length;

    const origStats = (function () {

        let total = 0;

        for (let i = 0; i < originalFrames.length; i++) {
            total += normalizeDelay(originalFrames[i].delay);
        }

        return {
            duration: total,
            avgDelay:
                originalFrames.length > 0
                    ? total / originalFrames.length
                    : 0
        };
    })();

    const editStats = computeFrameStats(editedFrameData);

    const setText = function (id, value) {

        const el = $(id);

        if (el) {
            el.textContent = value;
        }
    };

    setText("cmp-frames-orig", String(origFrames));
    setText("cmp-frames-new", String(editedFrameCount));
    setText(
        "cmp-frames-opt",
        optimizationApplied
            ? String(editedFrameCount)
            : "—"
    );

    setText(
        "cmp-dims-orig",
        `${gifWidth} × ${gifHeight}`
    );
    setText(
        "cmp-dims-new",
        `${Math.round(cropRect.width)} × ${Math.round(cropRect.height)}`
    );
    setText(
        "cmp-dims-opt",
        optimizationApplied
            ? `${editedWidth} × ${editedHeight}`
            : "—"
    );

    setText(
        "cmp-outsize-new",
        `${editedWidth} × ${editedHeight}`
    );
    setText(
        "cmp-outsize-opt",
        optimizationApplied
            ? `${editedWidth} × ${editedHeight}`
            : "—"
    );

    const scalePct = cropRect.width > 0
        ? Math.round((editedWidth / cropRect.width) * 100)
        : 100;

    setText("cmp-scale-new", scalePct + "%");
    setText(
        "cmp-scale-opt",
        optimizationApplied
            ? scalePct + "%"
            : "—"
    );

    setText(
        "cmp-size-orig",
        formatBytes(originalFileSize)
    );
    setText(
        "cmp-size-new",
        formatBytes(gifshotSizeBytes)
    );
    setText(
        "cmp-size-opt",
        optimizationApplied
            ? formatBytes(optimizedSizeBytes)
            : "—"
    );

    setText(
        "cmp-duration-orig",
        formatDuration(origStats.duration)
    );
    setText(
        "cmp-duration-new",
        formatDuration(editStats.duration)
    );
    setText(
        "cmp-duration-opt",
        optimizationApplied
            ? formatDuration(editStats.duration)
            : "—"
    );

    setText(
        "cmp-delay-orig",
        Math.round(origStats.avgDelay) + " ms"
    );
    setText(
        "cmp-delay-new",
        Math.round(editStats.avgDelay) + " ms"
    );
    setText(
        "cmp-delay-opt",
        optimizationApplied
            ? Math.round(editStats.avgDelay) + " ms"
            : "—"
    );

    const diffContainer = $("export-comparison-diff");

    if (diffContainer) {

        diffContainer.innerHTML = "";

        const lines = [];

        if (originalFileSize > 0) {

            const finalSize = optimizationApplied
                ? optimizedSizeBytes
                : gifshotSizeBytes;

            const numPct =
                ((finalSize - originalFileSize) /
                 originalFileSize) * 100;

            const cls = numPct < -0.5
                ? "diff-positive"
                : (numPct > 0.5 ? "diff-negative" : "diff-neutral");

            const arrow = numPct < -0.5
                ? "📉"
                : (numPct > 0.5 ? "📈" : "➡");

            const word = numPct < -0.5
                ? "reduced by"
                : (numPct > 0.5 ? "increased by" : "unchanged");

            lines.push(
                `<span class="diff-line ${cls}">` +
                `${arrow} Final file size ${word} ` +
                `${Math.abs(numPct).toFixed(0)}% ` +
                `(${formatBytes(originalFileSize)} → ${formatBytes(finalSize)})` +
                `</span>`
            );
        }

        if (
            optimizationApplied &&
            gifshotSizeBytes > 0 &&
            optimizedSizeBytes > 0
        ) {

            const gifPct =
                ((optimizedSizeBytes - gifshotSizeBytes) /
                 gifshotSizeBytes) * 100;

            if (gifPct < -0.5) {

                lines.push(
                    `<span class="diff-line diff-positive">` +
                    `⚙️ Gifsicle saved a further ` +
                    `${Math.abs(gifPct).toFixed(0)}% ` +
                    `(${formatBytes(gifshotSizeBytes)} → ${formatBytes(optimizedSizeBytes)})` +
                    `</span>`
                );
            }
            else if (gifPct > 0.5) {

                lines.push(
                    `<span class="diff-line diff-negative">` +
                    `⚠️ Gifsicle increased size by ` +
                    `${gifPct.toFixed(0)}% ` +
                    `(${formatBytes(gifshotSizeBytes)} → ${formatBytes(optimizedSizeBytes)})` +
                    `</span>`
                );
            }
        }

        const origPixels = gifWidth * gifHeight;
        const cropPixels = cropRect.width * cropRect.height;

        if (origPixels > 0 && cropPixels !== origPixels) {

            const numPct =
                ((cropPixels - origPixels) / origPixels) * 100;

            const cls = numPct < -0.5
                ? "diff-positive"
                : (numPct > 0.5 ? "diff-negative" : "diff-neutral");

            const arrow = numPct < -0.5
                ? "📉"
                : (numPct > 0.5 ? "📈" : "➡");

            const word = numPct < -0.5
                ? "reduced by"
                : (numPct > 0.5 ? "increased by" : "unchanged");

            lines.push(
                `<span class="diff-line ${cls}">` +
                `${arrow} Dimensions ${word} ` +
                `${Math.abs(numPct).toFixed(0)}% ` +
                `(${gifWidth}×${gifHeight} → ${Math.round(cropRect.width)}×${Math.round(cropRect.height)})` +
                `</span>`
            );
        }

        if (origFrames > 0 && editedFrameCount !== origFrames) {

            const numPct =
                ((editedFrameCount - origFrames) / origFrames) * 100;

            const cls = numPct < -0.5
                ? "diff-positive"
                : (numPct > 0.5 ? "diff-negative" : "diff-neutral");

            const arrow = numPct < -0.5
                ? "📉"
                : (numPct > 0.5 ? "📈" : "➡");

            const word = numPct < -0.5
                ? "reduced by"
                : (numPct > 0.5 ? "increased by" : "unchanged");

            lines.push(
                `<span class="diff-line ${cls}">` +
                `${arrow} Frames ${word} ` +
                `${Math.abs(numPct).toFixed(0)}% ` +
                `(${origFrames} → ${editedFrameCount})` +
                `</span>`
            );
        }

        if (lines.length === 0) {
            lines.push(
                `<span class="diff-line diff-neutral">➡ No significant changes</span>`
            );
        }

        diffContainer.innerHTML = lines.join("");
    }

    comparison.classList.add("visible");
}


/* ============================================================
   PREPARAZIONE FRAME PER ESPORTAZIONE
   ============================================================ */

async function prepareExportImages(activeIndices) {

    const images = [];
    const activeFrameData = [];

    for (const index of activeIndices) {

        const frame = composedFrames[index];

        const finalCanvas = createFinalCanvas(frame.canvas);

        const dataUrl = finalCanvas.toDataURL("image/png");

        images.push(dataUrl);

        activeFrameData.push(frame);
    }

    return { images, activeFrameData };
}


/* ============================================================
   PULSANTE ESPORTAZIONE
   ============================================================ */

const exportButton = $("export-gif");

if (exportButton) {

    exportButton.addEventListener(
        "click",
        async function () {
            await exportGif();
        }
    );
}


/* ============================================================
   ESPORTAZIONE GIF
   ============================================================ */

async function exportGif() {

    hideErrorBox("export-error-box");

    hideExportComparison();

    const gifshot = getGifshot();

    if (!gifshot) {

        showErrorBox(
            "export-error-box",
            "export-error-message",
            "export-error-technical",
            "gifshot was not loaded. Make sure gifshot.min.js " +
            "is in the extension folder.",
            null
        );

        return;
    }

    const activeIndices = [];

    for (let i = 0; i < composedFrames.length; i++) {

        if (!selectedFrames.has(i)) {
            activeIndices.push(i);
        }
    }

    if (activeIndices.length === 0) {

        showErrorBox(
            "export-error-box",
            "export-error-message",
            "export-error-technical",
            "There are no active frames to export.",
            null
        );

        return;
    }

    if (!cropRect.width || !cropRect.height) {

        showErrorBox(
            "export-error-box",
            "export-error-message",
            "export-error-technical",
            "The crop rectangle is not valid.",
            null
        );

        return;
    }

    if (!resizeWidth || !resizeHeight) {

        showErrorBox(
            "export-error-box",
            "export-error-message",
            "export-error-technical",
            "The output size is not valid.",
            null
        );

        return;
    }

    const pingPongToggle = $("pingpong-toggle");

    const usePingPong = pingPongToggle
        ? pingPongToggle.checked
        : false;

    let exportIndices = activeIndices;

    if (usePingPong && activeIndices.length > 2) {

        const reversedMiddle =
            activeIndices.slice(1, -1).reverse();

        exportIndices =
            activeIndices.concat(reversedMiddle);
    }

    if (exportButton) {

        exportButton.disabled = true;
        exportButton.textContent = "Creating GIF...";
    }

    if (exportStatus) {
        exportStatus.textContent =
            "Preparing frames...";
    }

    if (exportPreview) {
        exportPreview.style.display = "none";
    }

    try {

        const prepared = await prepareExportImages(
            exportIndices
        );

        let images = prepared.images;

        const activeFrameData = prepared.activeFrameData;

        const outputWidth = Math.max(
            1,
            Math.round(resizeWidth)
        );

        const outputHeight = Math.max(
            1,
            Math.round(resizeHeight)
        );

        const baseDelay =
            calculateBaseDelay(activeFrameData);

        const effectiveDelay = Math.max(
            10,
            Math.round(baseDelay / speedMultiplier)
        );

        let sampleInterval = exportQualityInput
            ? parseInt(exportQualityInput.value, 10)
            : 10;

        if (
            !Number.isFinite(sampleInterval) ||
            sampleInterval < 1
        ) {
            sampleInterval = 10;
        }

        if (exportStatus) {

            exportStatus.textContent =
                `Encoding ${images.length} images...`;
        }

        const options = {

            images: images,

            gifWidth: outputWidth,
            gifHeight: outputHeight,

            interval: effectiveDelay / 1000,

            numFrames: images.length,

            sampleInterval: sampleInterval,

            numWorkers: 2,

            progressCallback: function (progress) {

                const percentage = Math.round(progress * 100);

                if (exportStatus) {

                    exportStatus.textContent =
                        `Encoding GIF: ${percentage}%`;
                }
            }
        };

        await new Promise(
            function (resolve, reject) {

                try {

                    gifshot.createGIF(
                        options,
                        function (result) {

                            if (result.error) {

                                reject(
                                    new Error(
                                        result.errorMsg ||
                                        "Error returned by gifshot."
                                    )
                                );

                                return;
                            }

                            if (!result.image) {

                                reject(
                                    new Error(
                                        "gifshot did not produce a GIF."
                                    )
                                );

                                return;
                            }

                            resolve(result.image);
                        }
                    );
                }
                catch (innerError) {

                    reject(innerError);
                }
            }
        ).then(async function (gifshotDataUrl) {

            const gifshotSizeBytes =
                getDataUrlSizeBytes(gifshotDataUrl);

            lastGifshotSizeBytes = gifshotSizeBytes;

            console.log(
                "Gifshot output size:",
                formatBytes(gifshotSizeBytes)
            );


            let finalDataUrl = gifshotDataUrl;
            let finalSizeBytes = gifshotSizeBytes;
            let optimizationApplied = false;

            const optimizeCheckbox = $("optimize-toggle");

            const shouldOptimize =
                optimizeCheckbox && optimizeCheckbox.checked;

            if (shouldOptimize) {

                const gifsicle = getGifsicle();

                if (!gifsicle) {

                    console.warn(
                        "Gifsicle not available — skipping optimization."
                    );

                    if (exportStatus) {
                        exportStatus.textContent =
                            "GIF created (Gifsicle not available).";
                    }
                }
                else {

                    if (exportStatus) {
                        exportStatus.textContent =
                            "Optimizing with Gifsicle...";
                    }

                    try {

                        const level =
                            optimizeLevelSelect
                                ? optimizeLevelSelect.value
                                : "balanced";

                        const config =
                            GIFSICLE_LEVELS[level] ||
                            GIFSICLE_LEVELS.balanced;

                        let lossyValue = null;

                        if (optimizeLossyInput) {
                            const lossyVal =
                                parseInt(optimizeLossyInput.value, 10);

                            if (Number.isFinite(lossyVal) && lossyVal > 0) {
                                lossyValue = lossyVal;
                            }
                        }

                        let colorsValue = 256;

                        if (optimizeColorsSelect) {
                            const c = parseInt(
                                optimizeColorsSelect.value,
                                10
                            );

                            if (Number.isFinite(c) && c > 0) {
                                colorsValue = c;
                            }
                        }

                        let ditherEnabled = false;

                        if (optimizeDitherInput) {
                            ditherEnabled =
                                optimizeDitherInput.checked === true;
                        }

                        const finalConfig = {
                            optimize: config.optimize,
                            lossy: lossyValue,
                            colors: colorsValue,
                            dither: ditherEnabled
                        };

                        console.log(
                            "Gifsicle config:",
                            JSON.stringify(finalConfig)
                        );

                        const inputBlob =
                            dataUrlToBlob(gifshotDataUrl);

                        const optimizedBlob =
                            await optimizeWithGifsicle(
                                inputBlob,
                                finalConfig
                            );

                        finalDataUrl = await new Promise(
                            function (resolve, reject) {

                                const reader =
                                    new FileReader();

                                reader.onload = function () {
                                    resolve(reader.result);
                                };

                                reader.onerror = function () {
                                    reject(
                                        new Error(
                                            "Could not read the optimized blob."
                                        )
                                    );
                                };

                                reader.readAsDataURL(optimizedBlob);
                            }
                        );

                        finalSizeBytes = getBlobSizeBytes(optimizedBlob);

                        optimizationApplied = true;

                        lastOptimizedSizeBytes = finalSizeBytes;
                        lastOptimizationSucceeded = true;

                        console.log(
                            "Gifsicle output size:",
                            formatBytes(finalSizeBytes),
                            "(" +
                            Math.round(
                                ((finalSizeBytes - gifshotSizeBytes) /
                                 gifshotSizeBytes) * 100
                            ) + "% vs gifshot)"
                        );

                        if (exportStatus) {
                            exportStatus.textContent =
                                "GIF created and optimized.";
                        }
                    }
                    catch (optError) {

                        console.error(
                            "Gifsicle optimization failed:",
                            optError
                        );

                        optimizationApplied = false;

                        lastOptimizedSizeBytes = 0;
                        lastOptimizationSucceeded = false;

                        if (exportStatus) {
                            exportStatus.textContent =
                                "GIF created (optimization failed).";
                        }
                    }
                }
            }
            else {

                if (exportStatus) {
                    exportStatus.textContent =
                        "GIF created successfully.";
                }
            }


            currentExportData = finalDataUrl;

            if (exportPreview) {

                exportPreview.src = finalDataUrl;

                exportPreview.style.display = "block";
            }

            showExportComparison(
                images.length,
                outputWidth,
                outputHeight,
                gifshotSizeBytes,
                finalSizeBytes,
                optimizationApplied,
                activeFrameData
            );

            createDownloadButton(finalDataUrl);
        });
    }
    catch (error) {

        console.error("GIF export error:", error);

        if (exportStatus) {

            exportStatus.textContent = "";
        }

        showErrorBox(
            "export-error-box",
            "export-error-message",
            "export-error-technical",
            "Could not create the GIF. This often happens " +
            "with very large GIFs or when memory is low.",
            error
        );
    }
    finally {

        if (exportButton) {

            exportButton.disabled = false;

            exportButton.textContent = "Create new GIF";
        }
    }
}


/* ============================================================
   PULSANTE DOWNLOAD
   ============================================================ */

function createDownloadButton(dataUrl) {

    const exportArea = document.querySelector(".export-area");

    if (!exportArea) {

        console.warn(".export-area not found.");

        return;
    }

    const oldButton = $("download-gif");

    if (oldButton) {
        oldButton.remove();
    }

    const button = document.createElement("button");

    button.id = "download-gif";
    button.className = "primary";
    button.type = "button";
    button.textContent = "⬇ Download GIF";

    button.addEventListener(
        "click",
        function () {

            saveGifFile(dataUrl);
        }
    );

    exportArea.appendChild(button);
}


/* ============================================================
   SALVATAGGIO FILE
   ============================================================ */

async function saveGifFile(dataUrl) {

    const fileName = getExportFileName();

    if (
        typeof window.showSaveFilePicker === "function"
    ) {

        try {

            const blob = dataUrlToBlob(dataUrl);

            const handle = await window.showSaveFilePicker({
                suggestedName: fileName,
                types: [{
                    description: "GIF image",
                    accept: {
                        "image/gif": [".gif"]
                    }
                }]
            });

            const writable = await handle.createWritable();

            await writable.write(blob);

            await writable.close();

            return;
        }
        catch (error) {

            if (error && error.name === "AbortError") {
                return;
            }

            console.warn(
                "showSaveFilePicker failed, falling back:",
                error
            );
        }
    }

    downloadDataUrl(dataUrl, fileName);
}


/* ============================================================
   DOWNLOAD (fallback)
   ============================================================ */

function downloadDataUrl(dataUrl, filename) {

    const link = document.createElement("a");

    link.href = dataUrl;

    link.download = filename;

    document.body.appendChild(link);

    link.click();

    link.remove();
}


/* ============================================================
   INIZIALIZZAZIONE
   ============================================================ */

updateTabStates();

resizeAnimPreviewCanvas();

updateExportSourceLabel();

updateFileButtonState();


/* ============================================================
   LOG DI DEBUG
   ============================================================ */

console.log("========================================");

console.log("GIF Frame Master");

console.log("app.js loaded successfully");

console.log(
    "gifuct-js:",
    getGifuct() ? "OK" : "NOT FOUND"
);

console.log(
    "gifshot:",
    getGifshot() ? "OK" : "NOT FOUND"
);

console.log(
    "gifsicle:",
    getGifsicle() ? "OK" : "NOT FOUND"
);

console.log(
    "showSaveFilePicker:",
    typeof window.showSaveFilePicker === "function"
        ? "available"
        : "not available (using fallback)"
);

console.log("========================================");


/* ============================================================
   FINE APP.JS
   ============================================================ */

