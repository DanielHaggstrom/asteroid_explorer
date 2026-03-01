import { APP_CONFIG } from "./config.js";
import { loadMainBeltAsteroids } from "./dataService.js";
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

const REMOTE_SEARCH_MIN_QUERY_LENGTH = 2;
const REMOTE_SEARCH_LIMIT = 25;
let visualizationResizeObserver = null;

const state = {
  allAsteroids: [],
  zoneFilteredAsteroids: [],
  filteredAsteroids: [],
  selectedId: null,
  mapPoints: [],
  searchRequestToken: 0,
  filters: {
    query: "",
    zone: "all",
    mapDensity: APP_CONFIG.maxMapPointsDefault
  },
  table: {
    diameterFilter: "all",
    minDiameterKm: null,
    pageSize: APP_CONFIG.tablePageSizeDefault,
    page: 1,
    sortKey: "name",
    sortDirection: "asc"
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
  setStatus("Loading official JPL asteroid data...");

  try {
    const result = await loadMainBeltAsteroids({
      proxyTimeoutMs: APP_CONFIG.proxyFetchTimeoutMs
    });

    state.allAsteroids = result.asteroids;
    state.selectedId = result.asteroids[0]?.id ?? null;
    elements.sourceBadge.textContent = buildSourceBadgeText(result.meta);
    if (result.meta.warning) {
      setStatus(result.meta.warning, "warning");
    } else {
      setStatus("Data loaded.");
    }
    applyFiltersAndRender();
    requestAnimationFrame(() => renderVisualizations());
  } catch (error) {
    elements.sourceBadge.textContent = "Source: unavailable";
    setStatus(`Failed to load data: ${error.message}`, true);
    state.allAsteroids = [];
    state.zoneFilteredAsteroids = [];
    state.filteredAsteroids = [];
    state.selectedId = null;
    renderAll();
  }
}

function attachListeners() {
  elements.searchInput.addEventListener("input", (event) => {
    state.filters.query = event.target.value.trim().toLowerCase();
    const requestToken = ++state.searchRequestToken;
    state.table.page = 1;
    applyFiltersAndRender();
    if (state.filters.query.length >= REMOTE_SEARCH_MIN_QUERY_LENGTH) {
      triggerRemoteSearch(state.filters.query, requestToken);
    }
  });

  elements.zoneSelect.addEventListener("change", (event) => {
    state.filters.zone = event.target.value;
    state.table.page = 1;
    applyFiltersAndRender();
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
    renderTable();
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
    renderTable();
  });

  elements.tablePageSize.addEventListener("change", (event) => {
    const value = Number(event.target.value);
    state.table.pageSize = Number.isFinite(value) && value > 0 ? value : APP_CONFIG.tablePageSizeDefault;
    state.table.page = 1;
    renderTable();
  });

  elements.tablePrevPage.addEventListener("click", () => {
    if (state.table.page > 1) {
      state.table.page -= 1;
      renderTable();
    }
  });

  elements.tableNextPage.addEventListener("click", () => {
    const totalPages = getTableTotalPages();
    if (state.table.page < totalPages) {
      state.table.page += 1;
      renderTable();
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
      renderTable();
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

    state.selectedId = nearest.id;
    renderDetails();
    renderTable();
    renderVisualizations();
  });

  attachVisualizationResizeObserver();
  window.addEventListener("resize", triggerVisualizationRerender);
}

function applyFiltersAndRender() {
  state.zoneFilteredAsteroids = state.allAsteroids.filter(
    (asteroid) => state.filters.zone === "all" || asteroid.zone === state.filters.zone
  );

  if (state.filters.query) {
    state.filteredAsteroids = state.allAsteroids.filter((asteroid) =>
      matchesSearchQuery(asteroid, state.filters.query)
    );
  } else {
    state.filteredAsteroids = state.zoneFilteredAsteroids;
  }

  if (state.filters.query) {
    if (state.filteredAsteroids.length > 0) {
      const selectedStillVisible = state.filteredAsteroids.some((item) => item.id === state.selectedId);
      if (!selectedStillVisible) {
        state.selectedId = state.filteredAsteroids[0]?.id ?? null;
      }
    } else if (!state.zoneFilteredAsteroids.some((item) => item.id === state.selectedId)) {
      state.selectedId = state.zoneFilteredAsteroids[0]?.id ?? null;
    }
  } else if (!state.zoneFilteredAsteroids.some((item) => item.id === state.selectedId)) {
    state.selectedId = state.zoneFilteredAsteroids[0]?.id ?? null;
  }

  renderAll();
}

function renderAll() {
  renderKpis();
  renderVisualizations();
  renderTable();
  renderDetails();
}

function renderKpis() {
  const records = state.zoneFilteredAsteroids;
  const total = records.length;
  const withDiameter = records.filter((item) => Number.isFinite(item.diameterKm));
  const meanDiameter = average(withDiameter.map((item) => item.diameterKm));
  const meanEccentricity = average(records.map((item) => item.e));

  elements.kpiTotal.textContent = formatNumber(total, 0);
  elements.kpiDiameterCoverage.textContent = `${formatNumber(withDiameter.length, 0)} / ${formatNumber(total, 0)}`;
  elements.kpiMeanDiameter.textContent = formatWithUnit(meanDiameter, "km", 2);
  elements.kpiMeanEccentricity.textContent = formatNumber(meanEccentricity, 4);
  elements.kpiDominantZone.textContent = dominantZone(records);
}

function renderVisualizations() {
  drawBarChart(elements.sizeChart, computeSizeBuckets(state.zoneFilteredAsteroids, { includeUnknown: false }));
  drawScatterPlot(elements.orbitScatterChart, state.zoneFilteredAsteroids);
  drawSemiMajorAxisHistogram(elements.semiMajorAxisChart, state.zoneFilteredAsteroids);
  drawTrueAnomalyHistogram(elements.trueAnomalyChart, state.zoneFilteredAsteroids);
  state.mapPoints = drawBeltMap(
    elements.beltMap,
    state.zoneFilteredAsteroids,
    state.selectedId,
    state.filters.mapDensity
  );
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

function renderTable() {
  const sortedRows = getTableRows();
  const pageSize = state.table.pageSize;
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  if (state.table.page > totalPages) {
    state.table.page = totalPages;
  }
  const pageStartIndex = (state.table.page - 1) * pageSize;
  const pageRows = sortedRows.slice(pageStartIndex, pageStartIndex + pageSize);

  const rowElements = pageRows.map((asteroid) => createRow(asteroid));
  elements.asteroidTableBody.replaceChildren(...rowElements);

  const pageEndIndex = pageStartIndex + pageRows.length;
  const rangeLabel = sortedRows.length
    ? `${formatNumber(pageStartIndex + 1, 0)}-${formatNumber(pageEndIndex, 0)}`
    : "0-0";
  elements.tableSummary.textContent =
    `Rows ${rangeLabel} of ${formatNumber(sortedRows.length, 0)} table matches ` +
    `(${formatNumber(state.zoneFilteredAsteroids.length, 0)} zone-filtered, ` +
    `${formatNumber(state.filteredAsteroids.length, 0)} search-matched, ` +
    `${formatNumber(state.allAsteroids.length, 0)} loaded).`;

  elements.tablePageIndicator.textContent = `Page ${formatNumber(state.table.page, 0)} / ${formatNumber(totalPages, 0)}`;
  elements.tablePrevPage.disabled = state.table.page <= 1;
  elements.tableNextPage.disabled = state.table.page >= totalPages;
  updateSortButtonState();
}

function createRow(asteroid) {
  const row = document.createElement("tr");
  if (asteroid.id === state.selectedId) {
    row.classList.add("selected");
  }
  row.addEventListener("click", () => {
    state.selectedId = asteroid.id;
    renderDetails();
    renderTable();
    renderVisualizations();
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

function getTableRows() {
  const baseRows = state.filters.query ? state.filteredAsteroids : state.zoneFilteredAsteroids;
  const filtered = baseRows.filter((asteroid) => {
    if (state.table.diameterFilter === "known" && !Number.isFinite(asteroid.diameterKm)) {
      return false;
    }
    if (state.table.diameterFilter === "unknown" && Number.isFinite(asteroid.diameterKm)) {
      return false;
    }
    if (Number.isFinite(state.table.minDiameterKm) && (!Number.isFinite(asteroid.diameterKm) || asteroid.diameterKm < state.table.minDiameterKm)) {
      return false;
    }
    return true;
  });

  const direction = state.table.sortDirection === "desc" ? -1 : 1;
  const sortKey = state.table.sortKey;
  return filtered.slice().sort((left, right) => compareBySortKey(left, right, sortKey) * direction);
}

function compareBySortKey(left, right, sortKey) {
  const leftValue = left[sortKey];
  const rightValue = right[sortKey];

  if (sortKey === "name" || sortKey === "zone") {
    return String(leftValue ?? "").localeCompare(String(rightValue ?? ""));
  }

  const safeLeft = Number.isFinite(leftValue) ? leftValue : Number.NEGATIVE_INFINITY;
  const safeRight = Number.isFinite(rightValue) ? rightValue : Number.NEGATIVE_INFINITY;
  return safeLeft - safeRight;
}

function getTableTotalPages() {
  const totalRows = getTableRows().length;
  return Math.max(1, Math.ceil(totalRows / state.table.pageSize));
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

function renderDetails() {
  const selected = state.allAsteroids.find((item) => item.id === state.selectedId);
  if (!selected) {
    setDetailValues({
      detailName: "No selection",
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
  const normalizedType = type === true ? "error" : type;
  elements.statusMessage.classList.toggle("is-error", normalizedType === "error");
  elements.statusMessage.classList.toggle("is-warning", normalizedType === "warning");
}

async function fetchRemoteSearch(query, requestToken) {
  if (requestToken !== state.searchRequestToken || query !== state.filters.query) {
    return;
  }

  try {
    const params = new URLSearchParams({
      q: query,
      limit: String(REMOTE_SEARCH_LIMIT)
    });
    const response = await fetch(`/api/search?${params.toString()}`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      throw new Error(`search status ${response.status}`);
    }

    const payload = await response.json();
    if (requestToken !== state.searchRequestToken || query !== state.filters.query) {
      return;
    }

    const remoteAsteroids = Array.isArray(payload.asteroids) ? payload.asteroids : [];
    if (remoteAsteroids.length > 0) {
      state.allAsteroids = mergeAsteroids(state.allAsteroids, remoteAsteroids);
      applyFiltersAndRender();
    }
  } catch (error) {
    if (requestToken !== state.searchRequestToken || query !== state.filters.query) {
      return;
    }
    setStatus(`Search endpoint warning: ${error.message}`, "warning");
  }
}

function mergeAsteroids(baseAsteroids, incomingAsteroids) {
  const mergedById = new Map(baseAsteroids.map((item) => [item.id, item]));
  for (const asteroid of incomingAsteroids) {
    if (asteroid && asteroid.id) {
      mergedById.set(asteroid.id, asteroid);
    }
  }
  return Array.from(mergedById.values());
}

function matchesSearchQuery(asteroid, query) {
  const target = [asteroid.name, asteroid.id, asteroid.primaryDesignation]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return target.includes(query);
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

function buildSourceBadgeText(meta) {
  const loaded = formatNumber(meta.loadedCount, 0);
  if (Number.isFinite(meta.availableCount) && meta.availableCount > 0) {
    const available = formatNumber(meta.availableCount, 0);
    return `Source: ${meta.source} (${loaded} / ${available} loaded)`;
  }
  return `Source: ${meta.source} (${loaded} loaded)`;
}

