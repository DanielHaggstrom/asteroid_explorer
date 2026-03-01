import { APP_CONFIG } from "./config.js";
import { loadCatalogPage, loadMainBeltAsteroids, searchAsteroids } from "./dataService.js";
import {
  drawBarChart,
  drawBeltMap,
  drawScatterPlot,
  drawSemiMajorAxisHistogram,
  drawTrueAnomalyHistogram
} from "./charts.js";
import {
  average,
  computeSizeBuckets,
  dominantZone,
  findNearestPoint,
  formatNumber,
  formatWithUnit
} from "./utils.js";

const elements = {
  sourceBadge: document.getElementById("sourceBadge"),
  statusMessage: document.getElementById("statusMessage"),
  searchInput: document.getElementById("searchInput"),
  zoneSelect: document.getElementById("zoneSelect"),
  mapDensityRange: document.getElementById("mapDensityRange"),
  mapDensityValue: document.getElementById("mapDensityValue"),
  kpiTotal: document.getElementById("kpiTotal"),
  kpiTotalMeta: document.getElementById("kpiTotalMeta"),
  kpiDiameterCoverage: document.getElementById("kpiDiameterCoverage"),
  kpiMeanDiameter: document.getElementById("kpiMeanDiameter"),
  kpiMeanEccentricity: document.getElementById("kpiMeanEccentricity"),
  kpiDominantZone: document.getElementById("kpiDominantZone"),
  sizeChart: document.getElementById("sizeChart"),
  orbitScatterChart: document.getElementById("orbitScatterChart"),
  semiMajorAxisChart: document.getElementById("semiMajorAxisChart"),
  trueAnomalyChart: document.getElementById("trueAnomalyChart"),
  beltMap: document.getElementById("beltMap"),
  asteroidTableBody: document.getElementById("asteroidTableBody"),
  tableSummary: document.getElementById("tableSummary"),
  tableDiameterFilter: document.getElementById("tableDiameterFilter"),
  tableMinDiameter: document.getElementById("tableMinDiameter"),
  tablePageSize: document.getElementById("tablePageSize"),
  tablePrevPage: document.getElementById("tablePrevPage"),
  tableNextPage: document.getElementById("tableNextPage"),
  tablePageIndicator: document.getElementById("tablePageIndicator"),
  tableSortButtons: Array.from(document.querySelectorAll(".sort-btn")),
  detailName: document.getElementById("detailName"),
  detailId: document.getElementById("detailId"),
  detailClass: document.getElementById("detailClass"),
  detailZone: document.getElementById("detailZone"),
  detailA: document.getElementById("detailA"),
  detailE: document.getElementById("detailE"),
  detailI: document.getElementById("detailI"),
  detailDiameter: document.getElementById("detailDiameter"),
  detailAlbedo: document.getElementById("detailAlbedo"),
  detailH: document.getElementById("detailH"),
  detailPeriod: document.getElementById("detailPeriod"),
  detailEpoch: document.getElementById("detailEpoch")
};

let visualizationResizeObserver = null;

const state = {
  sampleAsteroids: [],
  displayAsteroids: [],
  mapPoints: [],
  selectedAsteroid: null,
  searchRequestToken: 0,
  tableRequestToken: 0,
  meta: {
    source: "Unknown source",
    availableCount: null,
    warning: null,
    generatedAt: null,
    lastRefreshedAt: null,
    sampleMode: null,
    coreObjectIds: []
  },
  filters: {
    zone: "all",
    mapDensity: APP_CONFIG.maxMapPointsDefault
  },
  table: {
    rows: [],
    totalCount: 0,
    page: 1,
    pageSize: APP_CONFIG.tablePageSizeDefault,
    sortKey: "name",
    sortDirection: "asc",
    diameterFilter: "all",
    minDiameterKm: null,
    isLoading: false,
    error: null
  }
};

const triggerRemoteSearch = debounce((query, token) => {
  void fetchRemoteSearch(query, token);
}, 420);
const triggerVisualizationRerender = debounce(() => {
  renderVisualizations();
}, 120);

attachListeners();
bootstrap();

