/* Cuando sea vieja — universal: image → progress → announce age → slider */
(function () {
  "use strict";

  const MODEL_URL =
    "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model";

  const els = {
    screenAsk: document.getElementById("screenAsk"),
    screenProgress: document.getElementById("screenProgress"),
    screenResult: document.getElementById("screenResult"),
    cameraBox: document.getElementById("cameraBox"),
    video: document.getElementById("video"),
    snap: document.getElementById("snap"),
    out: document.getElementById("out"),
    btnCamera: document.getElementById("btnCamera"),
    btnShoot: document.getElementById("btnShoot"),
    btnAgain: document.getElementById("btnAgain"),
    fileInput: document.getElementById("fileInput"),
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
    landmarks: null,
  };

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function show(screen) {
    els.screenAsk.hidden = screen !== "ask";
    els.screenProgress.hidden = screen !== "progress";
    els.screenResult.hidden = screen !== "result";
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

  async function startCamera() {
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
      els.video.srcObject = state.stream;
      await els.video.play();
      els.cameraBox.hidden = false;
      document.querySelector(".ask-card").hidden = true;
    } catch (err) {
      console.error(err);
      alert("No se pudo abrir la cámara. Probá “Elegir imagen” o revisá permisos.");
    }
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

  function loadFileToCanvas(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        const c = document.createElement("canvas");
        // Cap long edge for speed / memory on iPad
        const maxEdge = 1280;
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        const scale = Math.min(1, maxEdge / Math.max(w, h));
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        c.width = w;
        c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("No se pudo leer la imagen"));
      };
      img.src = url;
    });
  }

  function copyCanvas(from) {
    const c = document.createElement("canvas");
    c.width = from.width;
    c.height = from.height;
    c.getContext("2d").drawImage(from, 0, 0);
    return c;
  }

  /** Largest face + age. No child bias. Returns null age if undetectable. */
  async function detectAgeAndFace(canvas, onProg) {
    if (onProg) onProg(48, "Buscando rostros…");

    let dets = await faceapi
      .detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 }))
      .withFaceLandmarks()
      .withAgeAndGender();

    if (!dets || !dets.length) {
      if (onProg) onProg(55, "Probando detector alternativo…");
      dets = await faceapi
        .detectAllFaces(
          canvas,
          new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.3 })
        )
        .withFaceLandmarks()
        .withAgeAndGender();
    }

    if (onProg) onProg(75, "Estimando edad…");

    if (!dets || !dets.length) {
      return { age: null, landmarks: null, gender: null };
    }

    // Largest face by box area (session subject)
    dets.sort(function (a, b) {
      return b.detection.box.area - a.detection.box.area;
    });
    const best = dets[0];
    let age = Math.round(best.age);
    age = clamp(age, 1, 100);

    if (onProg) onProg(90, "Edad estimada: " + age);
    return {
      age: age,
      landmarks: best.landmarks,
      gender: best.gender,
      score: best.detection.score,
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

  function drawCrow(ctx, inner, outer, t, dir) {
    const cx = (inner.x + outer.x) / 2 + dir * 18;
    const cy = (inner.y + outer.y) / 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(cx, cy - 2 + i * 4);
      ctx.quadraticCurveTo(
        cx + dir * (10 + t * 14),
        cy + i * 3,
        cx + dir * (18 + t * 16),
        cy - 6 + i * 7
      );
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

  function renderAge(targetAge) {
    if (!state.sourceCanvas || state.baseAge == null) return;
    resizeOutToFrame();
    const ctx = els.out.getContext("2d");
    const cw = els.out.width;
    const ch = els.out.height;
    ctx.clearRect(0, 0, cw, ch);

    const map = drawCover(ctx, state.sourceCanvas, cw, ch);
    const base = state.baseAge;
    const delta = targetAge - base;
    const older = Math.max(0, delta);
    const younger = Math.max(0, -delta);

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
    }

    if (younger > 0) {
      const t = clamp(younger / 25, 0, 1);
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = "rgba(255, 230, 210," + t * 0.28 + ")";
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }

    if (state.landmarks && older > 0) {
      const positions = state.landmarks.positions;
      const get = function (i) {
        return mapPoint(positions[i], map);
      };
      const t = clamp(older / 50, 0, 1);
      ctx.save();
      ctx.strokeStyle = "rgba(90, 60, 50," + (0.15 + t * 0.45) + ")";
      ctx.lineWidth = Math.max(1, cw * 0.0025);
      ctx.lineCap = "round";
      drawCrow(ctx, get(36), get(39), t, -1);
      drawCrow(ctx, get(45), get(42), t, 1);
      if (t > 0.2) {
        smileLine(ctx, get(48), get(3), t);
        smileLine(ctx, get(54), get(13), t);
      }
      if (t > 0.25) {
        const a = get(19);
        const b = get(24);
        const midY = (a.y + b.y) / 2 - (b.x - a.x) * 0.25;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(a.x + 8, midY + i * 6 * t);
          ctx.quadraticCurveTo((a.x + b.x) / 2, midY - 4 + i * 6 * t, b.x - 8, midY + i * 6 * t);
          ctx.stroke();
        }
      }
      ctx.restore();

      if (t > 0.15) {
        const left = get(0);
        const right = get(16);
        const brow = [17, 18, 19, 20, 21, 22, 23, 24, 25, 26].map(get);
        const top = brow.reduce(function (m, p) {
          return Math.min(m, p.y);
        }, brow[0].y);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.quadraticCurveTo((left.x + right.x) / 2, top - (right.x - left.x) * 0.55, right.x, right.y);
        ctx.lineTo(right.x, top + 20);
        ctx.quadraticCurveTo((left.x + right.x) / 2, top - (right.x - left.x) * 0.35, left.x, top + 20);
        ctx.closePath();
        ctx.fillStyle = "rgba(245,245,248," + t * 0.42 + ")";
        ctx.globalCompositeOperation = "screen";
        ctx.fill();
        ctx.restore();
      }
    }

    els.ageReadout.textContent = String(targetAge);
    els.ageBadge.textContent = targetAge + " años";
    els.storyLine.textContent = storyFor(targetAge, base);
  }

  function applyDetectedAge(age) {
    state.baseAge = age;
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
    renderAge(age);
  }

  async function processImage(canvas) {
    show("progress");
    els.ageDock.hidden = true;
    els.btnAgain.hidden = true;
    els.progressTitle.textContent = "Procesando…";
    setProgress(2, "Iniciando sesión");

    state.sourceCanvas = copyCanvas(canvas);
    state.landmarks = null;
    state.baseAge = null;

    try {
      const loaded = await loadModels(setProgress);
      if (!loaded) throw new Error("No cargaron los modelos");

      setProgress(45, "Analizando la foto…");
      await wait(120);
      const det = await detectAgeAndFace(canvas, setProgress);
      state.landmarks = det.landmarks;

      setProgress(100, "Listo");
      await wait(280);

      show("result");
      els.btnAgain.hidden = false;
      // Draw base photo first
      resizeOutToFrame();
      drawCover(els.out.getContext("2d"), state.sourceCanvas, els.out.width, els.out.height);

      if (det.age == null) {
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
      resizeOutToFrame();
      if (state.sourceCanvas) {
        drawCover(els.out.getContext("2d"), state.sourceCanvas, els.out.width, els.out.height);
      }
      els.ageAnnounce.hidden = true;
      els.manualAge.hidden = false;
      els.ageDock.hidden = true;
    }
  }

  function resetSession() {
    stopCamera();
    state.sourceCanvas = null;
    state.landmarks = null;
    state.baseAge = null;
    els.cameraBox.hidden = true;
    const askCard = document.querySelector(".ask-card");
    if (askCard) askCard.hidden = false;
    els.fileInput.value = "";
    els.ageDock.hidden = true;
    els.btnAgain.hidden = true;
    els.manualAge.hidden = true;
    els.ageAnnounce.hidden = false;
    setProgress(0, "Preparando");
    show("ask");
  }

  els.btnCamera.addEventListener("click", function () {
    startCamera();
  });

  els.btnShoot.addEventListener("click", function () {
    if (!els.video.videoWidth) return;
    const frame = grabCameraFrame();
    stopCamera();
    els.cameraBox.hidden = true;
    processImage(frame);
  });

  els.fileInput.addEventListener("change", async function () {
    const file = els.fileInput.files && els.fileInput.files[0];
    if (!file) return;
    try {
      const canvas = await loadFileToCanvas(file);
      stopCamera();
      els.cameraBox.hidden = true;
      await processImage(canvas);
    } catch (err) {
      console.error(err);
      alert("No se pudo abrir esa imagen.");
    }
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

  els.ageSlider.addEventListener("input", function () {
    renderAge(parseInt(els.ageSlider.value, 10));
  });

  window.addEventListener("resize", function () {
    if (state.sourceCanvas && state.baseAge != null) {
      renderAge(parseInt(els.ageSlider.value, 10) || state.baseAge);
    }
  });

  show("ask");
})();
