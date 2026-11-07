/* Cuando sea vieja — real FRAN re-aging (ONNX) + face-api age detect */
(function () {
  "use strict";

  const MODEL_URL =
    "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model";
  const CAM_FLAG = "futura_cam_granted_v1";
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
    outImg: document.getElementById("outImg"),
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
  };

  const state = {
    stream: null,
    modelsReady: false,
    franReady: false,
    baseAge: null,
    sourceCanvas: null,
    pendingCanvas: null,
    faceBox: null,
    camStarting: false,
    lastShownAge: null,
    scrubAge: 30,
    cache: Object.create(null),
    aging: false,
    ageReq: 0,
  };

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }
  function wait(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  function setFaceEl(el, ageOrClass) {
    if (!el) return;
    const cls =
      typeof ageOrClass === "number"
        ? ageOrClass < 5
          ? "face-baby"
          : ageOrClass < 13
            ? "face-kid"
            : ageOrClass < 21
              ? "face-teen"
              : ageOrClass < 55
                ? "face-adult"
                : "face-elder"
        : ageOrClass;
    for (let i = 0; i < FACE_CLASSES.length; i++) el.classList.remove(FACE_CLASSES[i]);
    el.classList.add(cls);
  }

  function show(screen) {
    els.screenAsk.hidden = screen !== "ask";
    els.screenPreview.hidden = screen !== "preview";
    els.screenProgress.hidden = screen !== "progress";
    els.screenResult.hidden = screen !== "result";
    if (screen === "ask") {
      if (localStorage.getItem(CAM_FLAG)) ensureCamera();
      else {
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

  function setProgress(pct) {
    const p = clamp(Math.round(pct), 0, 100);
    els.barFill.style.width = p + "%";
    const ticks = els.progressTicks.querySelectorAll("span");
    const onCount = Math.round((p / 100) * ticks.length);
    for (let i = 0; i < ticks.length; i++) ticks[i].classList.toggle("on", i < onCount);
    const idx = clamp(Math.floor((p / 100) * FACE_CLASSES.length), 0, FACE_CLASSES.length - 1);
    setFaceEl(els.progressFace, FACE_CLASSES[idx]);
  }

  function copyCanvas(from) {
    const c = document.createElement("canvas");
    c.width = from.width;
    c.height = from.height;
    c.getContext("2d").drawImage(from, 0, 0);
    return c;
  }

  function showCanvas(c) {
    try {
      els.outImg.src = c.toDataURL("image/jpeg", 0.92);
    } catch (err) {
      console.error(err);
    }
  }

  function setScrubAge(age) {
    age = clamp(Math.round(age), 1, 100);
    const pct = ((age - 1) / 99) * 100;
    els.scrubThumb.style.left = pct + "%";
    els.scrubFill.style.width = pct + "%";
    els.scrub.setAttribute("aria-valuenow", String(age));
    els.ageReadout.textContent = String(age);
    state.scrubAge = age;
    document.querySelectorAll(".jump-btn").forEach(function (btn) {
      const a = parseInt(btn.getAttribute("data-age"), 10);
      btn.classList.toggle("on", Math.abs(a - age) <= 10);
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

  async function loadFaceModels(onProg) {
    if (state.modelsReady) {
      if (onProg) onProg(40);
      return true;
    }
    if (!(await ensureFaceApi())) return false;
    if (onProg) onProg(10);
    await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
    if (onProg) onProg(20);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    if (onProg) onProg(30);
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
      try {
        state.stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { exact: "user" }, width: { ideal: 1280 }, height: { ideal: 960 } },
        });
      } catch (e1) {
        state.stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 960 } },
        });
      }
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

  function drawCover(ctx, img, cw, ch) {
    const scale = Math.max(cw / img.width, ch / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  }

  function drawPreview(canvas) {
    const frame = els.preview.parentElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    els.preview.width = Math.round(frame.clientWidth * dpr);
    els.preview.height = Math.round(frame.clientHeight * dpr);
    els.preview.style.width = frame.clientWidth + "px";
    els.preview.style.height = frame.clientHeight + "px";
    drawCover(els.preview.getContext("2d"), canvas, els.preview.width, els.preview.height);
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
      .detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45 }))
      .withFaceLandmarks();
    if (!dets || !dets.length) {
      if (onProg) onProg(55);
      dets = await faceapi
        .detectAllFaces(
          canvas,
          new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.35 })
        )
        .withFaceLandmarks();
    }
    if (!dets || !dets.length) return { age: null, box: null };
    dets.sort(function (a, b) {
      return b.detection.box.area - a.detection.box.area;
    });
    const best = dets[0];
    if (onProg) onProg(70);
    const ages = [];
    try {
      const extracted = await faceapi.extractFaces(canvas, [best.detection]);
      if (extracted && extracted[0]) {
        const r0 = await faceapi.nets.ageGenderNet.predictAgeAndGender(extracted[0]);
        if (r0 && typeof r0.age === "number") ages.push(r0.age);
      }
    } catch (e) {}
    const crops = cropFacePads(canvas, best.detection.box, [0.15, 0.28, 0.4]);
    for (let i = 0; i < crops.length; i++) {
      try {
        const r = await faceapi.nets.ageGenderNet.predictAgeAndGender(crops[i]);
        if (r && typeof r.age === "number") ages.push(r.age);
      } catch (e) {}
    }
    if (!ages.length) {
      return { age: null, box: best.detection.box };
    }
    let age = Math.round(median(ages) - 2);
    age = clamp(age, 1, 100);
    if (onProg) onProg(85);
    return { age: age, box: best.detection.box };
  }

  async function applyTargetAge(targetAge) {
    targetAge = clamp(Math.round(targetAge), 1, 100);
    setScrubAge(targetAge);
    state.lastShownAge = targetAge;

    if (!state.sourceCanvas || state.baseAge == null || !state.faceBox) return;
    if (Math.abs(targetAge - state.baseAge) < 2) {
      showCanvas(state.sourceCanvas);
      return;
    }

    const key = String(targetAge);
    if (state.cache[key]) {
      showCanvas(state.cache[key]);
      return;
    }

    if (typeof FuturaFran === "undefined") {
      console.error("FRAN missing");
      return;
    }

    const req = ++state.ageReq;
    state.aging = true;
    setBusy(true);
    try {
      const aged = await FuturaFran.reageFace(
        state.sourceCanvas,
        state.faceBox,
        state.baseAge,
        targetAge,
        null
      );
      if (req !== state.ageReq) return; // superseded
      state.cache[key] = aged;
      showCanvas(aged);
    } catch (err) {
      console.error(err);
    } finally {
      if (req === state.ageReq) {
        state.aging = false;
        setBusy(false);
      }
    }
  }

  async function processImage(canvas) {
    show("progress");
    setProgress(2);
    els.ageDock.hidden = true;
    els.btnAgain.hidden = true;
    setBusy(false);
    state.sourceCanvas = copyCanvas(canvas);
    state.pendingCanvas = null;
    state.faceBox = null;
    state.baseAge = null;
    state.cache = Object.create(null);
    state.lastShownAge = null;

    try {
      // Load face models + start FRAN download in parallel
      const franWarm = FuturaFran.getSession(function (f) {
        setProgress(40 + f * 40);
      }).then(function () {
        state.franReady = true;
      }).catch(function (e) {
        console.error("FRAN load", e);
      });

      const loaded = await loadFaceModels(setProgress);
      if (!loaded) throw new Error("models");

      setProgress(45);
      const det = await detectAgeAndFace(canvas, setProgress);
      state.faceBox = det.box;

      setProgress(90);
      await Promise.race([franWarm, wait(120000)]);
      setProgress(100);
      await wait(150);

      show("result");
      els.btnAgain.hidden = false;

      if (det.age == null || !det.box) {
        showCanvas(state.sourceCanvas);
        els.manualAge.hidden = false;
        els.ageDock.hidden = true;
        return;
      }

      state.baseAge = det.age;
      els.manualAge.hidden = true;
      els.ageDock.hidden = false;
      showCanvas(state.sourceCanvas);
      setScrubAge(det.age);
      state.lastShownAge = det.age;
    } catch (err) {
      console.error(err);
      setProgress(100);
      show("result");
      els.btnAgain.hidden = false;
      showCanvas(state.sourceCanvas);
      els.manualAge.hidden = false;
      els.ageDock.hidden = true;
    }
  }

  function resetSession() {
    state.sourceCanvas = null;
    state.pendingCanvas = null;
    state.faceBox = null;
    state.baseAge = null;
    state.cache = Object.create(null);
    state.lastShownAge = null;
    state.ageReq++;
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
    openPreview(grabCameraFrame());
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
    btn.addEventListener("click", function () {
      const age = clamp(parseInt(btn.getAttribute("data-age"), 10) || 30, 1, 100);
      if (!state.sourceCanvas || !state.faceBox) return;
      state.baseAge = age;
      els.manualAge.hidden = true;
      els.ageDock.hidden = false;
      showCanvas(state.sourceCanvas);
      setScrubAge(age);
      state.lastShownAge = age;
    });
  });

  document.querySelectorAll(".jump-btn").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (state.baseAge == null || !state.sourceCanvas) return;
      applyTargetAge(parseInt(btn.getAttribute("data-age"), 10));
    });
  });

  (function attachScrubber() {
    const scrub = els.scrub;
    let active = false;
    let lastAge = null;

    function ageFromX(clientX) {
      const r = scrub.getBoundingClientRect();
      if (r.width <= 0) return null;
      const f = clamp((clientX - r.left) / r.width, 0, 1);
      return clamp(Math.round(1 + f * 99), 1, 100);
    }

    function during(clientX) {
      const age = ageFromX(clientX);
      if (age == null) return;
      lastAge = age;
      setScrubAge(age);
    }

    function finish() {
      if (lastAge == null || state.baseAge == null) return;
      applyTargetAge(lastAge);
    }

    scrub.addEventListener(
      "touchstart",
      function (e) {
        if (!e.touches.length) return;
        active = true;
        during(e.touches[0].clientX);
        e.preventDefault();
      },
      { passive: false }
    );
    scrub.addEventListener(
      "touchmove",
      function (e) {
        if (!active || !e.touches.length) return;
        during(e.touches[0].clientX);
        e.preventDefault();
      },
      { passive: false }
    );
    scrub.addEventListener(
      "touchend",
      function () {
        if (!active) return;
        active = false;
        finish();
      },
      { passive: true }
    );

    scrub.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      active = true;
      during(e.clientX);
      function move(ev) {
        during(ev.clientX);
      }
      function up() {
        active = false;
        finish();
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      }
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    });
  })();

  document.getElementById("buildTag").textContent = String(window.__FUTURA_BUILD || 13);
  loadFaceModels().catch(function () {});
  // Warm FRAN in background after face models
  setTimeout(function () {
    if (typeof FuturaFran !== "undefined") {
      FuturaFran.getSession().then(function () {
        state.franReady = true;
      }).catch(function () {});
    }
  }, 2000);
  show("ask");
  window.addEventListener("pagehide", stopCamera);
})();