async function bootstrap() {
  elements.mapDensityValue.textContent = String(state.filters.mapDensity);
  elements.tablePageSize.value = String(state.table.pageSize);
  setStatus("Loading prepared startup sample...");
  state.table.isLoading = true;
  renderAll();

  try {
    const result = await loadMainBeltAsteroids({
      proxyTimeoutMs: APP_CONFIG.proxyFetchTimeoutMs
    });

    state.sampleAsteroids = result.asteroids;
    state.meta = {
      source: result.meta.source,
      availableCount: result.meta.availableCount,
      warning: result.meta.warning,
      generatedAt: result.meta.generatedAt,
      lastRefreshedAt: result.meta.lastRefreshedAt,
      sampleMode: result.meta.sampleMode,
      coreObjectIds: result.meta.coreObjectIds
    };
    reconcileDisplayAsteroids();
    renderSourceBadge();
    renderAll();
    if (result.meta.warning) {
      setStatus(result.meta.warning, "warning");
    } else {
      setStatus("Prepared sample loaded. Full-catalog browsing uses the live JPL API.");
    }
    requestAnimationFrame(() => renderVisualizations());
    void refreshTable();
  } catch (error) {
    elements.sourceBadge.textContent = "Source: unavailable";
    state.sampleAsteroids = [];
    state.displayAsteroids = [];
    state.selectedAsteroid = null;
    state.table.isLoading = false;
    state.table.error = null;
    renderAll();
    setStatus(`Failed to load data: ${error.message}`, "error");
  }
}

function attachListeners() {
  elements.searchInput.addEventListener("input", (event) => {
    const query = event.target.value.trim();
    const requestToken = ++state.searchRequestToken;
    const isNumericLookup = /^\d+$/.test(query);

    if (!query) {
      restoreDefaultStatus();
      return;
    }

    if (query.length < APP_CONFIG.searchMinQueryLength && !isNumericLookup) {
      setStatus(`Type at least ${APP_CONFIG.searchMinQueryLength} characters to search.`, "warning");
      return;
    }

    setStatus(`Searching JPL for "${query}"...`);
    triggerRemoteSearch(query, requestToken);
  });

  elements.zoneSelect.addEventListener("change", (event) => {
    state.filters.zone = event.target.value;
    state.table.page = 1;
    renderAll();
    void refreshTable();
  });

  elements.mapDensityRange.addEventListener("input", (event) => {
    const density = Number(event.target.value);
    state.filters.mapDensity = Number.isFinite(density) ? density : APP_CONFIG.maxMapPointsDefault;
    elements.mapDensityValue.textContent = String(state.filters.mapDensity);
    renderVisualizations();
  });

  elements.tableDiameterFilter.addEventListener("change", (event) => {
    state.table.diameterFilter = event.target.value;
    state.table.page = 1;
    void refreshTable();
  });

  elements.tableMinDiameter.addEventListener("input", (event) => {
    const raw = event.target.value.trim();
    if (!raw) {
      state.table.minDiameterKm = null;
    } else {
      const value = Number(raw);
      state.table.minDiameterKm = Number.isFinite(value) && value >= 0 ? value : null;
    }
    state.table.page = 1;
    void refreshTable();
  });

  elements.tablePageSize.addEventListener("change", (event) => {
    const value = Number(event.target.value);
    state.table.pageSize = Number.isFinite(value) && value > 0 ? value : APP_CONFIG.tablePageSizeDefault;
    state.table.page = 1;
    void refreshTable();
  });

  elements.tablePrevPage.addEventListener("click", () => {
    if (state.table.page > 1) {
      state.table.page -= 1;
      void refreshTable();
    }
  });

  elements.tableNextPage.addEventListener("click", () => {
    const totalPages = getTableTotalPages();
    if (state.table.page < totalPages) {
      state.table.page += 1;
      void refreshTable();
    }
  });

  elements.tableSortButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const sortKey = button.dataset.sortKey;
      if (!sortKey) {
        return;
      }

      if (state.table.sortKey === sortKey) {
        state.table.sortDirection = state.table.sortDirection === "asc" ? "desc" : "asc";
      } else {
        state.table.sortKey = sortKey;
        state.table.sortDirection = "asc";
      }
      state.table.page = 1;
      void refreshTable();
    });
  });

  elements.beltMap.addEventListener("click", (event) => {
    const rect = elements.beltMap.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const nearest = findNearestPoint(state.mapPoints, x, y, APP_CONFIG.mapClickRadiusPx);
    if (!nearest) {
      return;
    }

    const asteroid = findAsteroidById(nearest.id);
    if (!asteroid) {
      return;
    }

    setSelectedAsteroid(asteroid);
  });

  attachVisualizationResizeObserver();
  window.addEventListener("resize", triggerVisualizationRerender);
}

