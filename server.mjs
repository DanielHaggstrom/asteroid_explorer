import fsPromises from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  API_FIELDS,
  OBJECT_API_BASE_URL,
  buildQueryApiUrl,
  dedupeAsteroids,
  fetchJsonWithRetries,
  mapQueryPayloadToAsteroids,
  sanitizeConstraintValue,
  sanitizeSearchFragment,
  titleCaseWords
} from "./lib/jpl-api.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = __dirname;
const PORT = Number(process.env.PORT || 4173);

const STARTUP_SAMPLE_PATH = path.join(ROOT_DIR, "data", "main-belt-startup.json");

const DEFAULT_STARTUP_SAMPLE_SIZE = 10_000;
const TABLE_PAGE_SIZE_DEFAULT = 25;
const TABLE_PAGE_SIZE_MAX = 100;
const SEARCH_RESULT_LIMIT = 20;
const SEARCH_QUERY_MAX_LEN = 80;
const FETCH_TIMEOUT_MS = 45_000;
const MAX_FETCH_RETRIES = 2;
const QUERY_CACHE_TTL_MS = 10 * 60 * 1000;
const SAMPLE_REFRESH_DELAY_MS = 45_000;
const SAMPLE_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const SAMPLE_REFRESH_BATCH_SIZE = 20;
const SAMPLE_REFRESH_OBJECT_COUNT = 100;

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

const sampleState = {
  asteroids: [],
  meta: {
    source: "Prepared startup sample",
    availableCount: null,
    sampleMode: "prepared-startup-sample",
    warning: null,
    coreObjectIds: [],
    generatedAt: null,
    lastRefreshedAt: null
  }
};

const responseCache = new Map();
let isSampleInitializationInFlight = false;
let isSampleRefreshInFlight = false;
let sampleRefreshCursor = 0;
let backgroundTimer = null;

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

    if (req.method === "GET" && requestUrl.pathname === "/api/catalog") {
      await handleCatalogApi(requestUrl, res);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/search") {
      await handleSearchApi(requestUrl, res);
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
  void initializeStartupSample();
});

async function initializeStartupSample() {
  if (isSampleInitializationInFlight || sampleState.asteroids.length > 0) {
    return;
  }

  isSampleInitializationInFlight = true;
  try {
    const payload = await readPreparedStartupSample();
    if (payload) {
      hydrateSampleState(payload);
      startBackgroundSampleRefreshLoop();
      console.log(`Loaded prepared startup sample with ${sampleState.asteroids.length} objects.`);
      return;
    }

    const livePayload = await fetchRandomWindowSample(DEFAULT_STARTUP_SAMPLE_SIZE);
    livePayload.meta.warning = "Prepared startup sample missing. Serving a live JPL sample.";
    hydrateSampleState(livePayload);
    startBackgroundSampleRefreshLoop();
    console.warn("Prepared startup sample was unavailable. Using a live JPL sample instead.");
  } catch (error) {
    console.warn(`Startup sample initialization failed: ${error.message}`);
  } finally {
    isSampleInitializationInFlight = false;
  }
}

function hydrateSampleState(payload) {
  const asteroids = dedupeAsteroids(Array.isArray(payload?.asteroids) ? payload.asteroids : []);
  const meta = payload?.meta ?? {};

  sampleState.asteroids = asteroids;
  sampleState.meta = {
    source: meta.source ?? "Prepared startup sample",
    availableCount: toFiniteNumber(meta.availableCount),
    sampleMode: meta.sampleMode ?? "prepared-startup-sample",
    warning: meta.warning ?? null,
    coreObjectIds: Array.isArray(meta.coreObjectIds) ? meta.coreObjectIds.map(String) : [],
    generatedAt: meta.generatedAt ?? meta.fetchedAt ?? null,
    lastRefreshedAt: meta.lastRefreshedAt ?? null
  };
}

function buildSamplePayload() {
  return {
    meta: {
      source: sampleState.meta.source,
      fetchedAt: new Date().toISOString(),
      generatedAt: sampleState.meta.generatedAt,
      lastRefreshedAt: sampleState.meta.lastRefreshedAt,
      loadedCount: sampleState.asteroids.length,
      availableCount: sampleState.meta.availableCount,
      sampleMode: sampleState.meta.sampleMode,
      warning: sampleState.meta.warning,
      coreObjectIds: sampleState.meta.coreObjectIds
    },
    asteroids: sampleState.asteroids
  };
}

