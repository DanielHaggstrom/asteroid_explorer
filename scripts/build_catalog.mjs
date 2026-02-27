import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const API_BASE_URL = "https://ssd-api.jpl.nasa.gov/sbdb_query.api";
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

const OUTPUT_DIR = path.join(ROOT_DIR, "data", "catalog");
const CHUNKS_DIR = path.join(OUTPUT_DIR, "chunks");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "manifest.json");
const SEARCH_INDEX_PATH = path.join(OUTPUT_DIR, "search-index.ndjson");
const STATS_PATH = path.join(OUTPUT_DIR, "precomputed-stats.json");

const DEFAULT_CHUNK_SIZE = 50_000;
const FETCH_TIMEOUT_MS = 60_000;
const FETCH_RETRIES = 2;

const chunkSize = resolveChunkSize(process.argv);

await fsPromises.mkdir(CHUNKS_DIR, { recursive: true });
await removeExistingGeneratedFiles();

const stats = createStatsAccumulator();
const searchIndexStream = fs.createWriteStream(SEARCH_INDEX_PATH, { encoding: "utf8" });
const chunkFiles = [];

try {
  const totalCount = await fetchAvailableCount();
  console.log(`Starting catalog build: ${totalCount} objects, chunk size ${chunkSize}.`);

  for (let offset = 0, chunkIndex = 0; offset < totalCount; offset += chunkSize, chunkIndex += 1) {
    const requestLimit = Math.min(chunkSize, totalCount - offset);
    const payload = await fetchJsonWithRetries(buildQueryUrl(requestLimit, offset), FETCH_TIMEOUT_MS, FETCH_RETRIES);
    const fields = Array.isArray(payload.fields) ? payload.fields : [];
    const rows = Array.isArray(payload.data) ? payload.data : [];
    const fieldIndex = createFieldIndex(fields);

    const asteroids = [];
    for (const [rowIndex, row] of rows.entries()) {
      const mapped = mapRowToAsteroid(row, fieldIndex);
      if (!mapped) {
        continue;
      }
      asteroids.push(mapped);
      updateStats(stats, mapped);

      const indexRecord = {
        id: mapped.id,
        nameLower: mapped.name.toLowerCase(),
        pdesLower: mapped.primaryDesignation ? mapped.primaryDesignation.toLowerCase() : "",
        chunk: chunkFilename(chunkIndex),
        row: asteroids.length - 1
      };
      await writeLine(searchIndexStream, JSON.stringify(indexRecord));
    }

    const filename = chunkFilename(chunkIndex);
    chunkFiles.push(filename);
    await fsPromises.writeFile(
      path.join(CHUNKS_DIR, filename),
      JSON.stringify({ offset, asteroids }),
      "utf8"
    );
    console.log(`Wrote ${filename}: ${asteroids.length} objects (offset ${offset}).`);
  }

  const finalizedStats = finalizeStats(stats);
  await fsPromises.writeFile(STATS_PATH, JSON.stringify(finalizedStats), "utf8");

  const manifest = {
    source: "NASA/JPL SBDB Query API",
    generatedAt: new Date().toISOString(),
    totalCount: finalizedStats.totalObjects,
    chunkSize,
    chunkFiles,
    searchIndexFile: path.basename(SEARCH_INDEX_PATH),
    statsFile: path.basename(STATS_PATH)
  };
  await fsPromises.writeFile(MANIFEST_PATH, JSON.stringify(manifest), "utf8");
  console.log(`Catalog build complete. Manifest written to ${MANIFEST_PATH}`);
} finally {
  searchIndexStream.end();
  await once(searchIndexStream, "close");
}

function resolveChunkSize(argv) {
  const raw = argv.find((arg) => arg.startsWith("--chunk-size="));
  if (!raw) {
    return DEFAULT_CHUNK_SIZE;
  }
  const value = Number(raw.split("=")[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_CHUNK_SIZE;
  }
  return Math.floor(value);
}

async function fetchAvailableCount() {
  const params = new URLSearchParams({
    "sb-kind": "a",
    "sb-class": "MBA"
  });
  const payload = await fetchJsonWithRetries(`${API_BASE_URL}?${params.toString()}`, FETCH_TIMEOUT_MS, FETCH_RETRIES);
  const count = Number(payload.count);
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error("Unable to resolve total object count from API.");
  }
  return count;
}

function buildQueryUrl(limit, offset) {
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
      await sleep((attempt + 1) * 500);
    }
  }
  throw lastError ?? new Error("Unknown fetch failure.");
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
  const index = {};
  fields.forEach((field, fieldIdx) => {
    index[field] = fieldIdx;
  });
  return index;
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

