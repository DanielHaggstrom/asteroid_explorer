import { APP_CONFIG } from "./config.js";
import { classifyBeltZone, periodYearsFromSemiMajorAxis, toNumber } from "./utils.js";

export async function loadMainBeltAsteroids(options = {}) {
  const payload = await fetchStandardizedPayload(
    APP_CONFIG.mainBeltApiUrl,
    options.proxyTimeoutMs ?? APP_CONFIG.proxyFetchTimeoutMs,
    options.signal
  );
  return normalizeAsteroidPayload(payload, {
    errorPrefix: `Failed to load from local proxy (${APP_CONFIG.mainBeltApiUrl}). Run the app with "npm run dev".`
  });
}

export async function loadCatalogPage(options = {}) {
  const params = new URLSearchParams({
    page: String(options.page ?? 1),
    pageSize: String(options.pageSize ?? APP_CONFIG.tablePageSizeDefault),
    zone: options.zone ?? "all",
    diameterFilter: options.diameterFilter ?? "all",
    sortKey: options.sortKey ?? "name",
    sortDirection: options.sortDirection ?? "asc"
  });

  if (Number.isFinite(options.minDiameterKm)) {
    params.set("minDiameterKm", String(options.minDiameterKm));
  }

  const url = `${APP_CONFIG.catalogApiUrl}?${params.toString()}`;
  const payload = await fetchStandardizedPayload(
    url,
    options.timeoutMs ?? APP_CONFIG.proxyFetchTimeoutMs,
    options.signal
  );

  const normalized = normalizeAsteroidPayload(payload, {
    errorPrefix: `Failed to load catalog page from ${APP_CONFIG.catalogApiUrl}.`
  });

  return {
    ...normalized,
    meta: {
      ...normalized.meta,
      page: toNumber(payload?.meta?.page) ?? 1,
      pageSize: toNumber(payload?.meta?.pageSize) ?? APP_CONFIG.tablePageSizeDefault,
      totalCount: toNumber(payload?.meta?.totalCount) ?? normalized.asteroids.length,
      sortKey: payload?.meta?.sortKey ?? "name",
      sortDirection: payload?.meta?.sortDirection ?? "asc",
      zone: payload?.meta?.zone ?? "all",
      diameterFilter: payload?.meta?.diameterFilter ?? "all",
      minDiameterKm: toNumber(payload?.meta?.minDiameterKm)
    }
  };
}

export async function searchAsteroids(query, options = {}) {
  const params = new URLSearchParams({
    q: query,
    limit: String(options.limit ?? APP_CONFIG.searchLimitDefault)
  });

  const payload = await fetchStandardizedPayload(
    `${APP_CONFIG.searchApiUrl}?${params.toString()}`,
    options.timeoutMs ?? APP_CONFIG.proxyFetchTimeoutMs,
    options.signal
  );

  return normalizeAsteroidPayload(payload, {
    errorPrefix: `Search request failed against ${APP_CONFIG.searchApiUrl}.`
  });
}

async function fetchStandardizedPayload(url, timeoutMs, upstreamSignal) {
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

function normalizeAsteroidPayload(payload, options = {}) {
  const records = Array.isArray(payload?.asteroids) ? payload.asteroids : [];
  const asteroids = dedupeById(records.map(normalizeAsteroid).filter(Boolean));

  return {
    asteroids,
    meta: {
      source: payload?.meta?.source ?? "Unknown source",
      fetchedAt: payload?.meta?.fetchedAt ?? new Date().toISOString(),
      availableCount: toNumber(payload?.meta?.availableCount),
      loadedCount: asteroids.length,
      warning: payload?.meta?.warning ?? null,
      generatedAt: payload?.meta?.generatedAt ?? null,
      lastRefreshedAt: payload?.meta?.lastRefreshedAt ?? null,
      sampleMode: payload?.meta?.sampleMode ?? null,
      coreObjectIds: Array.isArray(payload?.meta?.coreObjectIds)
        ? payload.meta.coreObjectIds.map(String)
        : []
    }
  };
}

function normalizeAsteroid(item) {
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
    name: String(name).trim(),
    primaryDesignation: item.primaryDesignation ? String(item.primaryDesignation).trim() : null,
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

function dedupeById(records) {
  const byId = new Map();
  for (const record of records) {
    byId.set(record.id, record);
  }
  return Array.from(byId.values());
}
