import assert from "node:assert/strict";
import {
  categorizeDiameterKm,
  classifyBeltZone,
  computeSizeBuckets,
  orbitalPositionFromElements,
  solveKeplerEquation,
  trueAnomalyDegreesFromElements
} from "../src/js/utils.js";

assert.equal(categorizeDiameterKm(null), "Unknown");
assert.equal(categorizeDiameterKm(0.2), "<0.5 km");
assert.equal(categorizeDiameterKm(0.6), "0.5-1 km");
assert.equal(categorizeDiameterKm(1.3), "1-2 km");
assert.equal(categorizeDiameterKm(3.4), "2-5 km");
assert.equal(categorizeDiameterKm(8.6), "5-10 km");
assert.equal(categorizeDiameterKm(16), "10-20 km");
assert.equal(categorizeDiameterKm(29), "20-50 km");
assert.equal(categorizeDiameterKm(61), ">=50 km");

assert.equal(classifyBeltZone(2.25), "Inner Belt");
assert.equal(classifyBeltZone(2.6), "Middle Belt");
assert.equal(classifyBeltZone(3.1), "Outer Belt");

const buckets = computeSizeBuckets([
  { diameterKm: 0.4 },
  { diameterKm: 0.8 },
  { diameterKm: 1.6 },
  { diameterKm: 3.4 },
  { diameterKm: 8.1 },
  { diameterKm: 14.0 },
  { diameterKm: 36.0 },
  { diameterKm: 65 },
  { diameterKm: null }
]);
assert.equal(buckets["<0.5 km"], 1);
assert.equal(buckets["0.5-1 km"], 1);
assert.equal(buckets["1-2 km"], 1);
assert.equal(buckets["2-5 km"], 1);
assert.equal(buckets["5-10 km"], 1);
assert.equal(buckets["10-20 km"], 1);
assert.equal(buckets["20-50 km"], 1);
assert.equal(buckets[">=50 km"], 1);
assert.equal(buckets.Unknown, 1);

const noUnknownBuckets = computeSizeBuckets(
  [
    { diameterKm: 0.4 },
    { diameterKm: null }
  ],
  { includeUnknown: false }
);
assert.equal(noUnknownBuckets["<0.5 km"], 1);
assert.equal(Object.hasOwn(noUnknownBuckets, "Unknown"), false);

const meanAnomaly = Math.PI / 3;
assert.equal(solveKeplerEquation(meanAnomaly, 0), meanAnomaly);

const position = orbitalPositionFromElements({
  a: 2.5,
  e: 0.08,
  ma: 40,
  om: 80,
  w: 70
});
assert.ok(position !== null);
assert.ok(Number.isFinite(position.x));
assert.ok(Number.isFinite(position.y));
assert.ok(position.radius > 0);

assert.equal(trueAnomalyDegreesFromElements({ e: 0, ma: 40 }), 40);
assert.equal(trueAnomalyDegreesFromElements({ e: 0, ma: 400 }), 40);
assert.equal(trueAnomalyDegreesFromElements({ e: 0.1, ma: null }), null);

console.log("All utility tests passed.");
