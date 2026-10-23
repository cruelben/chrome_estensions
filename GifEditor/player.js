/* ============================================================
   GIF FRAME MASTER - Player 1:1 (external script)
   ============================================================
   Questo script gira nella scheda del player. Riceve i dati
   dei frame via postMessage dalla scheda principale, poi
   gestisce:
     - disegno del canvas
     - badge #N in alto a destra
     - pulsante Play/Stop
     - slider per saltare a un frame specifico
     - bottoni velocità (0.25x / 0.5x / 1x)
   ============================================================ */

(function () {

    /* --------------------------------------------------------
       STATO
       -------------------------------------------------------- */

    let framesData = [];       /* [{ url, delay }, ...] */
    let gifW = 0;
    let gifH = 0;
    let total = 0;

    let speedMultiplier = 0.5;  /* default: 0.5x (rallentato) */

    let imgs = [];
    let loadedCount = 0;
    let currentIndex = 0;
    let timerId = null;
    let playing = false;

    /* --------------------------------------------------------
       RIFERIMENTI DOM
       -------------------------------------------------------- */

    const canvas = document.getElementById("player");
    const playBtn = document.getElementById("playBtn");
    const frameLabel = document.getElementById("frameLabel");
    const delayLabel = document.getElementById("delayLabel");
    const slider = document.getElementById("frameSlider");
    const sliderLabel = document.getElementById("sliderLabel");
    const frameBadge = document.getElementById("frameBadge");

    const ctx = canvas ? canvas.getContext("2d") : null;

    /* --------------------------------------------------------
       RICEZIONE DATI DALLA SCHEDA PRINCIPALE
       -------------------------------------------------------- */

    window.addEventListener("message", function (event) {

        /* Accetta solo messaggi con il nostro "marchio" */

        if (!event.data || event.data.type !== "gif-frame-master-preview") {
            return;
        }

        const payload = event.data.payload;

        if (!payload || !payload.frames || !payload.frames.length) {
            console.warn("Player: invalid payload received.");
            return;
        }

        /* Inizializza lo stato */

        framesData = payload.frames;

        gifW = payload.width || 0;
        gifH = payload.height || 0;

        total = framesData.length;

        /* Imposta titolo della scheda */

        if (gifW && gifH) {
            document.title =
                "Animated preview - " + gifW + "×" + gifH;
        }

        /* Prepara canvas */

        if (canvas) {
            canvas.width = gifW;
            canvas.height = gifH;
        }

        /* Configura slider */

        if (slider) {
            slider.min = "0";
            slider.max = String(total - 1);
            slider.value = "0";
        }

        if (sliderLabel) {
            sliderLabel.textContent = "1 / " + total;
        }

        /* Precarica tutte le immagini */

        imgs = [];
        loadedCount = 0;

        for (let i = 0; i < total; i++) {

            (function (idx) {

                const img = new Image();

                img.onload = function () {

                    imgs[idx] = img;
                    loadedCount++;

                    if (loadedCount === total) {
                        /* Tutte le immagini caricate: disegna
                           il primo frame */
                        drawFrame(0);
                    }
                };

                img.onerror = function () {

                    loadedCount++;

                    if (loadedCount === total) {
                        drawFrame(0);
                    }
                };

                img.src = framesData[idx].url;

            })(i);
        }
    });

    /* --------------------------------------------------------
       DISEGNO FRAME + AGGIORNAMENTO UI
       -------------------------------------------------------- */

    function drawFrame(idx) {

        if (!imgs[idx] || !ctx) {
            return;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(imgs[idx], 0, 0);

        /* Info in basso */

        if (frameLabel) {
            frameLabel.textContent = (idx + 1) + " / " + total;
        }

        if (delayLabel) {
            delayLabel.textContent = framesData[idx].delay + " ms";
        }

        if (sliderLabel) {
            sliderLabel.textContent = (idx + 1) + " / " + total;
        }

        if (slider) {
            slider.value = String(idx);
        }

        /* Badge in alto a destra */

        if (frameBadge) {
            frameBadge.textContent = "#" + (idx + 1);
        }
    }

    /* --------------------------------------------------------
       CICLO DI RIPRODUZIONE
       -------------------------------------------------------- */

    function scheduleNext() {

        if (currentIndex < 0 || currentIndex >= total) {
            return;
        }

        const frame = framesData[currentIndex];

        const baseDelay =
            frame && frame.delay ? frame.delay : 100;

        const effectiveDelay = Math.max(
            10,
            Math.round(baseDelay / speedMultiplier)
        );

        timerId = setTimeout(function () {

            currentIndex = (currentIndex + 1) % total;

            drawFrame(currentIndex);

            scheduleNext();

        }, effectiveDelay);
    }

    function play() {

        if (playing || total === 0) {
            return;
        }

        playing = true;

        if (playBtn) {
            playBtn.innerHTML = "&#9632; Stop";
        }

        if (frameBadge) {
            frameBadge.classList.add("playing");
        }

        scheduleNext();
    }

    function stop() {

        playing = false;

        if (timerId !== null) {
            clearTimeout(timerId);
            timerId = null;
        }

        if (playBtn) {
            playBtn.innerHTML = "&#9654; Play";
        }

        if (frameBadge) {
            frameBadge.classList.remove("playing");
        }
    }

    /* --------------------------------------------------------
       LISTENER: PLAY / STOP
       -------------------------------------------------------- */

    if (playBtn) {
        playBtn.addEventListener("click", function () {
            if (playing) {
                stop();
            }
            else {
                play();
            }
        });
    }

    /* --------------------------------------------------------
       LISTENER: SLIDER (salto a frame specifico)
       -------------------------------------------------------- */

    if (slider) {

        slider.addEventListener("input", function () {

            let idx = parseInt(slider.value, 10);

            if (!isFinite(idx) || idx < 0) {
                idx = 0;
            }

            if (idx >= total) {
                idx = total - 1;
            }

            /* Se sta suonando, fermati e vai al frame scelto */

            if (playing) {
                stop();
            }

            currentIndex = idx;
            drawFrame(idx);
        });
    }

    /* --------------------------------------------------------
       LISTENER: BOTTONI VELOCITÀ
       -------------------------------------------------------- */

    const speedButtons =
        document.querySelectorAll(".speed-btn");

    speedButtons.forEach(function (btn) {

        btn.addEventListener("click", function () {

            const newSpeed = parseFloat(btn.dataset.speed);

            if (!isFinite(newSpeed) || newSpeed <= 0) {
                return;
            }

            speedMultiplier = newSpeed;

            /* Aggiorna classe .active */

            speedButtons.forEach(function (b) {
                b.classList.remove("active");
            });

            btn.classList.add("active");

            /* Se sta suonando, riavvia il ciclo con la
               nuova velocità (senza fermare l'utente) */

            if (playing) {
                stop();
                play();
            }
        });
    });

    /* --------------------------------------------------------
       CLEANUP: ferma il timer alla chiusura della scheda
       -------------------------------------------------------- */

    window.addEventListener("beforeunload", stop);

})();