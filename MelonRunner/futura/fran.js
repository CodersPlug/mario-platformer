/* FRAN face re-aging (ONNX) — Disney-style U-Net delta, MIT via timroelofs123 / FaceStudio */
(function (global) {
  "use strict";

  const FRAN_URL = "https://georgegach.github.io/facestudio/models/fran.onnx";
  const ORT_WASM =
    "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";
  const MASK_URL = "assets/mask512.jpg";
  const WIN = 512;

  let sessionPromise = null;
  let maskPromise = null;

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }
  function clamp01(x) {
    return clamp(x, 0, 1);
  }

  async function getSession(onProg) {
    if (sessionPromise) return sessionPromise;
    sessionPromise = (async function () {
      if (typeof ort === "undefined") throw new Error("ort missing");
      ort.env.wasm.wasmPaths = ORT_WASM;
      ort.env.wasm.numThreads = 1;
      if (onProg) onProg(0.05);
      const res = await fetch(FRAN_URL);
      if (!res.ok) throw new Error("fran download " + res.status);
      const total = Number(res.headers.get("content-length") || 0);
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (onProg && total) onProg(0.05 + 0.7 * (received / total));
      }
      const bytes = new Uint8Array(received);
      let off = 0;
      for (let i = 0; i < chunks.length; i++) {
        bytes.set(chunks[i], off);
        off += chunks[i].length;
      }
      if (onProg) onProg(0.8);
      // WASM is the reliable path; WebGPU has been flaky with this U-Net on some devices
      const session = await ort.InferenceSession.create(bytes.buffer, {
        executionProviders: ["wasm"],
      });
      if (onProg) onProg(1);
      return session;
    })().catch(function (err) {
      sessionPromise = null;
      throw err;
    });
    return sessionPromise;
  }

  function getMask() {
    if (maskPromise) return maskPromise;
    maskPromise = new Promise(function (resolve) {
      const img = new Image();
      img.decoding = "async";
      img.onload = function () {
        const c = document.createElement("canvas");
        c.width = WIN;
        c.height = WIN;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, WIN, WIN);
        const px = ctx.getImageData(0, 0, WIN, WIN).data;
        const m = new Float32Array(WIN * WIN);
        for (let i = 0; i < m.length; i++) {
          m[i] = px[i * 4] / 255;
        }
        resolve(m);
      };
      img.onerror = function () {
        const m = new Float32Array(WIN * WIN);
        const cx = WIN * 0.5;
        const cy = WIN * 0.42;
        const rx = WIN * 0.48;
        const ry = WIN * 0.55;
        for (let y = 0; y < WIN; y++) {
          for (let x = 0; x < WIN; x++) {
            const nx = (x - cx) / rx;
            const ny = (y - cy) / ry;
            const r = Math.sqrt(nx * nx + ny * ny);
            let a = r >= 1 ? 0 : r <= 0.55 ? 1 : 1 - (r - 0.55) / 0.45;
            a = a * a * (3 - 2 * a);
            m[y * WIN + x] = a;
          }
        }
        resolve(m);
      };
      img.src = MASK_URL;
    });
    return maskPromise;
  }

  function squareCropBox(box, imgW, imgH) {
    let x0 = box.x - box.width * 0.42;
    let x1 = box.x + box.width * 1.42;
    let y0 = box.y - box.height * 0.7;
    let y1 = box.y + box.height * 1.35;
    const cw = x1 - x0;
    const ch = y1 - y0;
    if (cw > ch) {
      const pad = (cw - ch) / 2;
      y0 -= pad;
      y1 += pad;
    } else {
      const pad = (ch - cw) / 2;
      x0 -= pad;
      x1 += pad;
    }
    x0 = Math.max(0, Math.round(x0));
    y0 = Math.max(0, Math.round(y0));
    x1 = Math.min(imgW, Math.round(x1));
    y1 = Math.min(imgH, Math.round(y1));
    return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, h: y1 - y0 };
  }

  function sampleDelta(deltaPlane, fx, fy, ch) {
    const x = clamp(fx, 0, WIN - 1.001);
    const y = clamp(fy, 0, WIN - 1.001);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(WIN - 1, x0 + 1);
    const y1 = Math.min(WIN - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const base = ch * WIN * WIN;
    return (
      deltaPlane[base + y0 * WIN + x0] * (1 - tx) * (1 - ty) +
      deltaPlane[base + y0 * WIN + x1] * tx * (1 - ty) +
      deltaPlane[base + y1 * WIN + x0] * (1 - tx) * ty +
      deltaPlane[base + y1 * WIN + x1] * tx * ty
    );
  }

  function sampleMask(mask, fx, fy) {
    const x = clamp(fx, 0, WIN - 1.001);
    const y = clamp(fy, 0, WIN - 1.001);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(WIN - 1, x0 + 1);
    const y1 = Math.min(WIN - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    return (
      mask[y0 * WIN + x0] * (1 - tx) * (1 - ty) +
      mask[y0 * WIN + x1] * tx * (1 - ty) +
      mask[y1 * WIN + x0] * (1 - tx) * ty +
      mask[y1 * WIN + x1] * tx * ty
    );
  }

  function ageStrength(sourceAge, targetAge) {
    const gap = Math.abs(targetAge - sourceAge);
    // Near-native FRAN + modest boost so kids notice big jumps
    return 1.0 + clamp(gap / 80, 0, 1) * 0.55;
  }

  function mvHair(y, h) {
    // 1 at top of crop → 0 around mid-forehead
    return clamp01((0.36 * h - y) / (0.36 * h));
  }

  /**
   * Re-age the largest face in `sourceCanvas`.
   * Single 512 FRAN pass (iPad-friendly) + official face mask, delta added
   * onto original native pixels so wrinkles stay sharp.
   */
  async function reageFace(sourceCanvas, faceBox, sourceAge, targetAge, onProg) {
    const session = await getSession(onProg);
    const mask = await getMask();
    const W = sourceCanvas.width;
    const H = sourceCanvas.height;
    const crop = squareCropBox(faceBox, W, H);
    if (crop.w < 32 || crop.h < 32) throw new Error("face too small");

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = WIN;
    cropCanvas.height = WIN;
    const cctx = cropCanvas.getContext("2d", { willReadFrequently: true });
    cctx.drawImage(
      sourceCanvas,
      crop.x0,
      crop.y0,
      crop.w,
      crop.h,
      0,
      0,
      WIN,
      WIN
    );
    const cropPx = cctx.getImageData(0, 0, WIN, WIN).data;

    const plane = WIN * WIN;
    const input = new Float32Array(5 * plane);
    for (let i = 0; i < plane; i++) {
      input[i] = cropPx[i * 4] / 255;
      input[plane + i] = cropPx[i * 4 + 1] / 255;
      input[2 * plane + i] = cropPx[i * 4 + 2] / 255;
    }
    input.fill(clamp01(sourceAge / 100), 3 * plane, 4 * plane);
    input.fill(clamp01(targetAge / 100), 4 * plane, 5 * plane);

    const tensor = new ort.Tensor("float32", input, [1, 5, WIN, WIN]);
    const outputs = await session.run({ [session.inputNames[0]]: tensor });
    const delta = outputs[session.outputNames[0]].data;
    const strength = ageStrength(sourceAge, targetAge);

    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const octx = out.getContext("2d", { willReadFrequently: true });
    octx.drawImage(sourceCanvas, 0, 0);
    const img = octx.getImageData(0, 0, W, H);
    const d = img.data;
    const sx = WIN / crop.w;
    const sy = WIN / crop.h;

    const older = targetAge > sourceAge + 15;
    const oldAmt = older
      ? clamp((targetAge - Math.max(sourceAge, 25)) / 55, 0, 1)
      : 0;

    for (let y = 0; y < crop.h; y++) {
      const iy = crop.y0 + y;
      const fy = (y + 0.5) * sy - 0.5;
      // Soft silvering in the upper crop reads clearly as "vieja" for kids
      const hairW =
        oldAmt * mvHair(y, crop.h) ;
      for (let x = 0; x < crop.w; x++) {
        const fx = (x + 0.5) * sx - 0.5;
        const mv = sampleMask(mask, fx, fy);
        if (mv <= 0.02 && hairW <= 0) continue;
        const j = (iy * W + (crop.x0 + x)) * 4;
        const a = mv * strength;
        let r = d[j] + sampleDelta(delta, fx, fy, 0) * 255 * a;
        let g = d[j + 1] + sampleDelta(delta, fx, fy, 1) * 255 * a;
        let b = d[j + 2] + sampleDelta(delta, fx, fy, 2) * 255 * a;
        if (hairW > 0 && mv > 0.05) {
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          const lite = Math.min(255, gray + 35);
          const hw = hairW * mv * 0.55;
          r = r * (1 - hw) + lite * hw;
          g = g * (1 - hw) + lite * hw;
          b = b * (1 - hw) + lite * hw;
        }
        d[j] = r < 0 ? 0 : r > 255 ? 255 : r;
        d[j + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        d[j + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      }
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  global.FuturaFran = {
    getSession: getSession,
    reageFace: reageFace,
    FRAN_URL: FRAN_URL,
  };
})(typeof window !== "undefined" ? window : globalThis);