function renderAll() {
  renderKpis();
  renderVisualizations();
  renderTable();
  renderDetails();
}

function renderKpis() {
  const records = getVisualizationAsteroids();
  const loadedCount = state.displayAsteroids.length;
  const withDiameter = records.filter((item) => Number.isFinite(item.diameterKm));
  const meanDiameter = average(withDiameter.map((item) => item.diameterKm));
  const meanEccentricity = average(records.map((item) => item.e));

  elements.kpiTotal.textContent = formatNumber(loadedCount, 0);
  elements.kpiTotalMeta.textContent = Number.isFinite(state.meta.availableCount) && state.meta.availableCount > 0
    ? `of ${formatNumber(state.meta.availableCount, 0)} cataloged`
    : "prepared sample loaded";
  elements.kpiDiameterCoverage.textContent = `${formatNumber(withDiameter.length, 0)} / ${formatNumber(records.length, 0)}`;
  elements.kpiMeanDiameter.textContent = formatWithUnit(meanDiameter, "km", 2);
  elements.kpiMeanEccentricity.textContent = formatNumber(meanEccentricity, 4);
  elements.kpiDominantZone.textContent = dominantZone(records);
}

function renderVisualizations() {
  const records = getVisualizationAsteroids();
  drawBarChart(elements.sizeChart, computeSizeBuckets(records, { includeUnknown: false }));
  drawScatterPlot(elements.orbitScatterChart, records);
  drawSemiMajorAxisHistogram(elements.semiMajorAxisChart, records);
  drawTrueAnomalyHistogram(elements.trueAnomalyChart, records);
  state.mapPoints = drawBeltMap(
    elements.beltMap,
    records,
    state.selectedAsteroid?.id ?? null,
    state.filters.mapDensity
  );
}

function renderTable() {
  const rows = state.table.rows;
  const totalPages = getTableTotalPages();
  if (state.table.page > totalPages) {
    state.table.page = totalPages;
  }

  const rowElements = rows.map((asteroid) => createRow(asteroid));
  elements.asteroidTableBody.replaceChildren(...rowElements);
  elements.tableSummary.textContent = buildTableSummaryText(rows.length);
  elements.tablePageIndicator.textContent = `Page ${formatNumber(state.table.page, 0)} / ${formatNumber(totalPages, 0)}`;
  elements.tablePrevPage.disabled = state.table.isLoading || state.table.page <= 1;
  elements.tableNextPage.disabled = state.table.isLoading || state.table.page >= totalPages;
  updateSortButtonState();
}

function buildTableSummaryText(rowCount) {
  if (state.table.isLoading) {
    return "Loading catalog page from the JPL API...";
  }
  if (state.table.error) {
    return `Catalog page unavailable: ${state.table.error}`;
  }
  if (state.table.totalCount === 0) {
    return "No catalog rows match the current filters.";
  }

  const pageStartIndex = (state.table.page - 1) * state.table.pageSize;
  const pageEndIndex = pageStartIndex + rowCount;
  return `Rows ${formatNumber(pageStartIndex + 1, 0)}-${formatNumber(pageEndIndex, 0)} of ${formatNumber(state.table.totalCount, 0)} matching the current filters.`;
}

function createRow(asteroid) {
  const row = document.createElement("tr");
  if (asteroid.id === state.selectedAsteroid?.id) {
    row.classList.add("selected");
  }
  row.addEventListener("click", () => {
    setSelectedAsteroid(asteroid);
  });

  appendCell(row, asteroid.name);
  appendCell(row, asteroid.zone);
  appendCell(row, formatNumber(asteroid.a, 3));
  appendCell(row, formatNumber(asteroid.e, 4));
  appendCell(row, formatNumber(asteroid.i, 3));
  appendCell(row, Number.isFinite(asteroid.diameterKm) ? formatNumber(asteroid.diameterKm, 2) : "Unknown");
  return row;
}

function appendCell(row, text) {
  const cell = document.createElement("td");
  cell.textContent = text;
  row.appendChild(cell);
}