function startBackgroundSampleRefreshLoop() {
  if (backgroundTimer) {
    clearInterval(backgroundTimer);
  }

  setTimeout(() => {
    void refreshLoadedSampleInMemory();
  }, SAMPLE_REFRESH_DELAY_MS);

  backgroundTimer = setInterval(() => {
    void refreshLoadedSampleInMemory();
  }, SAMPLE_REFRESH_INTERVAL_MS);
}

async function refreshLoadedSampleInMemory() {
  if (isSampleRefreshInFlight || sampleState.asteroids.length === 0) {
    return;
  }

  isSampleRefreshInFlight = true;
  try {
    const refreshTargets = getNextRefreshTargets(sampleState.asteroids, SAMPLE_REFRESH_OBJECT_COUNT);
    const refreshed = [];
    for (const chunk of chunkArray(refreshTargets, SAMPLE_REFRESH_BATCH_SIZE)) {
      const rows = await fetchAsteroidsByIdentifiers(
        chunk.map((asteroid) => asteroid.id),
        "spkid"
      );
      refreshed.push(...rows);
    }

    if (!refreshed.length) {
      return;
    }

    const refreshedById = new Map(refreshed.map((asteroid) => [asteroid.id, asteroid]));
    sampleState.asteroids = sampleState.asteroids.map((asteroid) => refreshedById.get(asteroid.id) ?? asteroid);
    sampleState.meta.lastRefreshedAt = new Date().toISOString();
    sampleState.meta.source = "Prepared startup sample + live JPL refresh";
  } catch (error) {
    console.warn(`Background sample refresh failed: ${error.message}`);
  } finally {
    isSampleRefreshInFlight = false;
  }
}

function getNextRefreshTargets(asteroids, count) {
  if (asteroids.length <= count) {
    return asteroids.slice();
  }

  const output = [];
  for (let index = 0; index < count; index += 1) {
    output.push(asteroids[(sampleRefreshCursor + index) % asteroids.length]);
  }
  sampleRefreshCursor = (sampleRefreshCursor + count) % asteroids.length;
  return output;
}

async function handleMainBeltApi(res) {
  await ensureStartupSampleReady();
  if (sampleState.asteroids.length === 0) {
    sendJson(res, 502, {
      error: "Failed to load asteroid data.",
      detail: "No prepared startup sample or live fallback is available."
    });
    return;
  }

  sendJson(res, 200, buildSamplePayload(), {
    "Cache-Control": "public, max-age=60"
  });
}

async function handleCatalogApi(requestUrl, res) {
  const query = normalizeCatalogQuery(requestUrl.searchParams);
  const cacheKey = `catalog:${JSON.stringify(query)}`;
  const cached = getCachedPayload(cacheKey);
  if (cached) {
    sendJson(res, 200, cached, {
      "Cache-Control": "public, max-age=60"
    });
    return;
  }

  try {
    const payload = await fetchCatalogPage(query);
    setCachedPayload(cacheKey, payload);
    sendJson(res, 200, payload, {
      "Cache-Control": "public, max-age=60"
    });
  } catch (error) {
    sendJson(res, 502, {
      error: "Failed to load catalog page.",
      detail: error.message
    });
  }
}

