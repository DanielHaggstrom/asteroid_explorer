export const DIAMETER_BUCKETS = Object.freeze([
  "<0.5 km",
  "0.5-1 km",
  "1-2 km",
  "2-5 km",
  "5-10 km",
  "10-20 km",
  "20-50 km",
  ">=50 km",
  "Unknown"
]);

export const ZONE_NAMES = Object.freeze([
  "Inner Belt",
  "Middle Belt",
  "Outer Belt"
]);

export function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function formatNumber(value, maxFractionDigits = 3) {
  if (!Number.isFinite(value)) {
    return "Unknown";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: maxFractionDigits
  }).format(value);
}

export function formatWithUnit(value, unit, maxFractionDigits = 3) {
  if (!Number.isFinite(value)) {
    return "Unknown";
  }

  return `${formatNumber(value, maxFractionDigits)} ${unit}`;
}

export function average(values) {
  const valid = values.filter((item) => Number.isFinite(item));
  if (!valid.length) {
    return null;
  }

  const total = valid.reduce((sum, current) => sum + current, 0);
  return total / valid.length;
}

export function periodYearsFromSemiMajorAxis(a) {
  if (!Number.isFinite(a) || a <= 0) {
    return null;
  }

  return Math.sqrt(a ** 3);
}

export function categorizeDiameterKm(diameterKm) {
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

export function computeSizeBuckets(asteroids, options = {}) {
  const includeUnknown = options.includeUnknown ?? true;
  const labels = includeUnknown ? DIAMETER_BUCKETS : DIAMETER_BUCKETS.filter((label) => label !== "Unknown");
  const buckets = Object.fromEntries(labels.map((label) => [label, 0]));

  for (const asteroid of asteroids) {
    const bucket = categorizeDiameterKm(asteroid.diameterKm);
    if (bucket === "Unknown" && !includeUnknown) {
      continue;
    }
    buckets[bucket] += 1;
  }

  return buckets;
}

export function classifyBeltZone(semiMajorAxisAu) {
  if (!Number.isFinite(semiMajorAxisAu)) {
    return "Unknown";
  }
  if (semiMajorAxisAu < 2.5) {
    return "Inner Belt";
  }
  if (semiMajorAxisAu < 2.82) {
    return "Middle Belt";
  }
  return "Outer Belt";
}

export function dominantZone(asteroids) {
  const counts = new Map(ZONE_NAMES.map((zone) => [zone, 0]));

  for (const asteroid of asteroids) {
    const zone = classifyBeltZone(asteroid.a);
    if (counts.has(zone)) {
      counts.set(zone, counts.get(zone) + 1);
    }
  }

  let winner = "Unknown";
  let winnerCount = -1;
  for (const [zone, count] of counts.entries()) {
    if (count > winnerCount) {
      winner = zone;
      winnerCount = count;
    }
  }
  return winner;
}

export function solveKeplerEquation(meanAnomalyRad, eccentricity, maxIterations = 22, epsilon = 1e-8) {
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

export function orbitalPositionFromElements(elements) {
  const { a, e, ma, om, w } = elements;
  if (!Number.isFinite(a) || !Number.isFinite(e) || !Number.isFinite(ma)) {
    return null;
  }

  const meanAnomaly = degreesToRadians(normalizeAngleDegrees(ma));
  const eccentricAnomaly = solveKeplerEquation(meanAnomaly, e);
  if (!Number.isFinite(eccentricAnomaly)) {
    return null;
  }

  const radius = a * (1 - e * Math.cos(eccentricAnomaly));
  const trueAnomaly = 2 * Math.atan2(
    Math.sqrt(1 + e) * Math.sin(eccentricAnomaly / 2),
    Math.sqrt(1 - e) * Math.cos(eccentricAnomaly / 2)
  );

  const longitude = degreesToRadians(normalizeAngleDegrees((om ?? 0) + (w ?? 0))) + trueAnomaly;
  return {
    x: radius * Math.cos(longitude),
    y: radius * Math.sin(longitude),
    radius
  };
}

export function trueAnomalyDegreesFromElements(elements) {
  const { e, ma } = elements;
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

export function findNearestPoint(points, x, y, maxDistance) {
  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const point of points) {
    const dx = point.x - x;
    const dy = point.y - y;
    const distance = Math.hypot(dx, dy);
    if (distance <= maxDistance && distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }

  return nearest;
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
