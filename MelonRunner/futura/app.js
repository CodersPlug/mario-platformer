/* Cuando sea vieja — icon-only: capture → progress → caricature slideshow → slider */
(function () {
  "use strict";

  const MODEL_URL =
    "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model";
  const CAM_FLAG = "futura_cam_granted_v1";
  const FRAME_STEP = 5;
  const FACE_CLASSES = [
    "face-baby",
    "face-kid",
    "face-teen",
    "face-adult",
    "face-elder",
  ];

  const els = {
    screenAsk: document.getElementById("screenAsk"),
    screenPreview: document.getElementById("screenPreview"),
    screenProgress: document.getElementById("screenProgress"),
    screenResult: document.getElementById("screenResult"),
    video: document.getElementById("video"),
    snap: document.getElementById("snap"),
    preview: document.getElementById("preview"),
    out: document.getElementById("out"),
    btnShoot: document.getElementById("btnShoot"),
    btnRetake: document.getElementById("btnRetake"),
    btnUsePhoto: document.getElementById("btnUsePhoto"),
    btnAgain: document.getElementById("btnAgain"),
    camStatus: document.getElementById("camStatus"),
    barFill: document.getElementById("barFill"),
    progressFace: document.getElementById("progressFace"),
    progressTicks: document.getElementById("progressTicks"),
    ageDock: document.getElementById("ageDock"),
    ageSlider: document.getElementById("ageSlider"),
    ageReadout: document.getElementById("ageReadout"),
    stageIcon: document.getElementById("stageIcon"),
    manualAge: document.getElementById("manualAge"),
    busyOverlay: document.getElementById("busyOverlay"),
    redrawFlash: document.getElementById("redrawFlash"),
  };

  const state = {
    stream: null,
    modelsReady: false,
    baseAge: null,
    sourceCanvas: null,
    cartoonCanvas: null,
    pendingCanvas: null,
    landmarks: null,
    faceBox: null,
    camStarting: false,
    slideshowTimer: null,
    lastShownAge: null,
  };

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function stageClassForAge(age) {
    if (age < 5) return "face-baby";
    if (age < 13) return "face-kid";
    if (age < 21) return "face-teen";
    if (age < 55) return "face-adult";
    return "face-elder";
  }

  function setFaceEl(el, ageOrClass) {
    if (!el) return;
    const cls =
      typeof ageOrClass === "number"
        ? stageClassForAge(ageOrClass)
        : ageOrClass;
    for (let i = 0; i < FACE_CLASSES.length; i++) {
      el.classList.remove(FACE_CLASSES[i]);
    }
    el.classList.add(cls);
  }

  function show(screen) {
    els.screenAsk.hidden = screen !== "ask";
    els.screenPreview.hidden = screen !== "preview";
    els.screenProgress.hidden = screen !== "progress";
    els.screenResult.hidden = screen !== "result";
    if (screen === "ask") {
      if (localStorage.getItem(CAM_FLAG)) {
        ensureCamera();
      } else {
        els.btnShoot.disabled = false;
        setCamBusy(false);
      }
    }
  }

  function setCamBusy(on) {
    els.camStatus.hidden = !on;
  }

  function setBusy(on) {
    els.busyOverlay.hidden = !on;
  }

  function flashRedraw() {
    els.redrawFlash.hidden = true;
    // restart CSS animation
    void els.redrawFlash.offsetWidth;
    els.redrawFlash.hidden = false;
    setTimeout(function () {
      els.redrawFlash.hidden = true;
    }, 280);
  }

  function setProgress(pct) {
    const p = clamp(Math.round(pct), 0, 100);
    els.barFill.style.width = p + "%";
    const ticks = els.progressTicks
      ? els.progressTicks.querySelectorAll("span")
      : [];
    const onCount = Math.round((p / 100) * ticks.length);
    for (let i = 0; i < ticks.length; i++) {
      ticks[i].classList.toggle("on", i < onCount);
    }
    // Cycle face icon while processing
    const faces = FACE_CLASSES;
    const idx = clamp(Math.floor((p / 100) * faces.length), 0, faces.length - 1);
    setFaceEl(els.progressFace, faces[idx]);
  }

  function drawPreview(canvas) {
    const frame = els.preview.parentElement;
    const fw = frame.clientWidth;
    const fh = frame.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    els.preview.width = Math.round(fw * dpr);
    els.preview.height = Math.round(fh * dpr);
    els.preview.style.width = fw + "px";
    els.preview.style.height = fh + "px";
    drawCover(
      els.preview.getContext("2d"),
      canvas,
      els.preview.width,
      els.preview.height
    );
  }

  function openPreview(canvas) {
    state.pendingCanvas = copyCanvas(canvas);
    pauseCameraTracks();
    show("preview");
    els.btnAgain.hidden = true;
    els.ageDock.hidden = true;
    requestAnimationFrame(function () {
      drawPreview(state.pendingCanvas);
    });
  }

  async function ensureFaceApi() {
    if (typeof faceapi !== "undefined") return true;
    for (let i = 0; i < 40; i++) {
      await wait(100);
      if (typeof faceapi !== "undefined") return true;
    }
    return false;
  }

  async function loadModels(onProg) {
    if (state.modelsReady) {
      if (onProg) onProg(40);
      return true;
    }
    const ok = await ensureFaceApi();
    if (!ok) return false;
    if (onProg) onProg(8);
    await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
    if (onProg) onProg(18);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    if (onProg) onProg(28);
    await faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL);
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    state.modelsReady = true;
    if (onProg) onProg(40);
    return true;
  }

  async function ensureCamera() {
    if (state.stream && state.stream.active) {
      els.btnShoot.disabled = false;
      setCamBusy(false);
      return true;
    }
    if (state.camStarting) return false;
    state.camStarting = true;
    els.btnShoot.disabled = true;
    setCamBusy(true);

    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { exact: "user" },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
      });
    } catch (errExact) {
      try {
        state.stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "user" },
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
        });
      } catch (err) {
        console.error(err);
        setCamBusy(true);
        els.btnShoot.disabled = true;
        state.camStarting = false;
        return false;
      }
    }

    try {
      localStorage.setItem(CAM_FLAG, "1");
      els.video.srcObject = state.stream;
      await els.video.play();
      setCamBusy(false);
      els.btnShoot.disabled = false;
      state.camStarting = false;
      return true;
    } catch (err) {
      console.error(err);
      setCamBusy(true);
      els.btnShoot.disabled = true;
      state.camStarting = false;
      return false;
    }
  }

  function pauseCameraTracks() {
    if (!state.stream) return;
    state.stream.getTracks().forEach(function (t) {
      t.enabled = false;
    });
  }

  function resumeCameraTracks() {
    if (!state.stream) return;
    state.stream.getTracks().forEach(function (t) {
      t.enabled = true;
    });
  }

  function stopCamera() {
    if (!state.stream) return;
    state.stream.getTracks().forEach(function (t) {
      t.stop();
    });
    state.stream = null;
    els.video.srcObject = null;
  }

  function grabCameraFrame() {
    const w = els.video.videoWidth || 720;
    const h = els.video.videoHeight || 960;
    const c = els.snap;
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(els.video, 0, 0, w, h);
    ctx.restore();
    return c;
  }

  function copyCanvas(from) {
    const c = document.createElement("canvas");
    c.width = from.width;
    c.height = from.height;
    c.getContext("2d").drawImage(from, 0, 0);
    return c;
  }

  function cropFacePads(canvas, box, pads) {
    const samples = [];
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const side = Math.max(box.width, box.height) * (1 + pad * 2);
      let x = Math.round(cx - side / 2);
      let y = Math.round(cy - side / 2);
      let s = Math.round(side);
      x = clamp(x, 0, canvas.width - 2);
      y = clamp(y, 0, canvas.height - 2);
      s = Math.min(s, canvas.width - x, canvas.height - y);
      if (s < 48) continue;
      const c = document.createElement("canvas");
      c.width = 224;
      c.height = 224;
      c.getContext("2d").drawImage(canvas, x, y, s, s, 0, 0, 224, 224);
      samples.push(c);
    }
    return samples;
  }

  function median(nums) {
    if (!nums.length) return null;
    const a = nums.slice().sort(function (x, y) {
      return x - y;
    });
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  async function detectAgeAndFace(canvas, onProg) {
    if (onProg) onProg(48);

    let dets = await faceapi
      .detectAllFaces(
        canvas,
        new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45 })
      )
      .withFaceLandmarks();

    if (!dets || !dets.length) {
      if (onProg) onProg(55);
      dets = await faceapi
        .detectAllFaces(
          canvas,
          new faceapi.TinyFaceDetectorOptions({
            inputSize: 512,
            scoreThreshold: 0.35,
          })
        )
        .withFaceLandmarks();
    }

    if (!dets || !dets.length) {
      return { age: null, landmarks: null, box: null };
    }

    dets.sort(function (a, b) {
      return b.detection.box.area - a.detection.box.area;
    });
    const best = dets[0];
    if (onProg) onProg(68);

    const ages = [];
    try {
      const extracted = await faceapi.extractFaces(canvas, [best.detection]);
      if (extracted && extracted[0]) {
        const r0 = await faceapi.nets.ageGenderNet.predictAgeAndGender(
          extracted[0]
        );
        if (r0 && typeof r0.age === "number") ages.push(r0.age);
      }
    } catch (err) {
      console.warn(err);
    }

    if (onProg) onProg(80);
    const crops = cropFacePads(canvas, best.detection.box, [0.15, 0.28, 0.4]);
    for (let i = 0; i < crops.length; i++) {
      try {
        const r = await faceapi.nets.ageGenderNet.predictAgeAndGender(
          crops[i]
        );
        if (r && typeof r.age === "number") ages.push(r.age);
      } catch (err) {
        console.warn(err);
      }
    }

    if (!ages.length) {
      const again = await faceapi
        .detectSingleFace(
          canvas,
          new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 })
        )
        .withFaceLandmarks()
        .withAgeAndGender();
      if (again && typeof again.age === "number") ages.push(again.age);
    }

    if (!ages.length) {
      return {
        age: null,
        landmarks: best.landmarks,
        box: best.detection.box,
      };
    }

    let age = median(ages);
    age = Math.round(age - 2);
    age = clamp(age, 1, 100);
    if (onProg) onProg(90);
    return {
      age: age,
      landmarks: best.landmarks,
      box: best.detection.box,
    };
  }

  function resizeOutToFrame() {
    const frame = els.out.parentElement;
    if (!frame) return { cw: 0, ch: 0 };
    const fw = Math.max(frame.clientWidth, 2);
    const fh = Math.max(frame.clientHeight, 2);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.round(fw * dpr);
    const ch = Math.round(fh * dpr);
    if (els.out.width !== cw) els.out.width = cw;
    if (els.out.height !== ch) els.out.height = ch;
    els.out.style.width = fw + "px";
    els.out.style.height = fh + "px";
    return { cw: cw, ch: ch };
  }

  function drawCover(ctx, img, cw, ch) {
    const iw = img.width;
    const ih = img.height;
    const scale = Math.max(cw / iw, ch / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
    return { scale: scale, dx: dx, dy: dy };
  }

  function quantize(v, steps) {
    const q = 255 / (steps - 1);
    return Math.round(v / q) * q;
  }

  function buildCartoon(source) {
    const maxW = 560;
    const scale = Math.min(1, maxW / source.width);
    const w = Math.max(2, Math.round(source.width * scale));
    const h = Math.max(2, Math.round(source.height * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(source, 0, 0, w, h);

    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const edge = new Uint8ClampedArray(w * h);

    for (let i = 0; i < d.length; i += 4) {
      let r = d[i];
      let g = d[i + 1];
      let b = d[i + 2];
      const gray = 0.3 * r + 0.59 * g + 0.11 * b;
      r = gray + (r - gray) * 1.7;
      g = gray + (g - gray) * 1.7;
      b = gray + (b - gray) * 1.7;
      d[i] = quantize(clamp(r, 0, 255), 6);
      d[i + 1] = quantize(clamp(g, 0, 255), 6);
      d[i + 2] = quantize(clamp(b, 0, 255), 6);
    }

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        const lum = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
        const lumR = 0.3 * d[i + 4] + 0.59 * d[i + 5] + 0.11 * d[i + 6];
        const lumD =
          0.3 * d[i + w * 4] +
          0.59 * d[i + w * 4 + 1] +
          0.11 * d[i + w * 4 + 2];
        edge[y * w + x] =
          Math.abs(lum - lumR) + Math.abs(lum - lumD) > 26 ? 1 : 0;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!edge[y * w + x]) continue;
        const i = (y * w + x) * 4;
        d[i] *= 0.3;
        d[i + 1] *= 0.3;
        d[i + 2] *= 0.3;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Soft posterize only — no drawn eyes/jaw (those looked creepy).
    return c;
  }

  /** Paint aged caricature into target (no fake eyeballs). */
  function paintAgeOnto(targetCanvas, targetAge, baseAge) {
    const w = targetCanvas.width;
    const h = targetCanvas.height;
    const ctx = targetCanvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cartoon = state.cartoonCanvas;
    if (!cartoon) return;
    const map = drawCover(ctx, cartoon, w, h);

    const delta = targetAge - baseAge;
    // Ease-out so the first years change fast but the look keeps evolving
    // all the way to 100 / 1 instead of saturating early.
    const easeOut = function (x) {
      return 1 - Math.pow(1 - x, 1.8);
    };
    const spanOld = Math.max(12, 100 - baseAge);
    const spanYoung = Math.max(8, baseAge - 1);
    const tOld = easeOut(clamp(Math.max(0, delta) / spanOld, 0, 1));
    const tYoung = easeOut(clamp(Math.max(0, -delta) / spanYoung, 0, 1));

    if (tOld > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = 0.22 + tOld * 0.62;
      ctx.fillStyle = "#c9a882";
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = "saturation";
      ctx.globalAlpha = 0.25 + tOld * 0.75;
      ctx.fillStyle = "#777";
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      // Silver hair wash (top of head only)
      ctx.save();
      ctx.globalAlpha = 0.18 + tOld * 0.62;
      const g = ctx.createLinearGradient(0, 0, 0, h * 0.42);
      g.addColorStop(0, "rgba(248,248,252,1)");
      g.addColorStop(0.55, "rgba(248,248,252,0.35)");
      g.addColorStop(1, "rgba(248,248,252,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h * 0.42);
      ctx.restore();

      // Soft wrinkle hints from landmarks (lines only — never cover eyes)
      if (state.landmarks) {
        const sx = cartoon.width / state.sourceCanvas.width;
        const sy = cartoon.height / state.sourceCanvas.height;
        const get = function (i) {
          const p = state.landmarks.positions[i];
          return {
            x: p.x * sx * map.scale + map.dx,
            y: p.y * sy * map.scale + map.dy,
          };
        };
        ctx.save();
        ctx.strokeStyle = "rgba(90, 55, 45," + (0.2 + tOld * 0.45) + ")";
        ctx.lineWidth = Math.max(1.5, w * 0.0035);
        ctx.lineCap = "round";
        // Forehead lines
        const a = get(19);
        const b = get(24);
        const midY = (a.y + b.y) / 2 - (b.x - a.x) * 0.18;
        const n = 1 + Math.round(tOld * 2);
        for (let i = 0; i < n; i++) {
          ctx.beginPath();
          ctx.moveTo(a.x + 12, midY + i * 7 * tOld);
          ctx.quadraticCurveTo(
            (a.x + b.x) / 2,
            midY - 5 + i * 7 * tOld,
            b.x - 12,
            midY + i * 7 * tOld
          );
          ctx.stroke();
        }
        // Smile lines (no crow-feet through the eyeball)
        smileLine(ctx, get(48), get(3), tOld * 0.85);
        smileLine(ctx, get(54), get(13), tOld * 0.85);
        ctx.restore();
      }
    }

    if (tYoung > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = 0.22 + tYoung * 0.55;
      ctx.fillStyle = "#ffd4bc";
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = 0.12 + tYoung * 0.4;
      ctx.fillStyle = "#ffb0c8";
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      // Soft rosy cheeks only (no eye redraw)
      if (state.landmarks) {
        const sx = cartoon.width / state.sourceCanvas.width;
        const sy = cartoon.height / state.sourceCanvas.height;
        const get = function (i) {
          const p = state.landmarks.positions[i];
          return {
            x: p.x * sx * map.scale + map.dx,
            y: p.y * sy * map.scale + map.dy,
          };
        };
        const cheekL = get(3);
        const cheekR = get(13);
        const rr = Math.max(10, w * 0.045);
        ctx.save();
        ctx.fillStyle = "rgba(255,130,150," + (0.18 + tYoung * 0.4) + ")";
        ctx.beginPath();
        ctx.arc(cheekL.x, cheekL.y, rr, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cheekR.x, cheekR.y, rr, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Colored frame so every age step is unmistakably different
    ctx.save();
    const accent = tOld >= tYoung ? "#c9a06a" : "#ff8fb3";
    ctx.globalAlpha = 0.4 + Math.max(tOld, tYoung) * 0.55;
    ctx.lineWidth = Math.max(12, w * 0.035);
    ctx.strokeStyle = accent;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.restore();
  }

  function smileLine(ctx, mouth, cheek, t) {
    ctx.beginPath();
    ctx.moveTo(mouth.x, mouth.y);
    ctx.quadraticCurveTo(
      (mouth.x + cheek.x) / 2,
      (mouth.y + cheek.y) / 2 + 14 * t,
      cheek.x,
      cheek.y + 8
    );
    ctx.stroke();
  }

  function updateAgeChrome(age, opts) {
    opts = opts || {};
    els.ageReadout.textContent = String(age);
    // Never rewrite slider.value while the user is dragging — breaks iOS range.
    if (opts.syncSlider !== false) {
      els.ageSlider.value = String(age);
    }
    setFaceEl(els.stageIcon, age);
  }

  /**
   * Paint the aged caricature straight into #out.
   * No per-age offscreen canvases: iOS Safari has a hard canvas-memory cap
   * and silently stops drawing once it is exceeded.
   */
  function paintLiveToOutput(age) {
    const size = resizeOutToFrame();
    if (size.cw < 4 || size.ch < 4 || !state.cartoonCanvas) return false;
    paintAgeOnto(els.out, age, state.baseAge);
    return true;
  }

  let pendingAge = null;
  let rafQueued = false;
  function scheduleLivePaint(age) {
    pendingAge = age;
    if (rafQueued) return;
    rafQueued = true;
    requestAnimationFrame(function () {
      rafQueued = false;
      const a = pendingAge;
      pendingAge = null;
      if (a == null) return;
      if (!paintLiveToOutput(a)) {
        // Layout not ready yet — try once more next frame
        requestAnimationFrame(function () {
          paintLiveToOutput(a);
        });
      }
    });
  }

  function showAge(age, opts) {
    opts = opts || {};
    age = clamp(Math.round(age), 1, 100);
    if (!state.cartoonCanvas || state.baseAge == null) return;

    if (opts.immediate) {
      if (!paintLiveToOutput(age)) scheduleLivePaint(age);
    } else {
      scheduleLivePaint(age);
    }

    updateAgeChrome(age, { syncSlider: opts.syncSlider !== false });
    if (opts.flash && state.lastShownAge !== null && state.lastShownAge !== age) {
      flashRedraw();
    }
    state.lastShownAge = age;
  }

  function stopSlideshow() {
    if (state.slideshowTimer) {
      clearTimeout(state.slideshowTimer);
      state.slideshowTimer = null;
    }
  }

  function playSlideshow(base) {
    stopSlideshow();
    const path = [];
    // young → old → settle on base
    const start = clamp(base - 20, 1, 100);
    const end = clamp(base + 35, 1, 100);
    for (let a = start; a <= end; a += FRAME_STEP) path.push(a);
    path.push(base);

    let i = 0;
    function step() {
      if (i >= path.length) {
        showAge(base, { flash: true, immediate: true });
        return;
      }
      showAge(path[i], { flash: i > 0, immediate: true });
      i += 1;
      state.slideshowTimer = setTimeout(step, i === path.length ? 200 : 160);
    }
    step();
  }

  function afterLayout(fn) {
    requestAnimationFrame(function () {
      requestAnimationFrame(fn);
    });
  }

  function applyDetectedAge(age) {
    state.baseAge = age;
    if (!state.cartoonCanvas && state.sourceCanvas) {
      state.cartoonCanvas = buildCartoon(state.sourceCanvas);
    }
    els.ageSlider.min = "1";
    els.ageSlider.max = "100";
    els.manualAge.hidden = true;
    els.ageDock.hidden = false;
    els.btnAgain.hidden = false;

    afterLayout(function () {
      showAge(age, { immediate: true });
      playSlideshow(age);
    });
  }

  async function processImage(canvas) {
    stopSlideshow();
    show("progress");
    setProgress(2);
    els.ageDock.hidden = true;
    els.btnAgain.hidden = true;
    setBusy(false);

    state.sourceCanvas = copyCanvas(canvas);
    state.cartoonCanvas = null;
    state.pendingCanvas = null;
    state.landmarks = null;
    state.faceBox = null;
    state.baseAge = null;
    state.lastShownAge = null;

    try {
      const loaded = await loadModels(setProgress);
      if (!loaded) throw new Error("models");

      setProgress(45);
      await wait(60);
      const det = await detectAgeAndFace(canvas, setProgress);
      state.landmarks = det.landmarks;
      state.faceBox = det.box || null;

      setProgress(88);
      await wait(40);
      state.cartoonCanvas = buildCartoon(state.sourceCanvas);

      if (det.age == null) {
        setProgress(100);
        await wait(200);
        show("result");
        els.btnAgain.hidden = false;
        els.manualAge.hidden = false;
        els.ageDock.hidden = true;
        afterLayout(function () {
          const size = resizeOutToFrame();
          if (state.cartoonCanvas && size.cw > 4) {
            drawCover(
              els.out.getContext("2d"),
              state.cartoonCanvas,
              size.cw,
              size.ch
            );
          }
        });
        return;
      }

      state.baseAge = det.age;
      setProgress(96);
      await wait(120);
      setProgress(100);
      await wait(180);

      show("result");
      applyDetectedAge(det.age);
    } catch (err) {
      console.error(err);
      setProgress(100);
      await wait(200);
      show("result");
      els.btnAgain.hidden = false;
      if (state.sourceCanvas && !state.cartoonCanvas) {
        state.cartoonCanvas = buildCartoon(state.sourceCanvas);
      }
      els.manualAge.hidden = false;
      els.ageDock.hidden = true;
      afterLayout(function () {
        const size = resizeOutToFrame();
        if (state.cartoonCanvas && size.cw > 4) {
          drawCover(
            els.out.getContext("2d"),
            state.cartoonCanvas,
            size.cw,
            size.ch
          );
        }
      });
    }
  }

  function resetSession() {
    stopSlideshow();
    state.sourceCanvas = null;
    state.cartoonCanvas = null;
    state.pendingCanvas = null;
    state.landmarks = null;
    state.faceBox = null;
    state.baseAge = null;
    state.lastShownAge = null;
    els.ageDock.hidden = true;
    els.btnAgain.hidden = true;
    els.manualAge.hidden = true;
    setBusy(false);
    setProgress(0);
    show("ask");
    resumeCameraTracks();
    els.btnShoot.disabled = false;
  }

  els.btnShoot.addEventListener("click", async function () {
    if (els.btnShoot.disabled || state.camStarting) return;
    els.btnShoot.disabled = true;
    const ok = await ensureCamera();
    if (!ok) {
      els.btnShoot.disabled = false;
      return;
    }
    if (!els.video.videoWidth) {
      await Promise.race([
        new Promise(function (resolve) {
          els.video.addEventListener("loadeddata", resolve, { once: true });
        }),
        wait(1500),
      ]);
    }
    await wait(80);
    if (!els.video.videoWidth) {
      setCamBusy(true);
      els.btnShoot.disabled = false;
      return;
    }
    const frame = grabCameraFrame();
    openPreview(frame);
    els.btnShoot.disabled = false;
  });

  els.btnRetake.addEventListener("click", function () {
    state.pendingCanvas = null;
    show("ask");
    resumeCameraTracks();
    els.btnShoot.disabled = false;
  });

  els.btnUsePhoto.addEventListener("click", function () {
    if (!state.pendingCanvas) return;
    processImage(state.pendingCanvas);
  });

  els.btnAgain.addEventListener("click", resetSession);

  document.querySelectorAll(".stage-pick").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      const age = clamp(parseInt(btn.getAttribute("data-age"), 10) || 8, 1, 100);
      if (!state.cartoonCanvas && state.sourceCanvas) {
        state.cartoonCanvas = buildCartoon(state.sourceCanvas);
      }
      if (!state.cartoonCanvas) return;
      setBusy(true);
      state.baseAge = age;
      await wait(60);
      setBusy(false);
      els.manualAge.hidden = true;
      els.ageDock.hidden = false;
      afterLayout(function () {
        showAge(age, { immediate: true });
        playSlideshow(age);
      });
    });
  });

  function onSliderMove(ev) {
    if (state.baseAge == null || !state.cartoonCanvas) return;
    stopSlideshow();
    const age = parseInt(els.ageSlider.value, 10);
    if (!Number.isFinite(age)) return;
    // Live regen while dragging; stronger flash when finger/mouse releases.
    const releasing =
      !ev ||
      ev.type === "change" ||
      ev.type === "pointerup" ||
      ev.type === "touchend" ||
      ev.type === "mouseup";
    showAge(age, {
      immediate: releasing,
      syncSlider: false,
      flash: releasing,
    });
  }
  els.ageSlider.addEventListener("input", onSliderMove);
  els.ageSlider.addEventListener("change", onSliderMove);
  els.ageSlider.addEventListener("pointerup", onSliderMove);
  els.ageSlider.addEventListener("touchend", onSliderMove);
  els.ageSlider.addEventListener("mouseup", onSliderMove);

  window.addEventListener("resize", function () {
    if (!els.screenPreview.hidden && state.pendingCanvas) {
      drawPreview(state.pendingCanvas);
    }
    if (state.cartoonCanvas && state.baseAge != null) {
      showAge(parseInt(els.ageSlider.value, 10) || state.baseAge, {
        immediate: true,
      });
    }
  });

  loadModels().catch(function () {});
  show("ask");
  window.addEventListener("pagehide", stopCamera);
})();
