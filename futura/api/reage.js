import {
  atlasReage,
  allowRequest,
  clientIp,
  isAllowedOrigin,
} from "../lib/atlas.js";

function corsHeaders(origin) {
  const h = {
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
  if (origin && isAllowedOrigin(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Vary"] = "Origin";
  }
  return h;
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

async function handleReage(body, origin, ip) {
  if (origin && !isAllowedOrigin(origin)) {
    return json({ error: "origin not allowed" }, 403, origin);
  }
  if (!allowRequest(ip)) {
    return json({ error: "rate limit" }, 429, origin);
  }
  const image = body?.image;
  const sourceAge = Number(body?.sourceAge);
  const targetAge = Number(body?.targetAge);
  if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
    return json({ error: "image data URL required" }, 400, origin);
  }
  if (!Number.isFinite(sourceAge) || !Number.isFinite(targetAge)) {
    return json({ error: "sourceAge/targetAge required" }, 400, origin);
  }
  try {
    const out = await atlasReage(image, sourceAge, targetAge);
    return json({ image: out, sourceStored: false, deleted: true }, 200, origin);
  } catch (err) {
    console.error("reage", err && err.message);
    return json(
      { error: (err && err.message) || "reage failed" },
      err?.status || 500,
      origin
    );
  }
}

export async function OPTIONS(request) {
  const origin = request.headers.get("origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(request) {
  const origin = request.headers.get("origin") || "";
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON" }, 400, origin);
  }
  const ip = clientIp(request);
  return handleReage(body, origin, ip);
}

function readJsonNode(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === "object") {
      resolve(req.body);
      return;
    }
    if (typeof req.body === "string" && req.body) {
      try {
        resolve(JSON.parse(req.body));
      } catch (e) {
        reject(Object.assign(new Error("invalid JSON"), { status: 400 }));
      }
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

/** Node/Vercel Pages-style + Web Request default export */
export default async function handler(req, res) {
  // Web Request (Edge / Cursor host)
  if (!res || typeof res.end !== "function") {
    const request = req;
    const method = request.method || "GET";
    if (method === "OPTIONS") return OPTIONS(request);
    if (method !== "POST") {
      return json({ error: "POST only" }, 405, request.headers?.get?.("origin") || "");
    }
    return POST(request);
  }

  // Node IncomingMessage
  const origin = req.headers.origin || "";
  const headers = corsHeaders(origin);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);

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

  try {
    const body = await readJsonNode(req);
    const ip = clientIp(req);
    const response = await handleReage(body, origin, ip);
    const text = await response.text();
    res.statusCode = response.status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(text);
  } catch (err) {
    console.error("reage", err && err.message);
    res.statusCode = err.status || 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: (err && err.message) || "reage failed" }));
  }
}
