import fs from "node:fs";
import fsPromises from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = __dirname;
const PORT = Number(process.env.PORT || 4173);

const API_BASE_URL = "https://ssd-api.jpl.nasa.gov/sbdb_query.api";
const OBJECT_API_BASE_URL = "https://ssd-api.jpl.nasa.gov/sbdb.api";
const API_FIELDS = [
  "spkid",
  "full_name",
  "pdes",
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

const CATALOG_DIR = path.join(ROOT_DIR, "data", "catalog");
const CATALOG_MANIFEST_PATH = path.join(CATALOG_DIR, "manifest.json");

const SAMPLE_OBJECTS = 50_000;
const BACKGROUND_UPDATE_SAMPLE = 5_000;
const BACKGROUND_UPDATE_INTERVAL_MS = 15 * 60 * 1000;
const OVERLAY_MAX_OBJECTS = 25_000;
const DEFAULT_OBJECT_COUNT_ESTIMATE = 1_350_000;
const FETCH_TIMEOUT_MS = 45_000;
const MAX_FETCH_RETRIES = 2;
const CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_RESULT_LIMIT = 40;
const SEARCH_QUERY_MAX_LEN = 80;

let cacheEntry = null;
let localCatalogManifest = null;
let lastAvailableCountEstimate = DEFAULT_OBJECT_COUNT_ESTIMATE;
let overlayUpdatesById = new Map();
let isOverlayRefreshInFlight = false;
let backgroundTimer = null;

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
      await handleMainBeltApi(res);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/search") {
      await handleSearchApi(requestUrl, res);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/stats") {
      await handleStatsApi(res);
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
  void initializeCatalogLayer();
});

async function initializeCatalogLayer() {
  const loaded = await ensureCatalogLayerReady();
  if (!loaded) {
    console.log("No local catalog manifest detected. Using direct API sampling mode.");
  }
}

async function ensureCatalogLayerReady() {
  if (localCatalogManifest) {
    return true;
  }

  const manifest = await loadLocalCatalogManifest();
  if (!manifest) {
    return false;
  }

  localCatalogManifest = manifest;
  console.log(
    `Loaded local catalog manifest: ${localCatalogManifest.totalCount} objects, ` +
      `${localCatalogManifest.chunkFiles.length} chunks.`
  );
  startBackgroundOverlayRefreshLoop();
  return true;
}

function startBackgroundOverlayRefreshLoop() {
  if (backgroundTimer) {
    clearInterval(backgroundTimer);
  }
  setTimeout(() => {
    void refreshOverlayFromApi();
  }, 7_000);

  backgroundTimer = setInterval(() => {
    void refreshOverlayFromApi();
  }, BACKGROUND_UPDATE_INTERVAL_MS);
}

async function refreshOverlayFromApi() {
  if (isOverlayRefreshInFlight) {
    return;
  }
  isOverlayRefreshInFlight = true;

  try {
    const payload = await fetchMainBeltFromJpl(BACKGROUND_UPDATE_SAMPLE);
    upsertOverlay(payload.asteroids);
    cacheEntry = null;
  } catch (error) {
    console.warn(`Background overlay refresh failed: ${error.message}`);
  } finally {
    isOverlayRefreshInFlight = false;
  }
}

function upsertOverlay(records) {
  for (const record of records) {
    if (!record?.id) {
      continue;
    }
    if (overlayUpdatesById.has(record.id)) {
      overlayUpdatesById.delete(record.id);
    }
    overlayUpdatesById.set(record.id, record);
    while (overlayUpdatesById.size > OVERLAY_MAX_OBJECTS) {
      const oldestKey = overlayUpdatesById.keys().next().value;
      overlayUpdatesById.delete(oldestKey);
    }
  }
}

