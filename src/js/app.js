import { APP_CONFIG } from "./config.js";
import { loadMainBeltAsteroids } from "./dataService.js";
import { drawBarChart, drawBeltMap, drawScatterPlot } from "./charts.js";
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
  beltMap: document.getElementById("beltMap"),
  asteroidTableBody: document.getElementById("asteroidTableBody"),
  tableSummary: document.getElementById("tableSummary"),
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

const state = {
  allAsteroids: [],
  filteredAsteroids: [],
  selectedId: null,
  mapPoints: [],
  filters: {
    query: "",
    zone: "all",
    mapDensity: APP_CONFIG.maxMapPointsDefault
  }
};

attachListeners();
bootstrap();

async function bootstrap() {
  setStatus("Loading official JPL asteroid data...");

  try {
    const result = await loadMainBeltAsteroids({
      maxObjects: APP_CONFIG.maxObjects,
      pageSize: APP_CONFIG.pageSize,
      timeoutMs: APP_CONFIG.fetchTimeoutMs
    });

    state.allAsteroids = result.asteroids;
    state.selectedId = result.asteroids[0]?.id ?? null;
    elements.sourceBadge.textContent = `Source: ${result.meta.source} (${formatNumber(result.meta.loadedCount, 0)} loaded)`;
    if (result.meta.warning) {
      setStatus(result.meta.warning, "warning");
    } else {
      setStatus("Data loaded.");
    }
    applyFiltersAndRender();
  } catch (error) {
    elements.sourceBadge.textContent = "Source: unavailable";
    setStatus(`Failed to load data: ${error.message}`, true);
    state.allAsteroids = [];
    state.filteredAsteroids = [];
    state.selectedId = null;
    renderAll();
  }
}

function attachListeners() {
  elements.searchInput.addEventListener("input", (event) => {
    state.filters.query = event.target.value.trim().toLowerCase();
    applyFiltersAndRender();
  });

  elements.zoneSelect.addEventListener("change", (event) => {
    state.filters.zone = event.target.value;
    applyFiltersAndRender();
  });

  elements.mapDensityRange.addEventListener("input", (event) => {
    const density = Number(event.target.value);
    state.filters.mapDensity = Number.isFinite(density) ? density : APP_CONFIG.maxMapPointsDefault;
    elements.mapDensityValue.textContent = String(state.filters.mapDensity);
    renderVisualizations();
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

  window.addEventListener("resize", debounce(() => renderVisualizations(), 140));
}

function applyFiltersAndRender() {
  state.filteredAsteroids = state.allAsteroids.filter((asteroid) => {
    const zoneMatches = state.filters.zone === "all" || asteroid.zone === state.filters.zone;
    if (!zoneMatches) {
      return false;
    }

    if (!state.filters.query) {
      return true;
    }

    const target = `${asteroid.name} ${asteroid.id}`.toLowerCase();
    return target.includes(state.filters.query);
  });

  const selectedStillVisible = state.filteredAsteroids.some((item) => item.id === state.selectedId);
  if (!selectedStillVisible) {
    state.selectedId = state.filteredAsteroids[0]?.id ?? null;
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
  const records = state.filteredAsteroids;
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
  drawBarChart(elements.sizeChart, computeSizeBuckets(state.filteredAsteroids));
  drawScatterPlot(elements.orbitScatterChart, state.filteredAsteroids);
  state.mapPoints = drawBeltMap(
    elements.beltMap,
    state.filteredAsteroids,
    state.selectedId,
    state.filters.mapDensity
  );
}

function renderTable() {
  const rows = state.filteredAsteroids.slice(0, APP_CONFIG.maxTableRows);
  const rowElements = rows.map((asteroid) => createRow(asteroid));
  elements.asteroidTableBody.replaceChildren(...rowElements);

  elements.tableSummary.textContent =
    `Showing ${formatNumber(rows.length, 0)} of ${formatNumber(state.filteredAsteroids.length, 0)} filtered ` +
    `objects (${formatNumber(state.allAsteroids.length, 0)} loaded total).`;
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

function debounce(fn, delayMs) {
  let timeoutHandle = null;
  return (...args) => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    timeoutHandle = setTimeout(() => fn(...args), delayMs);
  };
}
