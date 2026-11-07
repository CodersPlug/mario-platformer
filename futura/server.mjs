#!/usr/bin/env node
/**
 * Local static + API server (mirrors Vercel /api/* handlers).
 * Production on Cursor Apps uses api/reage.js + api/health.js.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  atlasReage,
  allowRequest,
  getAtlasKey,
  MODEL,
  isAllowedOrigin,
} from "./lib/atlas.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8787);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
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
  for (const line of fs.readFileSync(p, "utf8").split(/\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]]) continue;
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

function sendJson(res, status, obj, origin) {
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  } catch {
    res.writeHead(400);
    res.end("bad path");
    return;
  }
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
  const origin = req.headers.origin || "";
  if (req.method === "OPTIONS") {
    if (origin && isAllowedOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.writeHead(204);
    res.end();
    return;
  }

  const url = (req.url || "").split("?")[0];

  if (req.method === "GET" && url.startsWith("/api/health")) {
    sendJson(res, 200, {
      ok: true,
      atlas: !!getAtlasKey(),
      model: MODEL,
      build: "futura-atlas",
    }, origin);
    return;
  }

  if (req.method === "POST" && url.startsWith("/api/reage")) {
    if (origin && !isAllowedOrigin(origin)) {
      sendJson(res, 403, { error: "origin not allowed" }, origin);
      return;
    }
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";
    if (!allowRequest(ip)) {
      sendJson(res, 429, { error: "rate limit" }, origin);
      return;
    }
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw.toString("utf8"));
      const out = await atlasReage(body.image, Number(body.sourceAge), Number(body.targetAge));
      sendJson(
        res,
        200,
        { image: out, sourceStored: false, deleted: true },
        origin
      );
    } catch (err) {
      console.error("reage", err.message);
      sendJson(res, err.status || 500, { error: err.message || "reage failed" }, origin);
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
  console.log(
    `Futura+Atlas on http://127.0.0.1:${PORT}  atlas=${getAtlasKey() ? "yes" : "NO KEY"}`
  );
});
