/* FRAN face re-aging (ONNX) — Disney-style U-Net delta, MIT via timroelofs123 / FaceStudio */
(function (global) {
  "use strict";

  const FRAN_URL = "https://georgegach.github.io/facestudio/models/fran.onnx";
  const ORT_WASM =
    "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";
  const WIN = 512;

  let sessionPromise = null;

  function clamp01(x) {
    return Math.max(0, Math.min(1, x));
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
      const providers = [];
      if (typeof navigator !== "undefined" && "gpu" in navigator) {
        providers.push("webgpu");
      }
      providers.push("wasm");
      const session = await ort.InferenceSession.create(bytes.buffer, {
        executionProviders: providers,
      });
      if (onProg) onProg(1);
      return session;
    })().catch(function (err) {
      sessionPromise = null;
      throw err;
    });
    return sessionPromise;
  }

  function squareCropBox(box, imgW, imgH) {
    let x0 = box.x - box.width * 0.35;
    let x1 = box.x + box.width * 1.35;
    let y0 = box.y - box.height * 0.55;
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

  /**
   * Re-age the largest face in `sourceCanvas`.
   * @returns {HTMLCanvasElement} full-frame result
   */
  async function reageFace(sourceCanvas, faceBox, sourceAge, targetAge, onProg) {
    const session = await getSession(onProg);
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

    // Apply delta onto crop
    const agedCrop = document.createElement("canvas");
    agedCrop.width = WIN;
    agedCrop.height = WIN;
    const actx = agedCrop.getContext("2d");
    const img = actx.createImageData(WIN, WIN);
    for (let i = 0; i < plane; i++) {
      for (let c = 0; c < 3; c++) {
        let v = cropPx[i * 4 + c] + delta[c * plane + i] * 255;
        img.data[i * 4 + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      img.data[i * 4 + 3] = 255;
    }
    actx.putImageData(img, 0, 0);

    // Soft circular mask for blending back
    const mask = document.createElement("canvas");
    mask.width = WIN;
    mask.height = WIN;
    const mctx = mask.getContext("2d");
    const g = mctx.createRadialGradient(
      WIN * 0.5,
      WIN * 0.42,
      WIN * 0.22,
      WIN * 0.5,
      WIN * 0.45,
      WIN * 0.48
    );
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.7, "rgba(255,255,255,0.85)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    mctx.fillStyle = g;
    mctx.fillRect(0, 0, WIN, WIN);

    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const octx = out.getContext("2d");
    octx.drawImage(sourceCanvas, 0, 0);

    // Draw aged face with mask into crop region
    const tmp = document.createElement("canvas");
    tmp.width = crop.w;
    tmp.height = crop.h;
    const tctx = tmp.getContext("2d");
    tctx.drawImage(agedCrop, 0, 0, crop.w, crop.h);
    tctx.globalCompositeOperation = "destination-in";
    tctx.drawImage(mask, 0, 0, crop.w, crop.h);

    octx.drawImage(tmp, crop.x0, crop.y0);
    return out;
  }

  global.FuturaFran = {
    getSession: getSession,
    reageFace: reageFace,
    FRAN_URL: FRAN_URL,
  };
})(typeof window !== "undefined" ? window : globalThis);
