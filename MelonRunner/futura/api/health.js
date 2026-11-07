import { getAtlasKey, MODEL } from "../lib/atlas.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET() {
  return json({
    ok: true,
    atlas: !!getAtlasKey(),
    model: MODEL,
    build: "futura-atlas-19",
  });
}

export async function HEAD() {
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}

/** Node/Vercel Pages-style fallback */
export default async function handler(req, res) {
  if (res && typeof res.end === "function") {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.statusCode = 405;
      res.end("method not allowed");
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(
      JSON.stringify({
        ok: true,
        atlas: !!getAtlasKey(),
        model: MODEL,
        build: "futura-atlas-19",
      })
    );
    return;
  }
  // Web Request style (req is Request)
  if (req?.method && req.method !== "GET" && req.method !== "HEAD") {
    return new Response("method not allowed", { status: 405 });
  }
  return GET();
}
