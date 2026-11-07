#!/usr/bin/env node
/**
 * Local-only static + API preview (mirrors Cursor/Vercel /api/* handlers).
 * Not used in production — do not set as package.json "start".
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
  clientIp,
} from "../lib/atlas.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
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

/** Paths that must never be served as static files. */
const BLOCKED_PREFIXES = [
  "/.env",
  "/lib/",
  "/api/",
  "/scripts/",
  "/node_modules/",
  "/.git/",
];
const BLOCKED_EXACT = new Set([
  "/.env",
  "/package.json",
  "/package-lock.json",
  "/vercel.json",
  "/server.mjs",
]);
const BLOCKED_NAMES = new Set([".env", ".gitignore", ".npmrc"]);

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

function isBlockedStatic(urlPath) {
  const lower = urlPath.toLowerCase();
  if (BLOCKED_EXACT.has(lower)) return true;
  if (BLOCKED_PREFIXES.some((p) => lower === p.slice(0, -1) || lower.startsWith(p))) {
    return true;
  }
  const base = path.basename(urlPath).toLowerCase();
  if (BLOCKED_NAMES.has(base)) return true;
  if (base.endsWith(".env") || base.startsWith(".env.")) return true;
  if (base === "local-server.mjs" || base === "server.mjs") return true;
  if (base === "atlas.js" || base === "atlas.mjs") return true;
  return false;
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
  if (isBlockedStatic(urlPath)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, safe);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  fs.stat(filePath, (statErr, st) => {
    if (statErr || !st.isFile()) {
      res.writeHead(404);
      res.end("not found");
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
    sendJson(
      res,
      200,
      {
        ok: true,
        atlas: !!getAtlasKey(),
        model: MODEL,
        build: "futura-atlas-19",
      },
      origin
    );
    return;
  }

  if (req.method === "POST" && url.startsWith("/api/reage")) {
    if (origin && !isAllowedOrigin(origin)) {
      sendJson(res, 403, { error: "origin not allowed" }, origin);
      return;
    }
    const ip = clientIp(req);
    if (!allowRequest(ip)) {
      sendJson(res, 429, { error: "rate limit" }, origin);
      return;
    }
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw.toString("utf8"));
      const out = await atlasReage(
        body.image,
        Number(body.sourceAge),
        Number(body.targetAge)
      );
      sendJson(
        res,
        200,
        { image: out, sourceStored: false, deleted: true },
        origin
      );
    } catch (err) {
      console.error("reage", err.message);
      sendJson(
        res,
        err.status || 500,
        { error: err.message || "reage failed" },
        origin
      );
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

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `Futura local preview http://127.0.0.1:${PORT}  atlas=${getAtlasKey() ? "yes" : "NO KEY"}`
  );
});