async function handleSearchApi(requestUrl, res) {
  const query = (requestUrl.searchParams.get("q") ?? "").trim().slice(0, SEARCH_QUERY_MAX_LEN);
  const limit = clampInt(requestUrl.searchParams.get("limit"), 1, SEARCH_RESULT_LIMIT, 8);

  if (!query) {
    sendJson(res, 200, {
      meta: {
        source: "NASA/JPL SBDB APIs",
        query,
        loadedCount: 0,
        availableCount: null
      },
      asteroids: []
    }, {
      "Cache-Control": "no-store"
    });
    return;
  }

  const cacheKey = `search:${query.toLowerCase()}:${limit}`;
  const cached = getCachedPayload(cacheKey);
  if (cached) {
    sendJson(res, 200, cached, {
      "Cache-Control": "no-store"
    });
    return;
  }

  try {
    const payload = await searchAsteroids(query, limit);
    setCachedPayload(cacheKey, payload);
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

async function fetchCatalogPage(query) {
  const clauses = buildCatalogClauses(query);
  const sort = buildCatalogSort(query.sortKey, query.sortDirection);
  const offset = Math.max(0, (query.page - 1) * query.pageSize);

  const url = buildQueryApiUrl({
    fields: API_FIELDS,
    limit: query.pageSize,
    offset,
    sort,
    clauses,
    clauseMode: "AND"
  });

  const payload = await fetchJsonWithRetries(url, {
    timeoutMs: FETCH_TIMEOUT_MS,
    maxRetries: MAX_FETCH_RETRIES
  });

  const asteroids = mapQueryPayloadToAsteroids(payload);
  const totalCount = toFiniteNumber(payload?.count) ?? asteroids.length;

  return {
    meta: {
      source: "NASA/JPL SBDB Query API",
      fetchedAt: new Date().toISOString(),
      page: query.page,
      pageSize: query.pageSize,
      totalCount,
      sortKey: query.sortKey,
      sortDirection: query.sortDirection,
      zone: query.zone,
      diameterFilter: query.diameterFilter,
      minDiameterKm: query.minDiameterKm
    },
    asteroids
  };
}

async function searchAsteroids(rawQuery, limit) {
  const exactPdes = await resolveExactPdesMatches(rawQuery, limit).catch(() => []);
  const exactMatches = exactPdes.length > 0 ? await fetchAsteroidsByIdentifiers(exactPdes, "pdes") : [];

  const broadClauses = buildSearchClauses(rawQuery);
  let broadMatches = [];
  if (broadClauses.length > 0) {
    broadMatches = await fetchAsteroidsByClauses(broadClauses, {
      limit: Math.min(SEARCH_RESULT_LIMIT, limit * 2),
      clauseMode: "OR",
      sort: "-diameter"
    });
  }

  const asteroids = dedupeAsteroids([...exactMatches, ...broadMatches]).slice(0, limit);
  return {
    meta: {
      source: "NASA/JPL SBDB APIs",
      fetchedAt: new Date().toISOString(),
      query: rawQuery,
      loadedCount: asteroids.length,
      availableCount: null
    },
    asteroids
  };
}

async function resolveExactPdesMatches(query, limit) {
  const url = `${OBJECT_API_BASE_URL}?${new URLSearchParams({ sstr: query }).toString()}`;
  const payload = await fetchJsonWithRetries(url, {
    timeoutMs: FETCH_TIMEOUT_MS,
    maxRetries: MAX_FETCH_RETRIES
  });

  const output = new Set();
  const directCandidate = sanitizeConstraintValue(payload?.object?.pdes ?? payload?.object?.des);
  if (directCandidate) {
    output.add(directCandidate);
  }

  if (Array.isArray(payload?.list)) {
    for (const item of payload.list) {
      const candidate = sanitizeConstraintValue(item?.pdes ?? item?.des);
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

async function fetchRandomWindowSample(targetSize) {
  const initialLimit = Math.max(1, Math.min(targetSize, DEFAULT_STARTUP_SAMPLE_SIZE));
  const initialUrl = buildQueryApiUrl({
    fields: API_FIELDS,
    limit: 1
  });
  const initialPayload = await fetchJsonWithRetries(initialUrl, {
    timeoutMs: FETCH_TIMEOUT_MS,
    maxRetries: MAX_FETCH_RETRIES
  });
  const availableCount = Math.max(initialLimit, toFiniteNumber(initialPayload?.count) ?? initialLimit);
  const maxOffset = Math.max(0, availableCount - initialLimit);
  const offset = randomIntInclusive(0, maxOffset);

  const payload = await fetchJsonWithRetries(
    buildQueryApiUrl({
      fields: API_FIELDS,
      limit: initialLimit,
      offset
    }),
    {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxRetries: MAX_FETCH_RETRIES
    }
  );

  const asteroids = mapQueryPayloadToAsteroids(payload);
  return {
    meta: {
      source: "NASA/JPL SBDB Query API",
      fetchedAt: new Date().toISOString(),
      loadedCount: asteroids.length,
      availableCount,
      sampleMode: "live-random-window",
      warning: null,
      coreObjectIds: []
    },
    asteroids
  };
}

async function fetchAsteroidsByIdentifiers(values, fieldName) {
  const clauses = values
    .map((value) => sanitizeConstraintValue(value))
    .filter(Boolean)
    .map((value) => `${fieldName}|EQ|${value}`);

  if (!clauses.length) {
    return [];
  }

  return fetchAsteroidsByClauses(clauses, {
    limit: clauses.length,
    clauseMode: "OR"
  });
}

async function fetchAsteroidsByClauses(clauses, options = {}) {
  const url = buildQueryApiUrl({
    fields: API_FIELDS,
    limit: options.limit ?? clauses.length,
    sort: options.sort,
    clauses,
    clauseMode: options.clauseMode ?? "OR"
  });

  const payload = await fetchJsonWithRetries(url, {
    timeoutMs: FETCH_TIMEOUT_MS,
    maxRetries: MAX_FETCH_RETRIES
  });

  return mapQueryPayloadToAsteroids(payload);
}

function buildCatalogClauses(query) {
  const clauses = [];

  if (query.zone === "Inner Belt") {
    clauses.push("a|LT|2.5");
  } else if (query.zone === "Middle Belt") {
    clauses.push("a|GE|2.5", "a|LT|2.82");
  } else if (query.zone === "Outer Belt") {
    clauses.push("a|GE|2.82");
  }

  if (query.diameterFilter === "known") {
    clauses.push("diameter|DF");
  } else if (query.diameterFilter === "unknown") {
    clauses.push("diameter|ND");
  }

  if (Number.isFinite(query.minDiameterKm)) {
    clauses.push(`diameter|GE|${query.minDiameterKm}`);
  }

  return clauses;
}

function buildCatalogSort(sortKey, sortDirection) {
  const sortFieldByKey = {
    name: "full_name",
    zone: "a",
    a: "a",
    e: "e",
    i: "i",
    diameterKm: "diameter"
  };

  const sortField = sortFieldByKey[sortKey] ?? "full_name";
  return `${sortDirection === "desc" ? "-" : ""}${sortField}`;
}

function buildSearchClauses(rawQuery) {
  const sanitized = sanitizeSearchFragment(rawQuery);
  if (!sanitized || sanitized.length < 2) {
    return /^\d+$/.test(rawQuery.trim()) ? [`pdes|EQ|${rawQuery.trim()}`] : [];
  }

  if (/^\d+$/.test(sanitized)) {
    return [`pdes|EQ|${sanitized}`, `spkid|EQ|${sanitized}`];
  }

  const clauses = [];
  const variants = new Set([
    sanitized,
    titleCaseWords(sanitized),
    sanitized.toUpperCase()
  ]);

  for (const variant of variants) {
    clauses.push(`full_name|RE|${variant}`);
    clauses.push(`pdes|RE|${variant}`);
  }

  return clauses;
}

function normalizeCatalogQuery(searchParams) {
  return {
    page: clampInt(searchParams.get("page"), 1, 100_000, 1),
    pageSize: clampInt(searchParams.get("pageSize"), 1, TABLE_PAGE_SIZE_MAX, TABLE_PAGE_SIZE_DEFAULT),
    zone: normalizeZone(searchParams.get("zone")),
    diameterFilter: normalizeDiameterFilter(searchParams.get("diameterFilter")),
    minDiameterKm: parseNullableNonNegativeNumber(searchParams.get("minDiameterKm")),
    sortKey: normalizeSortKey(searchParams.get("sortKey")),
    sortDirection: normalizeSortDirection(searchParams.get("sortDirection"))
  };
}

function normalizeZone(rawValue) {
  if (rawValue === "Inner Belt" || rawValue === "Middle Belt" || rawValue === "Outer Belt") {
    return rawValue;
  }
  return "all";
}

function normalizeDiameterFilter(rawValue) {
  if (rawValue === "known" || rawValue === "unknown") {
    return rawValue;
  }
  return "all";
}

function normalizeSortKey(rawValue) {
  const allowed = new Set(["name", "zone", "a", "e", "i", "diameterKm"]);
  return allowed.has(rawValue) ? rawValue : "name";
}

function normalizeSortDirection(rawValue) {
  return rawValue === "desc" ? "desc" : "asc";
}

function parseNullableNonNegativeNumber(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

async function ensureStartupSampleReady() {
  if (sampleState.asteroids.length > 0) {
    return;
  }

  await initializeStartupSample();
}

function getCachedPayload(cacheKey) {
  const entry = responseCache.get(cacheKey);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    responseCache.delete(cacheKey);
    return null;
  }
  return entry.payload;
}

function setCachedPayload(cacheKey, payload) {
  responseCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + QUERY_CACHE_TTL_MS
  });
}

async function readPreparedStartupSample() {
  try {
    const file = await fsPromises.readFile(STARTUP_SAMPLE_PATH, "utf8");
    const payload = JSON.parse(file);
    if (!Array.isArray(payload?.asteroids) || payload.asteroids.length === 0) {
      return null;
    }
    return payload;
  } catch {
    return null;
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

function chunkArray(items, chunkSize) {
  const output = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    output.push(items.slice(index, index + chunkSize));
  }
  return output;
}

function clampInt(rawValue, min, max, fallback) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