function pickField(row, fieldIndex, fieldName) {
  const index = fieldIndex[fieldName];
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

function periodYearsFromSemiMajorAxis(a) {
  if (!Number.isFinite(a) || a <= 0) {
    return null;
  }
  return Math.sqrt(a ** 3);
}

function categorizeDiameterKm(diameterKm) {
  if (!Number.isFinite(diameterKm)) {
    return "Unknown";
  }
  if (diameterKm < 0.5) {
    return "<0.5 km";
  }
  if (diameterKm < 1) {
    return "0.5-1 km";
  }
  if (diameterKm < 2) {
    return "1-2 km";
  }
  if (diameterKm < 5) {
    return "2-5 km";
  }
  if (diameterKm < 10) {
    return "5-10 km";
  }
  if (diameterKm < 20) {
    return "10-20 km";
  }
  if (diameterKm < 50) {
    return "20-50 km";
  }
  return ">=50 km";
}

function createStatsAccumulator() {
  return {
    totalObjects: 0,
    withDiameter: 0,
    sizeBuckets: {
      "<0.5 km": 0,
      "0.5-1 km": 0,
      "1-2 km": 0,
      "2-5 km": 0,
      "5-10 km": 0,
      "10-20 km": 0,
      "20-50 km": 0,
      ">=50 km": 0,
      Unknown: 0
    },
    zoneCounts: {
      "Inner Belt": 0,
      "Middle Belt": 0,
      "Outer Belt": 0,
      Unknown: 0
    },
    semiMajorAxisHistogram: {
      min: 2.0,
      max: 3.5,
      bins: new Array(56).fill(0)
    },
    trueAnomalyHistogram: {
      min: 0,
      max: 360,
      bins: new Array(24).fill(0),
      validCount: 0
    }
  };
}

function updateStats(stats, asteroid) {
  stats.totalObjects += 1;
  const bucket = categorizeDiameterKm(asteroid.diameterKm);
  stats.sizeBuckets[bucket] += 1;
  if (bucket !== "Unknown") {
    stats.withDiameter += 1;
  }
  stats.zoneCounts[asteroid.zone] = (stats.zoneCounts[asteroid.zone] ?? 0) + 1;
  updateSemiMajorAxisHistogram(stats.semiMajorAxisHistogram, asteroid.a);
  updateTrueAnomalyHistogram(stats.trueAnomalyHistogram, asteroid.e, asteroid.ma);
}

function updateSemiMajorAxisHistogram(histogram, a) {
  if (!Number.isFinite(a) || a < histogram.min || a > histogram.max) {
    return;
  }
  const ratio = (a - histogram.min) / (histogram.max - histogram.min);
  const index = Math.min(histogram.bins.length - 1, Math.floor(ratio * histogram.bins.length));
  histogram.bins[index] += 1;
}

function updateTrueAnomalyHistogram(histogram, e, ma) {
  const trueAnomalyDeg = trueAnomalyDegrees(e, ma);
  if (!Number.isFinite(trueAnomalyDeg)) {
    return;
  }
  const normalized = ((trueAnomalyDeg % 360) + 360) % 360;
  const index = Math.min(histogram.bins.length - 1, Math.floor((normalized / 360) * histogram.bins.length));
  histogram.bins[index] += 1;
  histogram.validCount += 1;
}

function solveKeplerEquation(meanAnomalyRad, eccentricity, maxIterations = 22, epsilon = 1e-8) {
  if (!Number.isFinite(meanAnomalyRad) || !Number.isFinite(eccentricity)) {
    return null;
  }

  let estimate = eccentricity < 0.8 ? meanAnomalyRad : Math.PI;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const error = estimate - eccentricity * Math.sin(estimate) - meanAnomalyRad;
    const slope = 1 - eccentricity * Math.cos(estimate);
    if (Math.abs(slope) < epsilon) {
      break;
    }
    const delta = error / slope;
    estimate -= delta;
    if (Math.abs(delta) < epsilon) {
      break;
    }
  }
  return estimate;
}

function trueAnomalyDegrees(e, ma) {
  if (!Number.isFinite(e) || !Number.isFinite(ma)) {
    return null;
  }
  const meanAnomaly = degreesToRadians(normalizeAngleDegrees(ma));
  const eccentricAnomaly = solveKeplerEquation(meanAnomaly, e);
  if (!Number.isFinite(eccentricAnomaly)) {
    return null;
  }
  const trueAnomaly = 2 * Math.atan2(
    Math.sqrt(1 + e) * Math.sin(eccentricAnomaly / 2),
    Math.sqrt(1 - e) * Math.cos(eccentricAnomaly / 2)
  );
  return normalizeAngleDegrees(radiansToDegrees(trueAnomaly));
}

function normalizeAngleDegrees(degrees) {
  const normalized = degrees % 360;
  return normalized >= 0 ? normalized : normalized + 360;
}

function degreesToRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function radiansToDegrees(radians) {
  return (radians * 180) / Math.PI;
}

function finalizeStats(stats) {
  return {
    generatedAt: new Date().toISOString(),
    totalObjects: stats.totalObjects,
    withDiameter: stats.withDiameter,
    sizeBuckets: stats.sizeBuckets,
    zoneCounts: stats.zoneCounts,
    semiMajorAxisHistogram: stats.semiMajorAxisHistogram,
    trueAnomalyHistogram: stats.trueAnomalyHistogram
  };
}

function chunkFilename(chunkIndex) {
  return `chunk-${String(chunkIndex).padStart(5, "0")}.json`;
}

async function writeLine(stream, text) {
  if (stream.write(`${text}\n`)) {
    return;
  }
  await once(stream, "drain");
}

async function removeExistingGeneratedFiles() {
  await fsPromises.rm(CHUNKS_DIR, { recursive: true, force: true });
  await fsPromises.mkdir(CHUNKS_DIR, { recursive: true });
  await fsPromises.rm(MANIFEST_PATH, { force: true });
  await fsPromises.rm(STATS_PATH, { force: true });
  await fsPromises.rm(SEARCH_INDEX_PATH, { force: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
