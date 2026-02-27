export const APP_CONFIG = Object.freeze({
  proxyApiUrl: "/api/main-belt",
  directApiBaseUrl: "https://ssd-api.jpl.nasa.gov/sbdb_query.api",
  fallbackDatasetUrl: "/data/main-belt-fallback.json",
  maxObjects: 1200,
  pageSize: 200,
  fetchTimeoutMs: 12_000,
  maxTableRows: 140,
  maxMapPointsDefault: 600,
  mapClickRadiusPx: 10
});
