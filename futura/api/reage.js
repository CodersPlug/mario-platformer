import {
  atlasReage,
  allowRequest,
  clientIp,
  isAllowedOrigin,
} from "../lib/atlas.mjs";

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === "object") {
      resolve(req.body);
      return;
    }
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 12_000_000) {
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(Object.assign(new Error("invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "POST only" }));
    return;
  }

  if (origin && !isAllowedOrigin(origin)) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "origin not allowed" }));
    return;
  }

  const ip = clientIp(req);
  if (!allowRequest(ip)) {
    res.statusCode = 429;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "rate limit" }));
    return;
  }

  try {
    const body = await readJson(req);
    const image = body.image;
    const sourceAge = Number(body.sourceAge);
    const targetAge = Number(body.targetAge);
    if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "image data URL required" }));
      return;
    }
    if (!Number.isFinite(sourceAge) || !Number.isFinite(targetAge)) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "sourceAge/targetAge required" }));
      return;
    }
    const out = await atlasReage(image, sourceAge, targetAge);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        image: out,
        sourceStored: false,
        deleted: true,
      })
    );
  } catch (err) {
    console.error("reage", err && err.message);
    res.statusCode = err.status || 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: (err && err.message) || "reage failed" }));
  }
}