async function handleMainBeltApi(res) {
  await ensureCatalogLayerReady();
  const now = Date.now();
  if (cacheEntry && now - cacheEntry.cachedAt < CACHE_TTL_MS) {
    sendJson(res, 200, cacheEntry.payload, {
      "Cache-Control": "public, max-age=60"
    });
    return;
  }

  try {
    const payload = localCatalogManifest
      ? await fetchMainBeltFromLocalCatalog()
      : await fetchMainBeltFromJpl(SAMPLE_OBJECTS);

    cacheEntry = { cachedAt: now, payload };
    sendJson(res, 200, payload, {
      "Cache-Control": "public, max-age=60"
    });
  } catch (error) {
    try {
      const fallback = await readFallbackDataset();
      fallback.meta = {
        ...fallback.meta,
        source: `${fallback.meta?.source || "local-fallback"} (upstream unavailable)`,
        warning: "Live JPL API unavailable. Serving fallback snapshot."
      };
      sendJson(res, 200, fallback, {
        "Cache-Control": "no-store"
      });
    } catch {
      sendJson(res, 502, {
        error: "Failed to load asteroid data.",
        detail: error.message
      });
    }
  }
}

async function fetchMainBeltFromLocalCatalog() {
  if (!localCatalogManifest || !Array.isArray(localCatalogManifest.chunkFiles) || !localCatalogManifest.chunkFiles.length) {
    throw new Error("Local catalog manifest is unavailable.");
  }

  const chunkFile = localCatalogManifest.chunkFiles[randomIntInclusive(0, localCatalogManifest.chunkFiles.length - 1)];
  const chunkPath = path.join(CATALOG_DIR, "chunks", chunkFile);
  const chunkPayload = JSON.parse(await fsPromises.readFile(chunkPath, "utf8"));
  const chunkObjects = Array.isArray(chunkPayload.asteroids) ? chunkPayload.asteroids : [];
  if (!chunkObjects.length) {
    throw new Error(`Selected catalog chunk is empty: ${chunkFile}`);
  }

  const overlayObjects = Array.from(overlayUpdatesById.values());
  const merged = dedupeById([...chunkObjects, ...overlayObjects]);
  const sampled = merged.length > SAMPLE_OBJECTS ? randomSampleArray(merged, SAMPLE_OBJECTS) : merged;

  return {
    meta: {
      source: "Local catalog snapshot + live API overlay",
      fetchedAt: new Date().toISOString(),
      loadedCount: sampled.length,
      availableCount: Number(localCatalogManifest.totalCount) || null,
      sampleMode: "local-chunk",
      sampleChunk: chunkFile,
      overlayCount: overlayObjects.length,
      catalogGeneratedAt: localCatalogManifest.generatedAt
    },
    asteroids: sampled
  };
}

