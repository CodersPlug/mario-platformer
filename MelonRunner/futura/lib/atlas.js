/** Shared Atlas Nano Banana re-age helpers (server + serverless). */

export const MODEL = "google/nano-banana-2-lite/edit";
export const ATLAS_GENERATE =
  "https://api.atlascloud.ai/api/v1/model/generateImage";

const ALLOWED_HOSTS = new Set([
  "codersplug.github.io",
  "cuando-sea-vieja.apps.grok.bot",
  "localhost",
  "127.0.0.1",
]);

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function agePrompt(sourceAge, targetAge) {
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

export function getAtlasKey() {
  return process.env.ATLAS_API_KEY || process.env.ATLASCLOUD_API_KEY || "";
}

/**
 * Re-age via Atlas. Image must be a data:image/… URI so the source
 * is never stored on Atlas uploadMedia.
 */
export async function atlasReage(imageDataUrl, sourceAge, targetAge) {
  const key = getAtlasKey();
  if (!key) {
    const err = new Error("ATLAS_API_KEY missing");
    err.status = 503;
    throw err;
  }
  if (
    typeof imageDataUrl !== "string" ||
    !imageDataUrl.startsWith("data:image/")
  ) {
    const err = new Error("image data URL required");
    err.status = 400;
    throw err;
  }
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
    const err = new Error("Atlas non-JSON response");
    err.status = 502;
    throw err;
  }
  if (!res.ok || (data.code && data.code !== 200 && data.code !== 0)) {
    const err = new Error(
      data.message || data.msg || data.data?.error || "Atlas error " + res.status
    );
    err.status = res.status || 502;
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

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12;
const DAY_MS = 86_400_000;
const DAY_MAX = 80;
const rateMap = new Map();
const dayMap = new Map();

export function allowRequest(ip) {
  const now = Date.now();
  const id = ip || "unknown";
  let bucket = rateMap.get(id);
  if (!bucket || now - bucket.t0 > RATE_WINDOW_MS) {
    bucket = { t0: now, n: 0 };
    rateMap.set(id, bucket);
  }
  bucket.n += 1;
  if (bucket.n > RATE_MAX) return false;

  let day = dayMap.get(id);
  if (!day || now - day.t0 > DAY_MS) {
    day = { t0: now, n: 0 };
    dayMap.set(id, day);
  }
  day.n += 1;
  return day.n <= DAY_MAX;
}

/** Prefer platform-set client IP; ignore spoofable first XFF hop when possible. */
export function clientIp(req) {
  const h = req.headers || {};
  const get = (k) => {
    if (typeof h.get === "function") return h.get(k);
    return h[k] || h[k.toLowerCase()];
  };
  const real =
    get("x-real-ip") ||
    get("cf-connecting-ip") ||
    get("true-client-ip") ||
    get("x-vercel-forwarded-for");
  if (typeof real === "string" && real.trim()) {
    return real.split(",")[0].trim();
  }
  const xf = get("x-forwarded-for");
  if (typeof xf === "string" && xf.length) {
    const parts = xf.split(",").map((s) => s.trim()).filter(Boolean);
    // Prefer the rightmost public-looking hop (set by trusted proxy).
    return parts[parts.length - 1] || "unknown";
  }
  return req.socket?.remoteAddress || "unknown";
}

/** Strict allowlist for CORS (GitHub Pages host + this app + local). */
export function isAllowedOrigin(origin) {
  if (!origin) return true; // same-origin / non-browser
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}
