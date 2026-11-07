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
    outImg: document.getElementById("outImg"),
    ageFx: document.getElementById("ageFx"),
    ageWash: document.getElementById("ageWash"),
    ageHair: document.getElementById("ageHair"),
    ageRing: document.getElementById("ageRing"),
    resultFrame: document.getElementById("resultFrame"),
    btnShoot: document.getElementById("btnShoot"),
    btnRetake: document.getElementById("btnRetake"),
    btnUsePhoto: document.getElementById("btnUsePhoto"),
    btnAgain: document.getElementById("btnAgain"),
    camStatus: document.getElementById("camStatus"),
    barFill: document.getElementById("barFill"),
    progressFace: document.getElementById("progressFace"),
    progressTicks: document.getElementById("progressTicks"),
    ageDock: document.getElementById("ageDock"),
    scrub: document.getElementById("scrub"),
    scrubThumb: document.getElementById("scrubThumb"),
    scrubFill: document.getElementById("scrubFill"),
    ageReadout: document.getElementById("ageReadout"),
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
    scrubAge: 30,
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

  function easeOut(x) {
    return 1 - Math.pow(1 - x, 1.6);
  }

  /** Publish the cartoon base once as an <img> (age is CSS after that). */
  function publishCartoonImg() {
    if (!state.cartoonCanvas || !els.outImg) return;
    try {
      els.outImg.src = state.cartoonCanvas.toDataURL("image/jpeg", 0.92);
    } catch (err) {
      console.error(err);
    }
  }

  function ageAmounts(age) {
    const base = state.baseAge == null ? age : state.baseAge;
    const delta = age - base;
    const spanOld = Math.max(8, 100 - base);
    const spanYoung = Math.max(5, base - 1);
    return {
      tOld: easeOut(clamp(Math.max(0, delta) / spanOld, 0, 1)),
      tYoung: easeOut(clamp(Math.max(0, -delta) / spanYoung, 0, 1)),
    };
  }

  /** Draw wrinkles / soft hair strokes onto the overlay canvas (no eyeballs). */
  function paintAgeFx(age) {
    const fx = els.ageFx;
    const frame = els.resultFrame;
    if (!fx || !frame) return;
    const w = Math.max(2, Math.round(frame.clientWidth * (window.devicePixelRatio || 1)));
    const h = Math.max(2, Math.round(frame.clientHeight * (window.devicePixelRatio || 1)));
    if (fx.width !== w) fx.width = w;
    if (fx.height !== h) fx.height = h;
    const ctx = fx.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const am = ageAmounts(age);
    if (am.tOld < 0.05 && am.tYoung < 0.05) return;

    if (am.tOld > 0.05) {
      const t = am.tOld;
      ctx.save();
      ctx.strokeStyle = "rgba(70,40,30," + (0.25 + t * 0.55) + ")";
      ctx.lineWidth = Math.max(2, w * 0.004);
      ctx.lineCap = "round";
      // Forehead wrinkles (upper third)
      const y0 = h * 0.22;
      for (let i = 0; i < 2 + Math.round(t * 3); i++) {
        ctx.beginPath();
        ctx.moveTo(w * 0.28, y0 + i * h * 0.03 * t);
        ctx.quadraticCurveTo(
          w * 0.5,
          y0 + i * h * 0.03 * t - 6,
          w * 0.72,
          y0 + i * h * 0.03 * t
        );
        ctx.stroke();
      }
      // Smile lines
      ctx.beginPath();
      ctx.moveTo(w * 0.32, h * 0.58);
      ctx.quadraticCurveTo(w * 0.28, h * 0.66, w * 0.26, h * 0.72);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(w * 0.68, h * 0.58);
      ctx.quadraticCurveTo(w * 0.72, h * 0.66, w * 0.74, h * 0.72);
      ctx.stroke();
      ctx.restore();
    }

    // Younger look is CSS-only (no cheek blobs — they land wrong without face box).
  }

  /**
   * Apply age look by setting element styles DIRECTLY (no CSS variables).
   * Plus overlay canvas strokes. Impossible to miss on laptop/iPad.
   */
  function applyAgeLook(age) {
    const am = ageAmounts(age);
    const tOld = am.tOld;
    const tYoung = am.tYoung;
    const img = els.outImg;

    if (tOld > 0.01) {
      const f =
        "sepia(" +
        (0.2 + tOld * 0.8).toFixed(3) +
        ") saturate(" +
        (1 - tOld * 0.8).toFixed(3) +
        ") brightness(" +
        (1 - tOld * 0.22).toFixed(3) +
        ") contrast(" +
        (1 + tOld * 0.3).toFixed(3) +
        ") grayscale(" +
        (tOld * 0.6).toFixed(3) +
        ")";
      if (img) {
        img.style.filter = f;
        img.style.webkitFilter = f;
      }
      if (els.ageWash) {
        els.ageWash.style.background = "#c9a06a";
        els.ageWash.style.mixBlendMode = "multiply";
        els.ageWash.style.opacity = String(0.18 + tOld * 0.55);
      }
      if (els.ageHair) els.ageHair.style.opacity = String(0.2 + tOld * 0.75);
      if (els.ageRing) {
        els.ageRing.style.boxShadow =
          "inset 0 0 0 " +
          Math.round(6 + tOld * 14) +
          "px rgba(201,160,106," +
          (0.55 + tOld * 0.4).toFixed(2) +
          ")";
      }
    } else if (tYoung > 0.01) {
      const f =
        "saturate(" +
        (1 + tYoung * 1.1).toFixed(3) +
        ") brightness(" +
        (1 + tYoung * 0.22).toFixed(3) +
        ") contrast(" +
        (1 + tYoung * 0.12).toFixed(3) +
        ") hue-rotate(" +
        (-tYoung * 14).toFixed(1) +
        "deg)";
      if (img) {
        img.style.filter = f;
        img.style.webkitFilter = f;
      }
      if (els.ageWash) {
        els.ageWash.style.background = "#ff9ec0";
        els.ageWash.style.mixBlendMode = "soft-light";
        els.ageWash.style.opacity = String(0.22 + tYoung * 0.5);
      }
      if (els.ageHair) els.ageHair.style.opacity = "0";
      if (els.ageRing) {
        els.ageRing.style.boxShadow =
          "inset 0 0 0 " +
          Math.round(6 + tYoung * 14) +
          "px rgba(255,120,170," +
          (0.55 + tYoung * 0.4).toFixed(2) +
          ")";
      }
    } else {
      if (img) {
        img.style.filter = "none";
        img.style.webkitFilter = "none";
      }
      if (els.ageWash) els.ageWash.style.opacity = "0";
      if (els.ageHair) els.ageHair.style.opacity = "0";
      if (els.ageRing) els.ageRing.style.boxShadow = "inset 0 0 0 3px rgba(255,255,255,0.55)";
    }

    paintAgeFx(age);

    // Highlight matching jump button
    document.querySelectorAll(".jump-btn").forEach(function (btn) {
      const a = parseInt(btn.getAttribute("data-age"), 10);
      btn.classList.toggle("on", Math.abs(a - age) <= 8);
    });
  }

  function setScrubAge(age) {
    age = clamp(Math.round(age), 1, 100);
    const pct = ((age - 1) / 99) * 100;
    if (els.scrubThumb) els.scrubThumb.style.left = pct + "%";
    if (els.scrubFill) els.scrubFill.style.width = pct + "%";
    if (els.scrub) els.scrub.setAttribute("aria-valuenow", String(age));
    state.scrubAge = age;
  }

  function showAge(age, opts) {
    opts = opts || {};
    age = clamp(Math.round(age), 1, 100);
    if (!state.cartoonCanvas || state.baseAge == null) return;

    applyAgeLook(age);
    els.ageReadout.textContent = String(age);
    if (opts.syncScrub !== false) setScrubAge(age);

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
    publishCartoonImg();
    els.manualAge.hidden = true;
    els.ageDock.hidden = false;
    els.btnAgain.hidden = false;

    afterLayout(function () {
      // No auto-slideshow: it fought the user's scrubber and looked broken.
      showAge(age, { flash: true });
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
      publishCartoonImg();

      if (det.age == null) {
        setProgress(100);
        await wait(200);
        show("result");
        els.btnAgain.hidden = false;
        els.manualAge.hidden = false;
        els.ageDock.hidden = true;
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
      publishCartoonImg();
      els.manualAge.hidden = false;
      els.ageDock.hidden = true;
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
      publishCartoonImg();
      await wait(60);
      setBusy(false);
      els.manualAge.hidden = true;
      els.ageDock.hidden = false;
      afterLayout(function () {
        showAge(age, { flash: true });
      });
    });
  });

  // One-tap age jumps — easiest way to verify recreation works.
  document.querySelectorAll(".jump-btn").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (state.baseAge == null || !state.cartoonCanvas) return;
      stopSlideshow();
      const age = clamp(parseInt(btn.getAttribute("data-age"), 10) || 30, 1, 100);
      showAge(age, { syncScrub: true, flash: true });
    });
  });

  // Custom scrubber — owns all touch/pointer; never uses <input type=range>.
  (function attachScrubber() {
    const scrub = els.scrub;
    if (!scrub) return;
    let active = false;

    function ageFromClientX(clientX) {
      const r = scrub.getBoundingClientRect();
      if (r.width <= 0) return null;
      const f = clamp((clientX - r.left) / r.width, 0, 1);
      return clamp(Math.round(1 + f * 99), 1, 100);
    }

    function applyFromX(clientX, releasing) {
      const age = ageFromClientX(clientX);
      if (age == null || state.baseAge == null || !state.cartoonCanvas) return;
      stopSlideshow();
      showAge(age, { syncScrub: true, flash: !!releasing });
    }

    function onStart(clientX, e) {
      active = true;
      applyFromX(clientX, false);
      if (e && e.cancelable) e.preventDefault();
    }
    function onMove(clientX, e) {
      if (!active) return;
      applyFromX(clientX, false);
      if (e && e.cancelable) e.preventDefault();
    }
    function onEnd(clientX, e) {
      if (!active) return;
      active = false;
      applyFromX(clientX, true);
      if (e && e.cancelable) e.preventDefault();
    }

    scrub.addEventListener(
      "touchstart",
      function (e) {
        if (!e.touches.length) return;
        onStart(e.touches[0].clientX, e);
      },
      { passive: false }
    );
    scrub.addEventListener(
      "touchmove",
      function (e) {
        if (!e.touches.length) return;
        onMove(e.touches[0].clientX, e);
      },
      { passive: false }
    );
    scrub.addEventListener(
      "touchend",
      function (e) {
        const t = e.changedTouches && e.changedTouches[0];
        onEnd(t ? t.clientX : state.scrubAge, e);
      },
      { passive: false }
    );
    scrub.addEventListener("touchcancel", function () {
      active = false;
    });

    scrub.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      onStart(e.clientX, e);
      function move(ev) {
        onMove(ev.clientX, ev);
      }
      function up(ev) {
        onEnd(ev.clientX, ev);
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      }
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    });
  })();

  window.addEventListener("resize", function () {
    if (!els.screenPreview.hidden && state.pendingCanvas) {
      drawPreview(state.pendingCanvas);
    }
    if (state.cartoonCanvas && state.baseAge != null) {
      showAge(state.lastShownAge || state.baseAge, { syncScrub: true });
    }
  });

  const buildTag = document.getElementById("buildTag");
  if (buildTag) buildTag.textContent = String(window.__FUTURA_BUILD || 12);

  loadModels().catch(function () {});
  show("ask");
  window.addEventListener("pagehide", stopCamera);
})();