async function fetchMainBeltFromJpl(sampleSize) {
  const initialMaxOffset = Math.max(0, lastAvailableCountEstimate - sampleSize);
  let sampleOffset = randomIntInclusive(0, initialMaxOffset);
  let payload = await fetchJsonWithRetries(buildJplRequestUrl(sampleSize, sampleOffset), FETCH_TIMEOUT_MS, MAX_FETCH_RETRIES);

  let fields = Array.isArray(payload.fields) ? payload.fields : [];
  let rows = Array.isArray(payload.data) ? payload.data : [];
  let fieldIndex = createFieldIndex(fields);
  let availableCount = Number.isFinite(Number(payload.count)) ? Number(payload.count) : null;

  if (Number.isFinite(availableCount)) {
    lastAvailableCountEstimate = availableCount;
  }

  if (!rows.length && Number.isFinite(availableCount) && sampleOffset > 0) {
    sampleOffset = Math.max(0, availableCount - sampleSize);
    payload = await fetchJsonWithRetries(buildJplRequestUrl(sampleSize, sampleOffset), FETCH_TIMEOUT_MS, MAX_FETCH_RETRIES);
    fields = Array.isArray(payload.fields) ? payload.fields : [];
    rows = Array.isArray(payload.data) ? payload.data : [];
    fieldIndex = createFieldIndex(fields);
    availableCount = Number.isFinite(Number(payload.count)) ? Number(payload.count) : availableCount;
    if (Number.isFinite(availableCount)) {
      lastAvailableCountEstimate = availableCount;
    }
  }

  const asteroids = dedupeById(rows.map((row) => mapRowToAsteroid(row, fieldIndex)).filter(Boolean));
  return {
    meta: {
      source: "NASA/JPL SBDB Query API",
      fetchedAt: new Date().toISOString(),
      loadedCount: asteroids.length,
      availableCount,
      sampleMode: "random-window-api",
      sampleOffset
    },
    asteroids
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

async function handleSearchApi(requestUrl, res) {
  await ensureCatalogLayerReady();
  const rawQuery = (requestUrl.searchParams.get("q") ?? "").trim();
  const query = rawQuery.slice(0, SEARCH_QUERY_MAX_LEN);
  const limit = clampInt(requestUrl.searchParams.get("limit"), 1, SEARCH_RESULT_LIMIT, 20);

  if (!query) {
    sendJson(res, 200, {
      meta: { source: "Local/API search", query, loadedCount: 0, availableCount: null },
      asteroids: []
    });
    return;
  }

  try {
    const localMatches = await searchLocalCatalog(query, limit);
    if (localMatches.length > 0) {
      sendJson(res, 200, {
        meta: {
          source: "Local catalog search index",
          query,
          loadedCount: localMatches.length,
          availableCount: null
        },
        asteroids: localMatches
      }, {
        "Cache-Control": "no-store"
      });
      return;
    }

    const pdesValues = await resolveQueryToPdes(query, limit);
    if (!pdesValues.length) {
      sendJson(res, 200, {
        meta: { source: "NASA/JPL SBDB Search API", query, loadedCount: 0, availableCount: null },
        asteroids: []
      });
      return;
    }

    const payload = await fetchAsteroidsByPdes(pdesValues);
    payload.meta = {
      ...payload.meta,
      source: "NASA/JPL SBDB Query API (search fallback)",
      query
    };
    upsertOverlay(payload.asteroids);
    sendJson(res, 200, payload, {
      "Cache-Control": "no-store"
    });
  } catch (error) {
    sendJson(res, 502, {
      error: "Search request failed.",
      detail: error.message
    });
  }
}

async function searchLocalCatalog(query, limit) {
  if (!localCatalogManifest) {
    return [];
  }

  const searchIndexFile = localCatalogManifest.searchIndexFile || "search-index.ndjson";
  const searchIndexPath = path.join(CATALOG_DIR, searchIndexFile);
  if (!(await fileExists(searchIndexPath))) {
    return [];
  }

  const queryLower = query.toLowerCase();
  const matches = [];

  const stream = fs.createReadStream(searchIndexPath, { encoding: "utf8" });
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  try {
    for await (const line of reader) {
      if (!line) {
        continue;
      }
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }

      if (matchesQuery(record, queryLower)) {
        matches.push(record);
      }
      if (matches.length >= limit) {
        break;
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  if (!matches.length) {
    return [];
  }
  return loadLocalCatalogMatches(matches);
}

function matchesQuery(record, queryLower) {
  const id = String(record.id ?? "").toLowerCase();
  const nameLower = String(record.nameLower ?? "");
  const pdesLower = String(record.pdesLower ?? "");
  return id.includes(queryLower) || nameLower.includes(queryLower) || pdesLower.includes(queryLower);
}

async function loadLocalCatalogMatches(matches) {
  const grouped = new Map();
  for (const match of matches) {
    if (!match.chunk || !Number.isFinite(match.row)) {
      continue;
    }
    if (!grouped.has(match.chunk)) {
      grouped.set(match.chunk, []);
    }
    grouped.get(match.chunk).push(match.row);
  }

  const outputById = new Map();
  for (const [chunkFile, rowIndexes] of grouped.entries()) {
    const chunkPath = path.join(CATALOG_DIR, "chunks", chunkFile);
    if (!(await fileExists(chunkPath))) {
      continue;
    }
    const chunkPayload = JSON.parse(await fsPromises.readFile(chunkPath, "utf8"));
    const rows = Array.isArray(chunkPayload.asteroids) ? chunkPayload.asteroids : [];
    for (const rowIndex of rowIndexes) {
      const row = rows[rowIndex];
      if (row?.id) {
        outputById.set(row.id, row);
      }
    }
  }

  return Array.from(outputById.values());
}

async function resolveQueryToPdes(query, limit) {
  const url = `${OBJECT_API_BASE_URL}?${new URLSearchParams({ sstr: query }).toString()}`;
  const payload = await fetchJsonWithRetries(url, FETCH_TIMEOUT_MS, MAX_FETCH_RETRIES);
  const output = new Set();

  if (payload?.object) {
    const candidate = sanitizeConstraintValue(payload.object.pdes ?? payload.object.des);
    if (candidate) {
      output.add(candidate);
    }
  }

  if (Array.isArray(payload?.list)) {
    for (const item of payload.list) {
      const candidate = sanitizeConstraintValue(item?.pdes);
      if (candidate) {
        output.add(candidate);
      }
      if (output.size >= limit) {
        break;
      }
    }
  }

  return Array.from(output).slice(0, limit);
}

async function fetchAsteroidsByPdes(pdesValues) {
  const safePdes = pdesValues
    .map((value) => sanitizeConstraintValue(value))
    .filter(Boolean)
    .slice(0, SEARCH_RESULT_LIMIT);

  if (!safePdes.length) {
    return {
      meta: {
        fetchedAt: new Date().toISOString(),
        loadedCount: 0,
        availableCount: null
      },
      asteroids: []
    };
  }

  const cdata = JSON.stringify({ OR: safePdes.map((value) => `pdes|EQ|${value}`) });
  const params = new URLSearchParams({
    fields: API_FIELDS.join(","),
    "sb-kind": "a",
    "sb-class": "MBA",
    "full-prec": "1",
    "sb-cdata": cdata,
    limit: String(safePdes.length)
  });
  const payload = await fetchJsonWithRetries(`${API_BASE_URL}?${params.toString()}`, FETCH_TIMEOUT_MS, MAX_FETCH_RETRIES);

  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const fieldIndex = createFieldIndex(fields);
  const asteroids = dedupeById(rows.map((row) => mapRowToAsteroid(row, fieldIndex)).filter(Boolean));

  return {
    meta: {
      fetchedAt: new Date().toISOString(),
      loadedCount: asteroids.length,
      availableCount: null
    },
    asteroids
  };
}

async function handleStatsApi(res) {
  await ensureCatalogLayerReady();
  if (!localCatalogManifest) {
    sendJson(res, 404, { error: "No local precomputed stats available." });
    return;
  }

  const statsFile = localCatalogManifest.statsFile || "precomputed-stats.json";
  const statsPath = path.join(CATALOG_DIR, statsFile);
  if (!(await fileExists(statsPath))) {
    sendJson(res, 404, { error: "Precomputed stats file not found." });
    return;
  }

  const statsPayload = JSON.parse(await fsPromises.readFile(statsPath, "utf8"));
  sendJson(res, 200, statsPayload, {
    "Cache-Control": "public, max-age=300"
  });
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

async function fetchJsonWithRetries(url, timeoutMs, maxRetries) {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fetchJsonWithTimeout(url, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries) {
        break;
      }
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastError ?? new Error("Unknown fetch failure.");
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
    primaryDesignation: sanitizeText(pickField(row, fieldIndex, "pdes")),
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

function sanitizeText(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const cleaned = String(value).trim();
  return cleaned || null;
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

function randomSampleArray(items, targetSize) {
  if (items.length <= targetSize) {
    return items;
  }
  const step = items.length / targetSize;
  const output = [];
  for (let index = 0; index < targetSize; index += 1) {
    output.push(items[Math.floor(index * step)]);
  }
  return output;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readFallbackDataset() {
  const fallbackPath = path.join(ROOT_DIR, "data", "main-belt-fallback.json");
  return JSON.parse(await fsPromises.readFile(fallbackPath, "utf8"));
}

async function loadLocalCatalogManifest() {
  if (!(await fileExists(CATALOG_MANIFEST_PATH))) {
    return null;
  }

  try {
    const manifest = JSON.parse(await fsPromises.readFile(CATALOG_MANIFEST_PATH, "utf8"));
    if (!Array.isArray(manifest.chunkFiles) || !manifest.chunkFiles.length) {
      return null;
    }
    return manifest;
  } catch (error) {
    console.warn(`Failed to parse catalog manifest: ${error.message}`);
    return null;
  }
}

async function fileExists(filePath) {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
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
    content = await fsPromises.readFile(filePath);
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

function randomIntInclusive(min, max) {
  if (max <= min) {
    return min;
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clampInt(rawValue, min, max, fallback) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function sanitizeConstraintValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const cleaned = String(value).replace(/[|"]/g, "").trim();
  return cleaned || null;
}