async function refreshTable() {
  const requestToken = ++state.tableRequestToken;
  state.table.isLoading = true;
  state.table.error = null;
  renderTable();

  try {
    const result = await loadCatalogPage({
      page: state.table.page,
      pageSize: state.table.pageSize,
      zone: state.filters.zone,
      diameterFilter: state.table.diameterFilter,
      minDiameterKm: state.table.minDiameterKm,
      sortKey: state.table.sortKey,
      sortDirection: state.table.sortDirection,
      timeoutMs: APP_CONFIG.proxyFetchTimeoutMs
    });

    if (requestToken !== state.tableRequestToken) {
      return;
    }

    state.table.rows = result.asteroids;
    state.table.totalCount = result.meta.totalCount;
    state.table.error = null;
  } catch (error) {
    if (requestToken !== state.tableRequestToken) {
      return;
    }
    state.table.rows = [];
    state.table.totalCount = 0;
    state.table.error = error.message;
  } finally {
    if (requestToken !== state.tableRequestToken) {
      return;
    }
    state.table.isLoading = false;
    renderTable();
  }
}

function setSelectedAsteroid(asteroid) {
  state.selectedAsteroid = asteroid ? { ...asteroid } : null;
  integrateSelectedAsteroidIntoSample();
  renderSourceBadge();
  renderAll();
}

function integrateSelectedAsteroidIntoSample() {
  const selected = state.selectedAsteroid;
  if (!selected?.id) {
    reconcileDisplayAsteroids();
    return;
  }

  const sampleIndex = state.sampleAsteroids.findIndex((item) => item.id === selected.id);
  if (sampleIndex >= 0) {
    const nextSample = state.sampleAsteroids.slice();
    nextSample[sampleIndex] = selected;
    state.sampleAsteroids = nextSample;
  }

  reconcileDisplayAsteroids();
}

function reconcileDisplayAsteroids() {
  const selected = state.selectedAsteroid;
  const nextDisplay = state.sampleAsteroids.slice();
  const sampleSize = nextDisplay.length;

  if (selected?.id) {
    const existingIndex = nextDisplay.findIndex((item) => item.id === selected.id);
    if (existingIndex >= 0) {
      nextDisplay[existingIndex] = selected;
    } else if (sampleSize === 0) {
      nextDisplay.push(selected);
    } else {
      const evictionIndex = pickEvictionIndex(nextDisplay, new Set(state.meta.coreObjectIds), selected.id);
      if (evictionIndex >= 0) {
        nextDisplay.splice(evictionIndex, 1);
      }
      nextDisplay.push(selected);
      while (nextDisplay.length > sampleSize) {
        nextDisplay.shift();
      }
    }
  }

  state.displayAsteroids = dedupeAsteroids(nextDisplay);
}

