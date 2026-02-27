import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = __dirname;
const PORT = Number(process.env.PORT || 4173);

const API_BASE_URL = "https://ssd-api.jpl.nasa.gov/sbdb_query.api";
const API_FIELDS = [
  "spkid",
  "full_name",
  "class",
  "a",
  "e",
  "i",
  "om",
  "w",
  "ma",
  "diameter",
  "albedo",
  "H",
  "epoch"
];
const PAGE_SIZE = 200;
const MAX_OBJECTS = 1200;
const FETCH_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 10 * 60 * 1000;

let cacheEntry = null;

const mimeByExt = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
});

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && requestUrl.pathname === "/healthz") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/main-belt") {
      await handleMainBeltApi(req, res);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "Method not allowed." });
      return;
    }

    await serveStatic(requestUrl.pathname, req.method, res);
  } catch (error) {
    sendJson(res, 500, { error: "Internal server error.", detail: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Asteroid Explorer server running on http://localhost:${PORT}`);
});

async function handleMainBeltApi(_req, res) {
  const now = Date.now();
  if (cacheEntry && now - cacheEntry.cachedAt < CACHE_TTL_MS) {
    sendJson(res, 200, cacheEntry.payload, {
      "Cache-Control": "public, max-age=60"
    });
    return;
  }

  try {
    const payload = await fetchMainBeltFromJpl();
    cacheEntry = { cachedAt: now, payload };
    sendJson(res, 200, payload, {
      "Cache-Control": "public, max-age=60"
    });
  } catch (error) {
    const fallback = await readFallbackDataset();
    fallback.meta = {
      ...fallback.meta,
      source: `${fallback.meta?.source || "local-fallback"} (upstream unavailable)`,
      warning: "Live JPL API unavailable. Serving local fallback snapshot."
    };
    sendJson(res, 200, fallback, {
      "Cache-Control": "no-store"
    });
  }
}

async function fetchMainBeltFromJpl() {
  const records = [];
  let offset = 0;
  let availableCount = null;

  while (records.length < MAX_OBJECTS) {
    const limit = Math.min(PAGE_SIZE, MAX_OBJECTS - records.length);
    const requestUrl = buildJplRequestUrl(limit, offset);
    const payload = await fetchJsonWithTimeout(requestUrl, FETCH_TIMEOUT_MS);

    const fields = Array.isArray(payload.fields) ? payload.fields : [];
    const rows = Array.isArray(payload.data) ? payload.data : [];
    const fieldIndex = createFieldIndex(fields);

    if (Number.isFinite(Number(payload.count))) {
      availableCount = Number(payload.count);
    }

    if (!rows.length) {
      break;
    }

    for (const row of rows) {
      const mapped = mapRowToAsteroid(row, fieldIndex);
      if (mapped) {
        records.push(mapped);
      }
    }

    offset += rows.length;
    if (availableCount !== null && offset >= availableCount) {
      break;
    }
    if (rows.length < limit) {
      break;
    }
  }

  const deduped = dedupeById(records);
  return {
    meta: {
      source: "NASA/JPL SBDB Query API",
      fetchedAt: new Date().toISOString(),
      loadedCount: deduped.length,
      availableCount
    },
    asteroids: deduped
  };
}

function buildJplRequestUrl(limit, offset) {
  const params = new URLSearchParams({
    fields: API_FIELDS.join(","),
    "sb-kind": "a",
    "sb-class": "MBA",
    "full-prec": "1",
    limit: String(limit),
    "limit-from": String(offset)
  });
  return `${API_BASE_URL}?${params.toString()}`;
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Upstream request failed with status ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function createFieldIndex(fields) {
  const output = {};
  fields.forEach((field, index) => {
    output[field] = index;
  });
  return output;
}

function mapRowToAsteroid(row, fieldIndex) {
  const id = pickField(row, fieldIndex, "spkid");
  const name = pickField(row, fieldIndex, "full_name");
  const a = toNumber(pickField(row, fieldIndex, "a"));
  const e = toNumber(pickField(row, fieldIndex, "e"));
  const i = toNumber(pickField(row, fieldIndex, "i"));

  if (!id || !name || !Number.isFinite(a) || !Number.isFinite(e) || !Number.isFinite(i)) {
    return null;
  }

  return {
    id: String(id),
    name: String(name).trim(),
    classCode: String(pickField(row, fieldIndex, "class") ?? "Unknown"),
    zone: classifyBeltZone(a),
    a,
    e,
    i,
    om: toNumber(pickField(row, fieldIndex, "om")),
    w: toNumber(pickField(row, fieldIndex, "w")),
    ma: toNumber(pickField(row, fieldIndex, "ma")),
    diameterKm: toNumber(pickField(row, fieldIndex, "diameter")),
    albedo: toNumber(pickField(row, fieldIndex, "albedo")),
    absoluteMagnitudeH: toNumber(pickField(row, fieldIndex, "H")),
    epochMjd: toNumber(pickField(row, fieldIndex, "epoch")),
    orbitalPeriodYears: periodYearsFromSemiMajorAxis(a)
  };
}

function pickField(row, fieldIndex, name) {
  const index = fieldIndex[name];
  if (index === undefined || !Array.isArray(row)) {
    return null;
  }
  return row[index];
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function periodYearsFromSemiMajorAxis(a) {
  if (!Number.isFinite(a) || a <= 0) {
    return null;
  }
  return Math.sqrt(a ** 3);
}

function classifyBeltZone(a) {
  if (!Number.isFinite(a)) {
    return "Unknown";
  }
  if (a < 2.5) {
    return "Inner Belt";
  }
  if (a < 2.82) {
    return "Middle Belt";
  }
  return "Outer Belt";
}

function dedupeById(records) {
  const byId = new Map();
  for (const record of records) {
    byId.set(record.id, record);
  }
  return Array.from(byId.values());
}

async function readFallbackDataset() {
  const fallbackPath = path.join(ROOT_DIR, "data", "main-belt-fallback.json");
  const text = await fs.readFile(fallbackPath, "utf8");
  return JSON.parse(text);
}

async function serveStatic(urlPathname, method, res) {
  const normalized = sanitizePathname(urlPathname);
  const candidate = normalized === "/" ? "/index.html" : normalized;
  const relativeCandidate = candidate.replace(/^\/+/, "");
  const filePath = path.join(ROOT_DIR, relativeCandidate);

  if (!filePath.startsWith(ROOT_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  let content;
  try {
    content = await fs.readFile(filePath);
  } catch {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeByExt[ext] || "application/octet-stream";

  res.writeHead(200, buildSecurityHeaders({ "Content-Type": contentType }));
  if (method === "HEAD") {
    res.end();
    return;
  }
  res.end(content);
}

function sanitizePathname(pathname) {
  const decoded = decodeURIComponent(pathname || "/");
  const normalized = path.posix.normalize(decoded);
  if (!normalized.startsWith("/")) {
    return `/${normalized}`;
  }
  return normalized;
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(
    statusCode,
    buildSecurityHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body).toString(),
      ...extraHeaders
    })
  );
  res.end(body);
}

function buildSecurityHeaders(additionalHeaders) {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    ...additionalHeaders
  };
}
