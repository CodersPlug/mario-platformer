import { getAtlasKey, MODEL } from "../lib/atlas.mjs";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end("method not allowed");
    return;
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      ok: true,
      atlas: !!getAtlasKey(),
      model: MODEL,
      build: "futura-atlas",
    })
  );
}