function pickEvictionIndex(sampleAsteroids, coreObjectIds, protectedId) {
  const candidates = [];
  for (let index = 0; index < sampleAsteroids.length; index += 1) {
    const asteroid = sampleAsteroids[index];
    if (asteroid.id !== protectedId && !coreObjectIds.has(asteroid.id)) {
      candidates.push(index);
    }
  }

  if (candidates.length === 0) {
    return sampleAsteroids.length > 0 ? sampleAsteroids.length - 1 : -1;
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}

function getVisualizationAsteroids() {
  const filtered = state.displayAsteroids.filter(
    (asteroid) => state.filters.zone === "all" || asteroid.zone === state.filters.zone
  );

  if (state.selectedAsteroid && !filtered.some((asteroid) => asteroid.id === state.selectedAsteroid.id)) {
    return [...filtered, state.selectedAsteroid];
  }
  return filtered;
}

function findAsteroidById(id) {
  return (
    state.displayAsteroids.find((item) => item.id === id) ??
    state.table.rows.find((item) => item.id === id) ??
    (state.selectedAsteroid?.id === id ? state.selectedAsteroid : null)
  );
}

function renderDetails() {
  const selected = state.selectedAsteroid;
  if (!selected) {
    setDetailValues({
      detailName: "No body selected",
      detailId: "-",
      detailClass: "-",
      detailZone: "-",
      detailA: "-",
      detailE: "-",
      detailI: "-",
      detailDiameter: "-",
      detailAlbedo: "-",
      detailH: "-",
      detailPeriod: "-",
      detailEpoch: "-"
    });
    return;
  }

  setDetailValues({
    detailName: selected.name,
    detailId: selected.id,
    detailClass: selected.classCode,
    detailZone: selected.zone,
    detailA: formatWithUnit(selected.a, "AU", 4),
    detailE: formatNumber(selected.e, 5),
    detailI: formatWithUnit(selected.i, "deg", 4),
    detailDiameter: formatWithUnit(selected.diameterKm, "km", 3),
    detailAlbedo: formatNumber(selected.albedo, 4),
    detailH: formatNumber(selected.absoluteMagnitudeH, 3),
    detailPeriod: formatWithUnit(selected.orbitalPeriodYears, "yr", 3),
    detailEpoch: formatNumber(selected.epochMjd, 2)
  });
}

function setDetailValues(values) {
  Object.entries(values).forEach(([key, value]) => {
    elements[key].textContent = value;
  });
}

function setStatus(message, type = "info") {
  elements.statusMessage.textContent = message;
  elements.statusMessage.classList.toggle("is-error", type === "error");
  elements.statusMessage.classList.toggle("is-warning", type === "warning");
}

function restoreDefaultStatus() {
  if (state.meta.warning) {
    setStatus(state.meta.warning, "warning");
    return;
  }

  if (state.sampleAsteroids.length > 0) {
    setStatus("Prepared sample loaded. Full-catalog browsing uses the live JPL API.");
    return;
  }

  setStatus("Loading asteroid data...");
}

async function fetchRemoteSearch(query, requestToken) {
  if (requestToken !== state.searchRequestToken) {
    return;
  }

  try {
    const result = await searchAsteroids(query, {
      limit: APP_CONFIG.searchLimitDefault,
      timeoutMs: APP_CONFIG.proxyFetchTimeoutMs
    });

    if (requestToken !== state.searchRequestToken) {
      return;
    }

    const matches = result.asteroids;
    if (matches.length === 0) {
      setStatus(`No matching asteroid found for "${query}".`, "warning");
      return;
    }

    setSelectedAsteroid(matches[0]);
    if (matches.length === 1) {
      setStatus(`Selected ${matches[0].name} from the live JPL search.`);
    } else {
      setStatus(`Selected ${matches[0].name}; ${formatNumber(matches.length, 0)} matches returned by the live JPL search.`);
    }
  } catch (error) {
    if (requestToken !== state.searchRequestToken) {
      return;
    }
    setStatus(`Search endpoint warning: ${error.message}`, "warning");
  }
}

function renderSourceBadge() {
  elements.sourceBadge.textContent = buildSourceBadgeText();
}

function buildSourceBadgeText() {
  const loaded = formatNumber(state.displayAsteroids.length || state.sampleAsteroids.length, 0);
  if (Number.isFinite(state.meta.availableCount) && state.meta.availableCount > 0) {
    return `Source: ${state.meta.source} (${loaded} / ${formatNumber(state.meta.availableCount, 0)} loaded)`;
  }
  return `Source: ${state.meta.source} (${loaded} loaded)`;
}

function getTableTotalPages() {
  return Math.max(1, Math.ceil(state.table.totalCount / state.table.pageSize));
}

function updateSortButtonState() {
  elements.tableSortButtons.forEach((button) => {
    const isActive = button.dataset.sortKey === state.table.sortKey;
    const baseLabel = button.dataset.baseLabel ?? button.textContent.trim();
    button.dataset.baseLabel = baseLabel;
    button.classList.toggle("active", isActive);
    button.textContent = isActive
      ? `${baseLabel} ${state.table.sortDirection === "asc" ? "^" : "v"}`
      : baseLabel;
  });
}

function attachVisualizationResizeObserver() {
  if (typeof ResizeObserver === "undefined") {
    return;
  }

  visualizationResizeObserver?.disconnect();
  visualizationResizeObserver = new ResizeObserver(() => {
    triggerVisualizationRerender();
  });

  [
    elements.sizeChart,
    elements.orbitScatterChart,
    elements.semiMajorAxisChart,
    elements.trueAnomalyChart,
    elements.beltMap
  ].forEach((element) => {
    if (element) {
      visualizationResizeObserver.observe(element);
    }
  });
}

function dedupeAsteroids(records) {
  const byId = new Map();
  for (const record of records) {
    if (record?.id) {
      byId.set(record.id, record);
    }
  }
  return Array.from(byId.values());
}

function debounce(fn, delayMs) {
  let timeoutHandle = null;
  return (...args) => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    timeoutHandle = setTimeout(() => fn(...args), delayMs);
  };
}
