import { APP_CONFIG } from "./config.js";
import { classifyBeltZone, periodYearsFromSemiMajorAxis, toNumber } from "./utils.js";

export async function loadMainBeltAsteroids(options = {}) {
  const proxyTimeoutMs = options.proxyTimeoutMs ?? APP_CONFIG.proxyFetchTimeoutMs;
  const upstreamSignal = options.signal;

  try {
    const proxyPayload = await fetchJsonWithTimeout(APP_CONFIG.proxyApiUrl, proxyTimeoutMs, upstreamSignal);
    const normalized = normalizeStandardizedPayload(proxyPayload);
    if (normalized.asteroids.length) {
      return normalized;
    }
    throw new Error("Proxy returned no asteroid objects.");
  } catch (error) {
    throw new Error(
      `Failed to load from local proxy (${APP_CONFIG.proxyApiUrl}). ` +
        `Run the app with "npm run dev". Details: ${error.message}`
    );
  }
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
    primaryDesignation: item.primaryDesignation ? String(item.primaryDesignation) : null,
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
