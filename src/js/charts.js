import {
  clamp,
  classifyBeltZone,
  orbitalPositionFromElements,
  trueAnomalyDegreesFromElements
} from "./utils.js";

const FONT_FAMILY = '"Trebuchet MS", Verdana, sans-serif';
const RESONANCE_MARKERS = Object.freeze([
  { a: 2.5, label: "3:1" },
  { a: 2.82, label: "5:2" },
  { a: 2.96, label: "7:3" },
  { a: 3.27, label: "2:1" }
]);

export function drawBarChart(canvas, buckets) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) {
    return;
  }

  const { ctx, width, height } = prepared;
  const compactMode = width < 460;
  const crampedMode = width < 360;
  const labels = Object.keys(buckets).map((label) => compactMode ? shortenBucketLabel(label) : label);
  const values = Object.values(buckets);
  const maxValue = Math.max(...values, 1);

  if (!labels.length) {
    drawNoDataLabel(ctx, width, height, "No size data");
    return;
  }

  const margin = compactMode
    ? { top: 20, right: 8, bottom: crampedMode ? 88 : 80, left: crampedMode ? 40 : 46 }
    : { top: 24, right: 14, bottom: 72, left: 56 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  if (plotWidth <= 0 || plotHeight <= 0) {
    drawNoDataLabel(ctx, width, height, "Chart sizing pending");
    return;
  }
  const barWidth = plotWidth / labels.length;
  const palette = ["#2e8a80", "#4098a2", "#58a4b8", "#6da7c5", "#88a2c7", "#b69dc5", "#d38f8d", "#c2572f", "#9b8d78"];
  const rotateLabels = labels.length > 6 || compactMode;
  const labelFontSize = crampedMode ? 10 : 11;

  drawAxes(ctx, margin.left, margin.top, plotWidth, plotHeight);
  drawYAxisTicks(ctx, margin.left, margin.top, plotHeight, maxValue);

  labels.forEach((label, index) => {
    const value = values[index];
    const barHeight = (value / maxValue) * plotHeight;
    const x = margin.left + index * barWidth + 2;
    const y = margin.top + plotHeight - barHeight;
    const widthPerBar = Math.max(crampedMode ? 6 : 8, barWidth - (compactMode ? 2 : 4));

    ctx.fillStyle = palette[index % palette.length];
    ctx.fillRect(x, y, widthPerBar, barHeight);

    ctx.fillStyle = "#354757";
    ctx.font = `${labelFontSize}px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    if (!compactMode) {
      ctx.fillText(String(value), x + widthPerBar / 2, y - 6);
    }

    if (rotateLabels) {
      ctx.save();
      ctx.translate(x + widthPerBar / 2, height - (crampedMode ? 16 : 18));
      ctx.rotate(-(compactMode ? Math.PI / 3.4 : Math.PI / 5));
      ctx.textAlign = "right";
      ctx.fillText(label, 0, 0);
      ctx.restore();
    } else {
      ctx.fillText(label, x + widthPerBar / 2, height - 18);
    }
  });

  ctx.fillStyle = "#4a5d6f";
  ctx.font = `12px ${FONT_FAMILY}`;
  ctx.textAlign = "left";
  ctx.fillText("Objects", compactMode ? 6 : 8, margin.top + 6);
}

export function drawScatterPlot(canvas, asteroids) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) {
    return;
  }

  const { ctx, width, height } = prepared;
  const points = asteroids.filter((item) => Number.isFinite(item.a) && Number.isFinite(item.e) && Number.isFinite(item.i));
  if (!points.length) {
    drawNoDataLabel(ctx, width, height, "No orbital data");
    return;
  }

  const renderPoints = downsampleAsteroids(points, 7000);
  const margin = { top: 24, right: 16, bottom: 44, left: 50 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const minA = 2.0;
  const maxA = 3.5;
  const minE = 0.0;
  const maxE = 0.38;

  drawAxes(ctx, margin.left, margin.top, plotWidth, plotHeight);
  drawScatterTicks(ctx, margin.left, margin.top, plotWidth, plotHeight, minA, maxA, minE, maxE);
  drawResonanceGuides(ctx, margin.left, margin.top, plotWidth, plotHeight, minA, maxA);

  for (const asteroid of renderPoints) {
    if (asteroid.a < minA || asteroid.a > maxA || asteroid.e < minE || asteroid.e > maxE) {
      continue;
    }

    const x = margin.left + ((asteroid.a - minA) / (maxA - minA)) * plotWidth;
    const y = margin.top + plotHeight - ((asteroid.e - minE) / (maxE - minE)) * plotHeight;
    const hue = 208 - clamp(asteroid.i, 0, 30) * 4.4;

    ctx.fillStyle = `hsla(${hue}, 68%, 46%, 0.58)`;
    ctx.beginPath();
    ctx.arc(x, y, 1.85, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#44586b";
  ctx.font = `12px ${FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.fillText("Semi-major axis (AU)", margin.left + plotWidth / 2, height - 10);

  ctx.save();
  ctx.translate(14, margin.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText("Eccentricity", 0, 0);
  ctx.restore();
}

export function drawSemiMajorAxisHistogram(canvas, asteroids) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) {
    return;
  }

  const { ctx, width, height } = prepared;
  const minA = 2.0;
  const maxA = 3.5;
  const binCount = 56;
  const bins = new Array(binCount).fill(0);

  for (const asteroid of asteroids) {
    if (!Number.isFinite(asteroid.a) || asteroid.a < minA || asteroid.a > maxA) {
      continue;
    }
    const ratio = (asteroid.a - minA) / (maxA - minA);
    const binIndex = Math.min(binCount - 1, Math.floor(ratio * binCount));
    bins[binIndex] += 1;
  }

  drawHistogram(
    ctx,
    width,
    height,
    bins,
    minA,
    maxA,
    "Semi-major axis (AU)",
    "Objects / bin",
    RESONANCE_MARKERS
  );

  ctx.fillStyle = "#4f6276";
  ctx.font = `11px ${FONT_FAMILY}`;
  ctx.textAlign = "left";
  ctx.fillText("Dips near dashed lines indicate Kirkwood gaps.", 10, 16);
}

export function drawTrueAnomalyHistogram(canvas, asteroids) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) {
    return;
  }

  const { ctx, width, height } = prepared;
  const binCount = 24;
  const bins = new Array(binCount).fill(0);
  let total = 0;

  for (const asteroid of asteroids) {
    const trueAnomalyDeg = trueAnomalyDegreesFromElements(asteroid);
    if (!Number.isFinite(trueAnomalyDeg)) {
      continue;
    }
    const normalized = ((trueAnomalyDeg % 360) + 360) % 360;
    const index = Math.min(binCount - 1, Math.floor((normalized / 360) * binCount));
    bins[index] += 1;
    total += 1;
  }

  const margin = { top: 24, right: 16, bottom: 44, left: 52 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...bins, 1);
  const barWidth = plotWidth / binCount;

  drawAxes(ctx, margin.left, margin.top, plotWidth, plotHeight);
  drawYAxisTicks(ctx, margin.left, margin.top, plotHeight, maxValue);

  for (let index = 0; index < binCount; index += 1) {
    const value = bins[index];
    const barHeight = (value / maxValue) * plotHeight;
    const x = margin.left + index * barWidth + 0.5;
    const y = margin.top + plotHeight - barHeight;
    const hue = 188 + (index / binCount) * 40;
    ctx.fillStyle = `hsla(${hue}, 66%, 47%, 0.72)`;
    ctx.fillRect(x, y, Math.max(1, barWidth - 1), barHeight);
  }

  drawXTicks(ctx, margin.left, margin.top, plotWidth, plotHeight, 0, 360, 6, "deg");

  if (total > 0) {
    const expected = total / binCount;
    const y = margin.top + plotHeight - (expected / maxValue) * plotHeight;
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "rgba(148, 64, 37, 0.85)";
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(margin.left + plotWidth, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#7a3f2a";
    ctx.font = `11px ${FONT_FAMILY}`;
    ctx.textAlign = "left";
    ctx.fillText("Uniform reference", margin.left + 8, y - 6);
  }

  ctx.fillStyle = "#44586b";
  ctx.font = `12px ${FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.fillText("True anomaly (deg)", margin.left + plotWidth / 2, height - 10);
}

export function drawBeltMap(canvas, asteroids, selectedId, maxPoints) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) {
    return [];
  }

  const { ctx, width, height } = prepared;
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadiusAu = 3.5;
  const pxPerAu = (Math.min(width, height) * 0.43) / maxRadiusAu;

  ctx.fillStyle = "rgba(14, 35, 49, 0.04)";
  ctx.fillRect(0, 0, width, height);

  const guideRings = [2.2, 2.5, 2.82, 3.2];
  ctx.strokeStyle = "rgba(86, 93, 112, 0.38)";
  ctx.setLineDash([4, 4]);
  guideRings.forEach((au) => {
    ctx.beginPath();
    ctx.arc(centerX, centerY, au * pxPerAu, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  ctx.fillStyle = "#ff9f2e";
  ctx.beginPath();
  ctx.arc(centerX, centerY, 7, 0, Math.PI * 2);
  ctx.fill();

  const subset = downsampleAsteroids(asteroids, maxPoints);
  const projectedPoints = [];
  for (const asteroid of subset) {
    const position = orbitalPositionFromElements(asteroid);
    if (!position) {
      continue;
    }

    const x = centerX + position.x * pxPerAu;
    const y = centerY + position.y * pxPerAu;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }

    const zone = classifyBeltZone(asteroid.a);
    const color = zoneColor(zone);
    const isSelected = asteroid.id === selectedId;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, isSelected ? 4 : 2.2, 0, Math.PI * 2);
    ctx.fill();

    if (isSelected) {
      ctx.strokeStyle = "#b7351c";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 7.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    projectedPoints.push({ id: asteroid.id, x, y });
  }

  ctx.fillStyle = "#4d6175";
  ctx.font = `12px ${FONT_FAMILY}`;
  ctx.textAlign = "left";
  ctx.fillText(`Showing ${projectedPoints.length} objects`, 12, 18);
  return projectedPoints;
}

function drawHistogram(ctx, width, height, bins, minX, maxX, xLabel, yLabel, markers = []) {
  const margin = { top: 24, right: 16, bottom: 44, left: 52 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...bins, 1);
  const barWidth = plotWidth / bins.length;

  drawAxes(ctx, margin.left, margin.top, plotWidth, plotHeight);
  drawYAxisTicks(ctx, margin.left, margin.top, plotHeight, maxValue);

  for (let index = 0; index < bins.length; index += 1) {
    const value = bins[index];
    const barHeight = (value / maxValue) * plotHeight;
    const x = margin.left + index * barWidth + 0.4;
    const y = margin.top + plotHeight - barHeight;
    ctx.fillStyle = "rgba(53, 138, 125, 0.78)";
    ctx.fillRect(x, y, Math.max(1, barWidth - 0.8), barHeight);
  }

  drawXTicks(ctx, margin.left, margin.top, plotWidth, plotHeight, minX, maxX, 6, "");
  drawMarkers(ctx, margin.left, margin.top, plotWidth, plotHeight, minX, maxX, markers);

  ctx.fillStyle = "#44586b";
  ctx.font = `12px ${FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.fillText(xLabel, margin.left + plotWidth / 2, height - 10);

  ctx.save();
  ctx.translate(14, margin.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
}

function drawAxes(ctx, x, y, width, height) {
  ctx.strokeStyle = "#a6acb6";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x + width, y + height);
  ctx.stroke();
}

function drawScatterTicks(ctx, x, y, width, height, minA, maxA, minE, maxE) {
  ctx.font = `11px ${FONT_FAMILY}`;
  ctx.fillStyle = "#5e7081";
  ctx.strokeStyle = "rgba(166, 172, 182, 0.35)";
  ctx.textAlign = "center";

  const aTicks = 5;
  for (let index = 0; index <= aTicks; index += 1) {
    const ratio = index / aTicks;
    const tickX = x + ratio * width;
    const value = minA + ratio * (maxA - minA);
    ctx.fillText(value.toFixed(2), tickX, y + height + 16);
    ctx.beginPath();
    ctx.moveTo(tickX, y + height);
    ctx.lineTo(tickX, y + height - 6);
    ctx.stroke();
  }

  ctx.textAlign = "right";
  const eTicks = 5;
  for (let index = 0; index <= eTicks; index += 1) {
    const ratio = index / eTicks;
    const tickY = y + height - ratio * height;
    const value = minE + ratio * (maxE - minE);
    ctx.fillText(value.toFixed(2), x - 8, tickY + 3);
    ctx.beginPath();
    ctx.moveTo(x, tickY);
    ctx.lineTo(x + 6, tickY);
    ctx.stroke();
  }
}

function drawXTicks(ctx, x, y, width, height, minValue, maxValue, tickCount, suffix) {
  ctx.font = `11px ${FONT_FAMILY}`;
  ctx.fillStyle = "#5e7081";
  ctx.strokeStyle = "rgba(166, 172, 182, 0.35)";
  ctx.textAlign = "center";

  for (let index = 0; index <= tickCount; index += 1) {
    const ratio = index / tickCount;
    const tickX = x + ratio * width;
    const value = minValue + ratio * (maxValue - minValue);
    const label = suffix ? `${Math.round(value)} ${suffix}` : value.toFixed(2);
    ctx.fillText(label, tickX, y + height + 16);
    ctx.beginPath();
    ctx.moveTo(tickX, y + height);
    ctx.lineTo(tickX, y + height - 6);
    ctx.stroke();
  }
}

function drawYAxisTicks(ctx, x, y, height, maxValue) {
  ctx.font = `11px ${FONT_FAMILY}`;
  ctx.fillStyle = "#5e7081";
  ctx.strokeStyle = "rgba(166, 172, 182, 0.35)";
  ctx.textAlign = "right";

  const yTicks = 5;
  for (let index = 0; index <= yTicks; index += 1) {
    const ratio = index / yTicks;
    const tickY = y + height - ratio * height;
    const value = Math.round(ratio * maxValue);
    ctx.fillText(String(value), x - 8, tickY + 3);
    ctx.beginPath();
    ctx.moveTo(x, tickY);
    ctx.lineTo(x + 6, tickY);
    ctx.stroke();
  }
}

function drawMarkers(ctx, x, y, width, height, minValue, maxValue, markers) {
  for (const marker of markers) {
    if (marker.a < minValue || marker.a > maxValue) {
      continue;
    }

    const markerX = x + ((marker.a - minValue) / (maxValue - minValue)) * width;
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = "rgba(150, 69, 42, 0.72)";
    ctx.beginPath();
    ctx.moveTo(markerX, y);
    ctx.lineTo(markerX, y + height);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#7d402b";
    ctx.font = `10px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.fillText(marker.label, markerX, y + 12);
  }
}

function drawResonanceGuides(ctx, x, y, width, height, minA, maxA) {
  drawMarkers(ctx, x, y, width, height, minA, maxA, RESONANCE_MARKERS);
}

function drawNoDataLabel(ctx, width, height, message) {
  ctx.fillStyle = "#587086";
  ctx.font = `600 15px ${FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.fillText(message, width / 2, height / 2);
}

function shortenBucketLabel(label) {
  const shortLabels = {
    "<0.5 km": "<0.5",
    "0.5-1 km": "0.5-1",
    "1-2 km": "1-2",
    "2-5 km": "2-5",
    "5-10 km": "5-10",
    "10-20 km": "10-20",
    "20-50 km": "20-50",
    ">=50 km": "50+"
  };
  return shortLabels[label] ?? label;
}

function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  return { ctx, width: rect.width, height: rect.height };
}

function downsampleAsteroids(asteroids, maxPoints) {
  if (asteroids.length <= maxPoints) {
    return asteroids;
  }

  const step = asteroids.length / maxPoints;
  const output = [];
  for (let index = 0; index < maxPoints; index += 1) {
    output.push(asteroids[Math.floor(index * step)]);
  }
  return output;
}

function zoneColor(zone) {
  if (zone === "Inner Belt") {
    return "rgba(12, 125, 120, 0.75)";
  }
  if (zone === "Middle Belt") {
    return "rgba(232, 143, 42, 0.75)";
  }
  return "rgba(181, 52, 31, 0.75)";
}
