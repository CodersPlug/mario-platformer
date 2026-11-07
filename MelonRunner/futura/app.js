/* Cuando sea vieja — universal: image → progress → announce age → slider */
(function () {
  "use strict";

  const MODEL_URL =
    "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model";

  const CAM_FLAG = "futura_cam_granted_v1";

  const els = {
    screenAsk: document.getElementById("screenAsk"),
    screenPreview: document.getElementById("screenPreview"),
    screenProgress: document.getElementById("screenProgress"),
    screenResult: document.getElementById("screenResult"),
    cameraBox: document.getElementById("cameraBox"),
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
    progressPct: document.getElementById("progressPct"),
    progressTitle: document.getElementById("progressTitle"),
    progressDetail: document.getElementById("progressDetail"),
    ageDock: document.getElementById("ageDock"),
    ageSlider: document.getElementById("ageSlider"),
    ageReadout: document.getElementById("ageReadout"),
    ageBadge: document.getElementById("ageBadge"),
    announceAge: document.getElementById("announceAge"),
    statusLine: document.getElementById("statusLine"),
    storyLine: document.getElementById("storyLine"),
    ageAnnounce: document.getElementById("ageAnnounce"),
    manualAge: document.getElementById("manualAge"),
    manualInput: document.getElementById("manualInput"),
    btnManualOk: document.getElementById("btnManualOk"),
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
  };

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function show(screen) {
    els.screenAsk.hidden = screen !== "ask";
    els.screenPreview.hidden = screen !== "preview";
    els.screenProgress.hidden = screen !== "progress";
    els.screenResult.hidden = screen !== "result";
    if (screen === "ask") {
      // If permission was granted before, reopen quietly (no new prompt).
      // First visit: wait for the camera button tap (needs a user gesture on iPad).
      if (localStorage.getItem(CAM_FLAG)) {
        ensureCamera();
      } else {
        els.btnShoot.disabled = false;
        setCamStatus("");
      }
    }
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
    drawCover(els.preview.getContext("2d"), canvas, els.preview.width, els.preview.height);
  }

  function openPreview(canvas) {
    state.pendingCanvas = copyCanvas(canvas);
    pauseCameraTracks();
    show("preview");
    els.btnAgain.hidden = true;
    els.ageDock.hidden = true;
    // Layout then paint
    requestAnimationFrame(function () {
      drawPreview(state.pendingCanvas);
    });
  }

  function setCamStatus(msg) {
    if (!msg) {
      els.camStatus.hidden = true;
      els.camStatus.textContent = "";
      return;
    }
    els.camStatus.hidden = false;
    els.camStatus.textContent = msg;
  }

  function setProgress(pct, detail) {
    const p = clamp(Math.round(pct), 0, 100);
    els.barFill.style.width = p + "%";
    els.progressPct.textContent = p + "%";
    if (detail) els.progressDetail.textContent = detail;
  }

  function storyFor(age, base) {
    if (age === base) return "Así te ves ahora.";
    if (age < base) return "Viaje al pasado: un poco más joven.";
    if (age < 13) return "Etapa de crecer y jugar.";
    if (age < 20) return "Casi adulto, con ideas nuevas.";
    if (age < 40) return "Adultez: proyectos y cuentos.";
    if (age < 65) return "Canas brillantes y mucha historia.";
    return "Vejez feliz: sabiduría y ganas de jugar.";
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
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
    if (onProg) onProg(8, "Cargando detector…");
    await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
    if (onProg) onProg(18, "Cargando landmarks…");
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    if (onProg) onProg(28, "Cargando estimador de edad…");
    await faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL);
    // Fallback detector for hard angles
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    state.modelsReady = true;
    if (onProg) onProg(40, "Modelos listos");
    return true;
  }

  /** Open front camera. Browser asks permission only the first time (then remembers). */
  async function ensureCamera() {
    if (state.stream && state.stream.active) {
      els.btnShoot.disabled = false;
      setCamStatus("");
      return true;
    }
    if (state.camStarting) return false;
    state.camStarting = true;
    els.btnShoot.disabled = true;

    const firstTime = !localStorage.getItem(CAM_FLAG);
    setCamStatus(firstTime ? "Permiso de cámara…" : "");

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
      // Some iPads ignore exact; fall back to ideal without re-prompting if already granted.
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
        setCamStatus("Activá la cámara en Ajustes → Safari");
        els.btnShoot.disabled = true;
        state.camStarting = false;
        return false;
      }
    }

    try {
      localStorage.setItem(CAM_FLAG, "1");
      els.video.srcObject = state.stream;
      await els.video.play();
      setCamStatus("");
      els.btnShoot.disabled = false;
      state.camStarting = false;
      return true;
    } catch (err) {
      console.error(err);
      setCamStatus("No se pudo iniciar el preview");
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

  /**
   * Largest face + multi-crop age estimate (aligned patches beat full-frame).
   * Returns null age if undetectable.
   */
  async function detectAgeAndFace(canvas, onProg) {
    if (onProg) onProg(48, "Buscando rostros…");

    let dets = await faceapi
      .detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45 }))
      .withFaceLandmarks();

    if (!dets || !dets.length) {
      if (onProg) onProg(55, "Probando detector alternativo…");
      dets = await faceapi
        .detectAllFaces(
          canvas,
          new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.35 })
        )
        .withFaceLandmarks();
    }

    if (!dets || !dets.length) {
      return { age: null, landmarks: null, gender: null };
    }

    dets.sort(function (a, b) {
      return b.detection.box.area - a.detection.box.area;
    });
    const best = dets[0];
    if (onProg) onProg(68, "Alineando rostro…");

    const ages = [];
    // ExtractFaces gives landmark-aligned 112–ish crops when available
    try {
      const extracted = await faceapi.extractFaces(canvas, [best.detection]);
      if (extracted && extracted[0]) {
        const r0 = await faceapi.nets.ageGenderNet.predictAgeAndGender(extracted[0]);
        if (r0 && typeof r0.age === "number") ages.push(r0.age);
      }
    } catch (err) {
      console.warn(err);
    }

    if (onProg) onProg(80, "Estimando edad…");
    const crops = cropFacePads(canvas, best.detection.box, [0.15, 0.28, 0.4]);
    for (let i = 0; i < crops.length; i++) {
      try {
        const r = await faceapi.nets.ageGenderNet.predictAgeAndGender(crops[i]);
        if (r && typeof r.age === "number") ages.push(r.age);
      } catch (err) {
        console.warn(err);
      }
    }

    if (!ages.length) {
      // Last resort: full pipeline withAgeAndGender on original detection path
      const again = await faceapi
        .detectSingleFace(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 }))
        .withFaceLandmarks()
        .withAgeAndGender();
      if (again && typeof again.age === "number") ages.push(again.age);
    }

    if (!ages.length) {
      return { age: null, landmarks: best.landmarks, gender: null };
    }

    // Median is stabler than mean; tiny downward nudge — nets often over-age adults.
    let age = median(ages);
    age = Math.round(age - 2);
    age = clamp(age, 1, 100);

    if (onProg) onProg(92, "Edad estimada: " + age);
    return {
      age: age,
      landmarks: best.landmarks,
      box: best.detection.box,
      gender: null,
      score: best.detection.score,
      samples: ages.length,
    };
  }

  function resizeOutToFrame() {
    const frame = els.out.parentElement;
    const fw = frame.clientWidth;
    const fh = frame.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    els.out.width = Math.round(fw * dpr);
    els.out.height = Math.round(fh * dpr);
    els.out.style.width = fw + "px";
    els.out.style.height = fh + "px";
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

  function mapPoint(pt, map) {
    return { x: pt.x * map.scale + map.dx, y: pt.y * map.scale + map.dy };
  }

  function quantize(v, steps) {
    const q = 255 / (steps - 1);
    return Math.round(v / q) * q;
  }

  /** Build a visible cartoon/caricature canvas from the selfie. */
  function buildCartoon(source) {
    const maxW = 640;
    const scale = Math.min(1, maxW / source.width);
    const w = Math.max(2, Math.round(source.width * scale));
    const h = Math.max(2, Math.round(source.height * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(source, 0, 0, w, h);

    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const edge = new Uint8ClampedArray(w * h);

    // Posterize + boost saturation (cartoon look)
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i];
      let g = d[i + 1];
      let b = d[i + 2];
      const gray = 0.3 * r + 0.59 * g + 0.11 * b;
      r = gray + (r - gray) * 1.65;
      g = gray + (g - gray) * 1.65;
      b = gray + (b - gray) * 1.65;
      d[i] = quantize(clamp(r, 0, 255), 7);
      d[i + 1] = quantize(clamp(g, 0, 255), 7);
      d[i + 2] = quantize(clamp(b, 0, 255), 7);
    }

    // Simple edge ink
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        const lum =
          0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
        const lumR =
          0.3 * d[i + 4] + 0.59 * d[i + 5] + 0.11 * d[i + 6];
        const lumD =
          0.3 * d[i + w * 4] +
          0.59 * d[i + w * 4 + 1] +
          0.11 * d[i + w * 4 + 2];
        const gmag = Math.abs(lum - lumR) + Math.abs(lum - lumD);
        edge[y * w + x] = gmag > 28 ? 1 : 0;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!edge[y * w + x]) continue;
        const i = (y * w + x) * 4;
        d[i] = d[i] * 0.35;
        d[i + 1] = d[i + 1] * 0.35;
        d[i + 2] = d[i + 2] * 0.35;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Landmark ink outline if we have a face
    if (state.landmarks) {
      const positions = state.landmarks.positions;
      const sx = w / source.width;
      const sy = h / source.height;
      ctx.save();
      ctx.strokeStyle = "rgba(40, 24, 30, 0.85)";
      ctx.lineWidth = Math.max(2, w * 0.006);
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let i = 0; i <= 16; i++) {
        const p = positions[i];
        const x = p.x * sx;
        const y = p.y * sy;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // Eyes as bigger cartoon circles
      const eyePairs = [
        [36, 39],
        [42, 45],
      ];
      for (let e = 0; e < eyePairs.length; e++) {
        const a = positions[eyePairs[e][0]];
        const b = positions[eyePairs[e][1]];
        const cx = ((a.x + b.x) / 2) * sx;
        const cy = ((a.y + b.y) / 2) * sy;
        const rad = (Math.abs(b.x - a.x) * sx) * 0.85;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(6, rad), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "rgba(20,20,30,0.9)";
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(2.5, rad * 0.35), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    return c;
  }

  function drawCrow(ctx, inner, outer, t, dir) {
    const cx = (inner.x + outer.x) / 2 + dir * 22;
    const cy = (inner.y + outer.y) / 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(cx, cy - 2 + i * 5);
      ctx.quadraticCurveTo(
        cx + dir * (12 + t * 20),
        cy + i * 4,
        cx + dir * (24 + t * 22),
        cy - 8 + i * 9
      );
      ctx.stroke();
    }
  }

  function smileLine(ctx, mouth, cheek, t) {
    ctx.beginPath();
    ctx.moveTo(mouth.x, mouth.y);
    ctx.quadraticCurveTo(
      (mouth.x + cheek.x) / 2,
      (mouth.y + cheek.y) / 2 + 12 * t,
      cheek.x,
      cheek.y + 6
    );
    ctx.stroke();
  }

  function hairCapPath(ctx, get) {
    const left = get(0);
    const right = get(16);
    const brow = [17, 18, 19, 20, 21, 22, 23, 24, 25, 26].map(get);
    const top = brow.reduce(function (m, p) {
      return Math.min(m, p.y);
    }, brow[0].y);
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.quadraticCurveTo(
      (left.x + right.x) / 2,
      top - (right.x - left.x) * 0.62,
      right.x,
      right.y
    );
    ctx.lineTo(right.x, top + 24);
    ctx.quadraticCurveTo(
      (left.x + right.x) / 2,
      top - (right.x - left.x) * 0.4,
      left.x,
      top + 24
    );
    ctx.closePath();
  }

  function renderAge(targetAge) {
    if (!state.sourceCanvas || state.baseAge == null) return;
    if (!state.cartoonCanvas) {
      state.cartoonCanvas = buildCartoon(state.sourceCanvas);
    }

    resizeOutToFrame();
    const ctx = els.out.getContext("2d");
    const cw = els.out.width;
    const ch = els.out.height;
    if (cw < 4 || ch < 4) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    // Always start from caricature (not the raw photo)
    const map = drawCover(ctx, state.cartoonCanvas, cw, ch);
    // Remap landmarks from source → cartoon → output
    const srcToCartoon = {
      scaleX: state.cartoonCanvas.width / state.sourceCanvas.width,
      scaleY: state.cartoonCanvas.height / state.sourceCanvas.height,
    };
    const mapLm = function (pt) {
      return {
        x: pt.x * srcToCartoon.scaleX * map.scale + map.dx,
        y: pt.y * srcToCartoon.scaleY * map.scale + map.dy,
      };
    };

    const base = state.baseAge;
    const delta = targetAge - base;
    const older = Math.max(0, delta);
    const younger = Math.max(0, -delta);
    const tOld = clamp(older / 40, 0, 1);
    const tYoung = clamp(younger / 20, 0, 1);

    if (tOld > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "saturation";
      ctx.fillStyle = "rgba(150,130,110," + (0.25 + tOld * 0.55) + ")";
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = "rgba(210, 185, 150," + (0.12 + tOld * 0.35) + ")";
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }

    if (tYoung > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = "rgba(255, 220, 200," + (0.2 + tYoung * 0.4) + ")";
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = "overlay";
      ctx.fillStyle = "rgba(255, 180, 200," + tYoung * 0.25 + ")";
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }

    if (state.landmarks) {
      const positions = state.landmarks.positions;
      const get = function (i) {
        return mapLm(positions[i]);
      };

      if (tOld > 0.05) {
        ctx.save();
        ctx.strokeStyle = "rgba(70, 40, 35," + (0.35 + tOld * 0.55) + ")";
        ctx.lineWidth = Math.max(2, cw * 0.0045 * (0.7 + tOld));
        ctx.lineCap = "round";
        drawCrow(ctx, get(36), get(39), tOld, -1);
        drawCrow(ctx, get(45), get(42), tOld, 1);
        smileLine(ctx, get(48), get(3), tOld);
        smileLine(ctx, get(54), get(13), tOld);
        const a = get(19);
        const b = get(24);
        const midY = (a.y + b.y) / 2 - (b.x - a.x) * 0.22;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(a.x + 10, midY + i * 7 * tOld);
          ctx.quadraticCurveTo(
            (a.x + b.x) / 2,
            midY - 6 + i * 7 * tOld,
            b.x - 10,
            midY + i * 7 * tOld
          );
          ctx.stroke();
        }
        ctx.restore();

        ctx.save();
        hairCapPath(ctx, get);
        ctx.fillStyle = "rgba(236, 236, 242," + (0.25 + tOld * 0.55) + ")";
        ctx.globalCompositeOperation = "screen";
        ctx.fill();
        ctx.restore();
      }

      if (tYoung > 0.05) {
        // Bigger sparkly cartoon eyes when younger
        const eyes = [
          [36, 39],
          [42, 45],
        ];
        for (let e = 0; e < eyes.length; e++) {
          const p0 = get(eyes[e][0]);
          const p1 = get(eyes[e][1]);
          const cx = (p0.x + p1.x) / 2;
          const cy = (p0.y + p1.y) / 2;
          const rad = Math.abs(p1.x - p0.x) * (0.7 + tYoung * 0.5);
          ctx.save();
          ctx.fillStyle = "rgba(255,255,255," + (0.25 + tYoung * 0.35) + ")";
          ctx.beginPath();
          ctx.arc(cx, cy, rad, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#1a1a28";
          ctx.beginPath();
          ctx.arc(cx, cy, rad * 0.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }

    ctx.restore();

    els.ageReadout.textContent = String(targetAge);
    els.ageBadge.textContent = targetAge + " años";
    els.storyLine.textContent = storyFor(targetAge, base);
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
    els.ageSlider.value = String(age);
    els.ageReadout.textContent = String(age);
    els.ageBadge.textContent = age + " años";
    els.announceAge.textContent = age + " años";
    els.ageAnnounce.hidden = false;
    els.manualAge.hidden = true;
    els.ageDock.hidden = false;
    els.statusLine.textContent = "Mové el slider para viajar en el tiempo.";
    afterLayout(function () {
      renderAge(age);
    });
  }

  async function processImage(canvas) {
    show("progress");
    els.ageDock.hidden = true;
    els.btnAgain.hidden = true;
    els.progressTitle.textContent = "Procesando…";
    setProgress(2, "Iniciando sesión");

    state.sourceCanvas = copyCanvas(canvas);
    state.cartoonCanvas = null;
    state.pendingCanvas = null;
    state.landmarks = null;
    state.faceBox = null;
    state.baseAge = null;

    try {
      const loaded = await loadModels(setProgress);
      if (!loaded) throw new Error("No cargaron los modelos");

      setProgress(45, "Analizando la foto…");
      await wait(80);
      const det = await detectAgeAndFace(canvas, setProgress);
      state.landmarks = det.landmarks;
      state.faceBox = det.box || null;

      setProgress(88, "Dibujando caricatura…");
      state.cartoonCanvas = buildCartoon(state.sourceCanvas);
      setProgress(100, "Listo");
      await wait(180);

      show("result");
      els.btnAgain.hidden = false;

      if (det.age == null) {
        afterLayout(function () {
          resizeOutToFrame();
          if (state.cartoonCanvas) {
            drawCover(
              els.out.getContext("2d"),
              state.cartoonCanvas,
              els.out.width,
              els.out.height
            );
          }
        });
        els.ageAnnounce.hidden = true;
        els.manualAge.hidden = false;
        els.ageDock.hidden = true;
        els.manualInput.value = "";
        els.statusLine.textContent = "";
        return;
      }

      applyDetectedAge(det.age);
    } catch (err) {
      console.error(err);
      setProgress(100, "Error");
      await wait(200);
      show("result");
      els.btnAgain.hidden = false;
      if (state.sourceCanvas && !state.cartoonCanvas) {
        state.cartoonCanvas = buildCartoon(state.sourceCanvas);
      }
      afterLayout(function () {
        resizeOutToFrame();
        if (state.cartoonCanvas) {
          drawCover(
            els.out.getContext("2d"),
            state.cartoonCanvas,
            els.out.width,
            els.out.height
          );
        }
      });
      els.ageAnnounce.hidden = true;
      els.manualAge.hidden = false;
      els.ageDock.hidden = true;
    }
  }

  function resetSession() {
    state.sourceCanvas = null;
    state.cartoonCanvas = null;
    state.pendingCanvas = null;
    state.landmarks = null;
    state.faceBox = null;
    state.baseAge = null;
    els.ageDock.hidden = true;
    els.btnAgain.hidden = true;
    els.manualAge.hidden = true;
    els.ageAnnounce.hidden = false;
    setProgress(0, "Preparando");
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
      setCamStatus("Esperá el preview y volvé a tocar");
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

  els.btnManualOk.addEventListener("click", function () {
    const age = clamp(parseInt(els.manualInput.value, 10) || 0, 1, 100);
    if (!age) {
      els.manualInput.focus();
      return;
    }
    applyDetectedAge(age);
  });

  function onSliderMove() {
    if (state.baseAge == null || !state.cartoonCanvas) return;
    renderAge(parseInt(els.ageSlider.value, 10));
  }
  els.ageSlider.addEventListener("input", onSliderMove);
  els.ageSlider.addEventListener("change", onSliderMove);

  window.addEventListener("resize", function () {
    if (!els.screenPreview.hidden && state.pendingCanvas) {
      drawPreview(state.pendingCanvas);
    }
    if (state.cartoonCanvas && state.baseAge != null) {
      renderAge(parseInt(els.ageSlider.value, 10) || state.baseAge);
    }
  });

  // Warm models in background; camera starts with ask screen (permission once).
  loadModels().catch(function () {});
  show("ask");

  window.addEventListener("pagehide", stopCamera);
})();
