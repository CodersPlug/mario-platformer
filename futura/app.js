/* Cuando sea vieja — iPad web selfie age slider (on-device, no upload). */
(function () {
  "use strict";

  const MODEL_URL =
    "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model";

  const video = document.getElementById("video");
  const snap = document.getElementById("snap");
  const out = document.getElementById("out");
  const btnStartCam = document.getElementById("btnStartCam");
  const btnShoot = document.getElementById("btnShoot");
  const btnAgain = document.getElementById("btnAgain");
  const screenCapture = document.getElementById("screenCapture");
  const screenResult = document.getElementById("screenResult");
  const ageDock = document.getElementById("ageDock");
  const ageSlider = document.getElementById("ageSlider");
  const ageReadout = document.getElementById("ageReadout");
  const ageBadge = document.getElementById("ageBadge");
  const statusLine = document.getElementById("statusLine");
  const storyLine = document.getElementById("storyLine");
  const camHint = document.getElementById("camHint");

  const state = {
    stream: null,
    modelsReady: false,
    baseAge: 6,
    sourceCanvas: null,
    landmarks: null,
    box: null,
  };

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function storyFor(age, base) {
    if (age === base) return "Así te ves ahora.";
    if (age < base) return "Un poquito más chica… ¡hola bebé yo!";
    if (age < 13) return "Vas creciendo y seguís jugando.";
    if (age < 20) return "Casi grande, con ideas nuevas.";
    if (age < 40) return "Adulta: inventás juegos y contás cuentos.";
    if (age < 65) return "Con canas brillantes y mucha historia.";
    return "Viejita feliz: sabia, tierna y con ganas de jugar.";
  }

  async function loadModels() {
    if (state.modelsReady || typeof faceapi === "undefined") return state.modelsReady;
    statusLine.textContent = "Preparando magia…";
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
    ]);
    state.modelsReady = true;
    return true;
  }

  async function startCamera() {
    camHint.textContent = "Pedí permiso a la cámara…";
    try {
      if (state.stream) {
        state.stream.getTracks().forEach(function (t) {
          t.stop();
        });
      }
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
      });
      video.srcObject = state.stream;
      await video.play();
      camHint.hidden = true;
      btnStartCam.hidden = true;
      btnShoot.hidden = false;
    } catch (err) {
      console.error(err);
      camHint.hidden = false;
      camHint.textContent =
        "No se pudo abrir la cámara. Revisá permisos de Safari → Cámara.";
      btnStartCam.hidden = false;
      btnShoot.hidden = true;
    }
  }

  function stopCamera() {
    if (!state.stream) return;
    state.stream.getTracks().forEach(function (t) {
      t.stop();
    });
    state.stream = null;
    video.srcObject = null;
  }

  function grabFrame() {
    const w = video.videoWidth || 720;
    const h = video.videoHeight || 960;
    snap.width = w;
    snap.height = h;
    const ctx = snap.getContext("2d");
    // Mirror to match preview
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
    return snap;
  }

  async function detectAgeAndFace(canvas) {
    await loadModels();
    if (!state.modelsReady) {
      return { age: 6, landmarks: null, box: null };
    }
    const opts = new faceapi.TinyFaceDetectorOptions({
      inputSize: 416,
      scoreThreshold: 0.4,
    });
    const det = await faceapi
      .detectSingleFace(canvas, opts)
      .withFaceLandmarks(true)
      .withAgeAndGender();

    if (!det) {
      return { age: 6, landmarks: null, box: null };
    }

    // Kids are often overestimated by the net; bias gently toward child range
    // when confidence suggests a young face, then clamp.
    let age = Math.round(det.age);
    if (age < 3) age = 3;
    if (age > 90) age = 90;

    return {
      age: age,
      landmarks: det.landmarks,
      box: det.detection.box,
    };
  }

  function copySource(fromCanvas) {
    const c = document.createElement("canvas");
    c.width = fromCanvas.width;
    c.height = fromCanvas.height;
    c.getContext("2d").drawImage(fromCanvas, 0, 0);
    state.sourceCanvas = c;
  }

  function resizeOutToFrame() {
    const frame = out.parentElement;
    const fw = frame.clientWidth;
    const fh = frame.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    out.width = Math.round(fw * dpr);
    out.height = Math.round(fh * dpr);
    out.style.width = fw + "px";
    out.style.height = fh + "px";
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
    return {
      x: pt.x * map.scale + map.dx,
      y: pt.y * map.scale + map.dy,
    };
  }

  /** Kid-safe local aging: filters + landmark wrinkles / gray wash. No cloud. */
  function renderAge(targetAge) {
    if (!state.sourceCanvas) return;
    resizeOutToFrame();
    const ctx = out.getContext("2d");
    const cw = out.width;
    const ch = out.height;
    ctx.clearRect(0, 0, cw, ch);

    const map = drawCover(ctx, state.sourceCanvas, cw, ch);
    const base = state.baseAge;
    const delta = targetAge - base;
    const older = Math.max(0, delta);
    const younger = Math.max(0, -delta);

    // Global look
    if (older > 0) {
      const t = clamp(older / 55, 0, 1);
      ctx.save();
      ctx.globalCompositeOperation = "saturation";
      ctx.fillStyle = "rgba(160,140,120," + (0.15 + t * 0.45) + ")";
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = "soft-light";
      ctx.fillStyle = "rgba(210, 190, 160," + t * 0.35 + ")";
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();

      // Soft blur as we age a lot
      if (t > 0.35) {
        ctx.save();
        ctx.filter = "blur(" + (t * 1.2).toFixed(2) + "px)";
        ctx.globalAlpha = 0.25 * t;
        ctx.drawImage(out, 0, 0);
        ctx.restore();
        ctx.filter = "none";
      }
    }

    if (younger > 0) {
      const t = clamp(younger / 20, 0, 1);
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = "rgba(255, 230, 210," + t * 0.28 + ")";
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }

    // Landmark overlays
    if (state.landmarks) {
      const positions = state.landmarks.positions;
      const get = function (i) {
        return mapPoint(positions[i], map);
      };

      if (older > 0) {
        const t = clamp(older / 50, 0, 1);
        ctx.save();
        ctx.strokeStyle = "rgba(90, 60, 50," + (0.15 + t * 0.45) + ")";
        ctx.lineWidth = Math.max(1, cw * 0.0025);
        ctx.lineCap = "round";

        // Crow's feet
        drawCrow(ctx, get(36), get(39), t, -1);
        drawCrow(ctx, get(45), get(42), t, 1);

        // Forehead
        if (t > 0.25) {
          const a = get(19);
          const b = get(24);
          const midY = (a.y + b.y) / 2 - (b.x - a.x) * 0.25;
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.moveTo(a.x + 8, midY + i * 6 * t);
            ctx.quadraticCurveTo(
              (a.x + b.x) / 2,
              midY - 4 + i * 6 * t,
              b.x - 8,
              midY + i * 6 * t
            );
            ctx.stroke();
          }
        }

        // Smile lines
        if (t > 0.2) {
          smileLine(ctx, get(48), get(3), t);
          smileLine(ctx, get(54), get(13), t);
        }
        ctx.restore();

        // Gray hair wash over top of head
        if (t > 0.15) {
          const jaw = [0, 1, 2, 14, 15, 16].map(get);
          const brow = [17, 18, 19, 20, 21, 22, 23, 24, 25, 26].map(get);
          ctx.save();
          ctx.beginPath();
          const top = brow.reduce(function (m, p) {
            return Math.min(m, p.y);
          }, brow[0].y);
          const left = jaw[0];
          const right = jaw[jaw.length - 1];
          ctx.moveTo(left.x, left.y);
          ctx.quadraticCurveTo(
            (left.x + right.x) / 2,
            top - (right.x - left.x) * 0.55,
            right.x,
            right.y
          );
          ctx.lineTo(right.x, top + 20);
          ctx.quadraticCurveTo(
            (left.x + right.x) / 2,
            top - (right.x - left.x) * 0.35,
            left.x,
            top + 20
          );
          ctx.closePath();
          ctx.fillStyle = "rgba(245,245,248," + t * 0.42 + ")";
          ctx.globalCompositeOperation = "screen";
          ctx.fill();
          ctx.restore();
        }
      }
    }

    ageReadout.textContent = String(targetAge);
    ageBadge.textContent = targetAge + " años";
    storyLine.textContent = storyFor(targetAge, base);
  }

  function drawCrow(ctx, inner, outer, t, dir) {
    const cx = (inner.x + outer.x) / 2 + dir * 18;
    const cy = (inner.y + outer.y) / 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(cx, cy - 2 + i * 4);
      ctx.quadraticCurveTo(cx + dir * (10 + t * 14), cy + i * 3, cx + dir * (18 + t * 16), cy - 6 + i * 7);
      ctx.stroke();
    }
  }

  function smileLine(ctx, mouth, cheek, t) {
    ctx.beginPath();
    ctx.moveTo(mouth.x, mouth.y);
    ctx.quadraticCurveTo(
      (mouth.x + cheek.x) / 2,
      (mouth.y + cheek.y) / 2 + 8 * t,
      cheek.x,
      cheek.y + 4
    );
    ctx.stroke();
  }

  function setSliderToBase(age) {
    state.baseAge = age;
    ageSlider.min = "1";
    ageSlider.max = "90";
    ageSlider.value = String(age);
    ageReadout.textContent = String(age);
    ageBadge.textContent = age + " años";
  }

  async function onShoot() {
    if (!video.videoWidth) return;
    const frame = grabFrame();
    stopCamera();
    screenCapture.hidden = true;
    screenResult.hidden = false;
    btnAgain.hidden = false;
    ageDock.hidden = false;
    statusLine.textContent = "Mirando tu foto…";
    copySource(frame);
    setSliderToBase(6);
    renderAge(6);

    try {
      const det = await detectAgeAndFace(frame);
      state.landmarks = det.landmarks;
      state.box = det.box;
      setSliderToBase(det.age);
      statusLine.textContent = det.landmarks
        ? "Edad estimada: " + det.age + " · mové el slider"
        : "No vi bien la cara · empezamos en " + det.age + " · mové el slider";
      renderAge(det.age);
    } catch (err) {
      console.error(err);
      statusLine.textContent = "Usamos 6 años · mové el slider";
      setSliderToBase(6);
      renderAge(6);
    }
  }

  function resetToCamera() {
    screenResult.hidden = true;
    ageDock.hidden = true;
    btnAgain.hidden = true;
    screenCapture.hidden = false;
    btnStartCam.hidden = false;
    btnShoot.hidden = true;
    camHint.hidden = false;
    camHint.textContent = "Tocá para usar la cámara de adelante";
    state.sourceCanvas = null;
    state.landmarks = null;
    startCamera();
  }

  btnStartCam.addEventListener("click", function () {
    loadModels();
    startCamera();
  });
  btnShoot.addEventListener("click", onShoot);
  btnAgain.addEventListener("click", resetToCamera);

  ageSlider.addEventListener("input", function () {
    const age = parseInt(ageSlider.value, 10);
    renderAge(age);
  });

  window.addEventListener("resize", function () {
    if (state.sourceCanvas) {
      renderAge(parseInt(ageSlider.value, 10) || state.baseAge);
    }
  });

  // Warm models after first paint (still needs gesture for camera).
  if (document.readyState === "complete") {
    loadModels().catch(function () {});
  } else {
    window.addEventListener("load", function () {
      loadModels().catch(function () {});
    });
  }
})();
