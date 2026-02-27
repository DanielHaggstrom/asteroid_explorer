import { clamp, classifyBeltZone, orbitalPositionFromElements } from "./utils.js";

const FONT_FAMILY = '"Trebuchet MS", Verdana, sans-serif';

export function drawBarChart(canvas, buckets) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) {
    return;
  }

  const { ctx, width, height } = prepared;
  const labels = Object.keys(buckets);
  const values = Object.values(buckets);
  const maxValue = Math.max(...values, 1);

  if (!labels.length) {
    drawNoDataLabel(ctx, width, height, "No size data");
    return;
  }

  const margin = { top: 24, right: 18, bottom: 48, left: 52 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const barWidth = plotWidth / labels.length;
  const palette = ["#3f9a86", "#5a8fbe", "#e49b30", "#c2572f", "#9b8d78"];

  drawAxes(ctx, margin.left, margin.top, plotWidth, plotHeight);

  labels.forEach((label, index) => {
    const value = values[index];
    const barHeight = (value / maxValue) * plotHeight;
    const x = margin.left + index * barWidth + 8;
    const y = margin.top + plotHeight - barHeight;
    const widthPerBar = Math.max(20, barWidth - 14);

    ctx.fillStyle = palette[index % palette.length];
    ctx.fillRect(x, y, widthPerBar, barHeight);

    ctx.fillStyle = "#354757";
    ctx.font = `11px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.fillText(label, x + widthPerBar / 2, height - 18);
    ctx.fillText(String(value), x + widthPerBar / 2, y - 6);
  });

  ctx.fillStyle = "#4a5d6f";
  ctx.font = `12px ${FONT_FAMILY}`;
  ctx.textAlign = "left";
  ctx.fillText("Objects", 8, margin.top + 6);
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

  const margin = { top: 22, right: 16, bottom: 44, left: 50 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const minA = 2.0;
  const maxA = 3.5;
  const minE = 0.0;
  const maxE = 0.38;

  drawAxes(ctx, margin.left, margin.top, plotWidth, plotHeight);
  drawScatterTicks(ctx, margin.left, margin.top, plotWidth, plotHeight, minA, maxA, minE, maxE);

  for (const asteroid of points) {
    if (asteroid.a < minA || asteroid.a > maxA || asteroid.e < minE || asteroid.e > maxE) {
      continue;
    }

    const x = margin.left + ((asteroid.a - minA) / (maxA - minA)) * plotWidth;
    const y = margin.top + plotHeight - ((asteroid.e - minE) / (maxE - minE)) * plotHeight;
    const hue = 208 - clamp(asteroid.i, 0, 30) * 4.4;

    ctx.fillStyle = `hsla(${hue}, 68%, 46%, 0.62)`;
    ctx.beginPath();
    ctx.arc(x, y, 2.1, 0, Math.PI * 2);
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

function drawNoDataLabel(ctx, width, height, message) {
  ctx.fillStyle = "#587086";
  ctx.font = `600 15px ${FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.fillText(message, width / 2, height / 2);
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
