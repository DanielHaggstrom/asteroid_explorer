import { APP_CONFIG } from "./config.js";
import { classifyBeltZone, periodYearsFromSemiMajorAxis, toNumber } from "./utils.js";

const API_FIELDS = Object.freeze([
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
]);

export async function loadMainBeltAsteroids(options = {}) {
  const maxObjects = options.maxObjects ?? APP_CONFIG.maxObjects;
  const pageSize = options.pageSize ?? APP_CONFIG.pageSize;
  const timeoutMs = options.timeoutMs ?? APP_CONFIG.fetchTimeoutMs;
  const upstreamSignal = options.signal;

  const errors = [];

  try {
    const proxyPayload = await fetchJsonWithTimeout(APP_CONFIG.proxyApiUrl, timeoutMs, upstreamSignal);
    const normalized = normalizeStandardizedPayload(proxyPayload);
    if (normalized.asteroids.length) {
      return normalized;
    }
    errors.push("Proxy returned no objects.");
  } catch (error) {
    errors.push(`Proxy failed: ${error.message}`);
  }

  try {
    const directPayload = await loadFromDirectJplApi(maxObjects, pageSize, timeoutMs, upstreamSignal);
    if (directPayload.asteroids.length) {
      return directPayload;
    }
    errors.push("Direct API returned no objects.");
  } catch (error) {
    errors.push(`Direct API failed: ${error.message}`);
  }

  try {
    const fallbackPayload = await fetchJsonWithTimeout(APP_CONFIG.fallbackDatasetUrl, timeoutMs, upstreamSignal);
    const normalizedFallback = normalizeStandardizedPayload(fallbackPayload);
    if (normalizedFallback.asteroids.length) {
      normalizedFallback.meta = {
        ...normalizedFallback.meta,
        source: `${normalizedFallback.meta.source ?? "Local fallback"}`
      };
      return normalizedFallback;
    }
    errors.push("Fallback dataset is empty.");
  } catch (error) {
    errors.push(`Fallback failed: ${error.message}`);
  }

  throw new Error(`No data source was reachable. ${errors.join(" ")}`);
}

async function loadFromDirectJplApi(maxObjects, pageSize, timeoutMs, upstreamSignal) {
  let offset = 0;
  let availableCount = null;
  const records = [];

  while (records.length < maxObjects) {
    const nextLimit = Math.min(pageSize, maxObjects - records.length);
    const requestUrl = buildRequestUrl(nextLimit, offset);
    const payload = await fetchJsonWithTimeout(requestUrl, timeoutMs, upstreamSignal);
    const parsedCount = toNumber(payload.count);
    if (Number.isFinite(parsedCount)) {
      availableCount = parsedCount;
    }

    const fieldIndex = createFieldIndex(payload.fields ?? []);
    const rawRows = Array.isArray(payload.data) ? payload.data : [];
    const pageAsteroids = rawRows
      .map((row) => mapRowToAsteroid(row, fieldIndex))
      .filter(Boolean);

    if (!rawRows.length) {
      break;
    }

    records.push(...pageAsteroids);
    offset += rawRows.length;

    if (availableCount !== null && offset >= availableCount) {
      break;
    }
    if (rawRows.length < nextLimit) {
      break;
    }
  }

  const deduped = dedupeById(records);
  return {
    asteroids: deduped,
    meta: {
      source: "NASA/JPL SBDB Query API (direct)",
      fetchedAt: new Date().toISOString(),
      availableCount,
      loadedCount: deduped.length
    }
  };
}

function buildRequestUrl(limit, offset) {
  const params = new URLSearchParams({
    fields: API_FIELDS.join(","),
    "sb-kind": "a",
    "sb-class": "MBA",
    "full-prec": "1",
    limit: String(limit),
    "limit-from": String(offset)
  });

  return `${APP_CONFIG.directApiBaseUrl}?${params.toString()}`;
}

async function fetchJsonWithTimeout(url, timeoutMs, upstreamSignal) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let abortListener = null;
  if (upstreamSignal) {
    abortListener = () => controller.abort();
    if (upstreamSignal.aborted) {
      controller.abort();
    } else {
      upstreamSignal.addEventListener("abort", abortListener, { once: true });
    }
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}.`);
    }
    return response.json();
  } finally {
    clearTimeout(timeoutHandle);
    if (upstreamSignal && abortListener) {
      upstreamSignal.removeEventListener("abort", abortListener);
    }
  }
}

function createFieldIndex(fields) {
  const fieldIndex = {};
  fields.forEach((fieldName, index) => {
    fieldIndex[fieldName] = index;
  });
  return fieldIndex;
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

  const object = {
    id: String(id),
    name: String(name).trim(),
    classCode: pickField(row, fieldIndex, "class") ?? "Unknown",
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
    epochMjd: toNumber(pickField(row, fieldIndex, "epoch"))
  };

  object.orbitalPeriodYears = periodYearsFromSemiMajorAxis(object.a);
  return object;
}

function pickField(row, fieldIndex, name) {
  const index = fieldIndex[name];
  if (index === undefined) {
    return null;
  }
  return row[index];
}

function dedupeById(records) {
  const byId = new Map();
  for (const record of records) {
    byId.set(record.id, record);
  }
  return Array.from(byId.values());
}

function normalizeStandardizedPayload(payload) {
  const records = Array.isArray(payload?.asteroids) ? payload.asteroids : [];
  const asteroids = records.map(normalizeStandardizedAsteroid).filter(Boolean);
  const deduped = dedupeById(asteroids);

  return {
    asteroids: deduped,
    meta: {
      source: payload?.meta?.source ?? "Unknown source",
      fetchedAt: payload?.meta?.fetchedAt ?? new Date().toISOString(),
      availableCount: toNumber(payload?.meta?.availableCount),
      loadedCount: deduped.length,
      warning: payload?.meta?.warning ?? null
    }
  };
}

function normalizeStandardizedAsteroid(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const a = toNumber(item.a);
  const e = toNumber(item.e);
  const i = toNumber(item.i);
  const id = item.id;
  const name = item.name;
  if (!id || !name || !Number.isFinite(a) || !Number.isFinite(e) || !Number.isFinite(i)) {
    return null;
  }

  return {
    id: String(id),
    name: String(name),
    classCode: String(item.classCode ?? "Unknown"),
    zone: item.zone ?? classifyBeltZone(a),
    a,
    e,
    i,
    om: toNumber(item.om),
    w: toNumber(item.w),
    ma: toNumber(item.ma),
    diameterKm: toNumber(item.diameterKm),
    albedo: toNumber(item.albedo),
    absoluteMagnitudeH: toNumber(item.absoluteMagnitudeH),
    epochMjd: toNumber(item.epochMjd),
    orbitalPeriodYears: toNumber(item.orbitalPeriodYears) ?? periodYearsFromSemiMajorAxis(a)
  };
}
