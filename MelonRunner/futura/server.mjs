#!/usr/bin/env node
/**
 * Futura local/proxy server.
 * - Serves static files for Cuando sea vieja
 * - POST /api/reage → Atlas Nano Banana 2 Lite (key stays server-side)
 *
 * Source photos are sent as inline data URIs (never uploadMedia), so nothing
 * to delete on Atlas. Request records expire immediately; output media in 1h.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8787);
const ATLAS_GENERATE = "https://api.atlascloud.ai/api/v1/model/generateImage";
const MODEL = "google/nano-banana-2-lite/edit";
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;
const rateMap = new Map();

function allowRequest(ip) {
  const now = Date.now();
  let bucket = rateMap.get(ip);
  if (!bucket || now - bucket.t0 > RATE_WINDOW_MS) {
    bucket = { t0: now, n: 0 };
    rateMap.set(ip, bucket);
  }
  bucket.n += 1;
  return bucket.n <= RATE_MAX;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split(/\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]]) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}
loadDotEnv();

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function agePrompt(sourceAge, targetAge) {
  const src = clamp(Math.round(sourceAge), 1, 100);
  const tgt = clamp(Math.round(targetAge), 1, 100);
  if (tgt === src) {
    return "Return the same photograph unchanged. Keep identity, pose, clothing, and background.";
  }
  if (tgt > src) {
    return (
      `Photorealistic age progression of the same person from about ${src} to about ${tgt} years old. ` +
      `Add natural wrinkles appropriate for age ${tgt}, gray or white hair if elderly, softer jawline, realistic skin texture and age spots. ` +
      `Keep the exact same identity, facial expression, pose, clothing, lighting, and background. ` +
      `Do not change camera angle. Do not stylize. Do not add text or watermarks.`
    );
  }
  return (
    `Photorealistic de-aging of the same person from about ${src} to about ${tgt} years old. ` +
    `Smoother skin, fuller cheeks, darker natural hair color if gray was present, youthful features for age ${tgt}. ` +
    `Keep the exact same identity, facial expression, pose, clothing, lighting, and background. ` +
    `Do not change camera angle. Do not stylize. Do not add text or watermarks.`
  );
}

function readBody(req, limit = 12_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function atlasReage(imageDataUrl, sourceAge, targetAge) {
  const key = process.env.ATLAS_API_KEY || process.env.ATLASCLOUD_API_KEY || "";
  if (!key) {
    const err = new Error("ATLAS_API_KEY missing");
    err.status = 503;
    throw err;
  }
  // Inline data URI — source never uploaded to Atlas storage (nothing to delete).
  const payload = {
    model: MODEL,
    prompt: agePrompt(sourceAge, targetAge),
    images: [imageDataUrl],
    aspect_ratio: "3:4",
    thinking_level: "minimal",
    resolution: "1k",
    temperature: 0.35,
    enable_sync_mode: true,
    enable_base64_output: true,
  };
  const res = await fetch(ATLAS_GENERATE, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      // Shortest allowed retention: drop request record ASAP; expire media in 1h
      "X-AtlasCloud-Object-Expiration-Hours": "1",
      "X-AtlasCloud-Request-Retention-Hours": "0",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const err = new Error("Atlas non-JSON: " + text.slice(0, 200));
    err.status = 502;
    throw err;
  }
  if (!res.ok || (data.code && data.code !== 200 && data.code !== 0)) {
    const err = new Error(
      data.message || data.msg || data.data?.error || "Atlas error " + res.status
    );
    err.status = res.status || 502;
    err.atlas = data;
    throw err;
  }
  const out = data.data?.outputs?.[0];
  if (!out || typeof out !== "string") {
    const err = new Error(data.data?.error || "Atlas returned no image");
    err.status = 502;
    throw err;
  }
  return out;
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, safe);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS for local tooling
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && (req.url || "").startsWith("/api/health")) {
    const key = process.env.ATLAS_API_KEY || process.env.ATLASCLOUD_API_KEY || "";
    sendJson(res, 200, {
      ok: true,
      atlas: !!key,
      model: MODEL,
      build: "futura-atlas",
    });
    return;
  }

  if (req.method === "POST" && (req.url || "").startsWith("/api/reage")) {
    const ip = req.socket.remoteAddress || "unknown";
    if (!allowRequest(ip)) {
      sendJson(res, 429, { error: "rate limit" });
      return;
    }
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw.toString("utf8"));
      const image = body.image;
      const sourceAge = Number(body.sourceAge);
      const targetAge = Number(body.targetAge);
      if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
        sendJson(res, 400, { error: "image data URL required" });
        return;
      }
      if (!Number.isFinite(sourceAge) || !Number.isFinite(targetAge)) {
        sendJson(res, 400, { error: "sourceAge/targetAge required" });
        return;
      }
      const out = await atlasReage(image, sourceAge, targetAge);
      sendJson(res, 200, {
        image: out,
        // Source was never uploaded to Atlas (inline data URI).
        sourceStored: false,
        deleted: true,
      });
    } catch (err) {
      console.error("reage", err.message);
      sendJson(res, err.status || 500, {
        error: err.message || "reage failed",
      });
    }
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res);
    return;
  }
  res.writeHead(405);
  res.end("method not allowed");
});

server.listen(PORT, "0.0.0.0", () => {
  const key = process.env.ATLAS_API_KEY || process.env.ATLASCLOUD_API_KEY || "";
  console.log(
    `Futura+Atlas on http://127.0.0.1:${PORT}  atlas=${key ? "yes" : "NO KEY"}`
  );
});
