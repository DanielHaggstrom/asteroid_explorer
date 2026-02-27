import assert from "node:assert/strict";
import {
  categorizeDiameterKm,
  classifyBeltZone,
  computeSizeBuckets,
  orbitalPositionFromElements,
  solveKeplerEquation
} from "../src/js/utils.js";

assert.equal(categorizeDiameterKm(null), "Unknown");
assert.equal(categorizeDiameterKm(0.6), "<1 km");
assert.equal(categorizeDiameterKm(2.4), "1-5 km");
assert.equal(categorizeDiameterKm(9.8), "5-20 km");
assert.equal(categorizeDiameterKm(39), ">=20 km");

assert.equal(classifyBeltZone(2.25), "Inner Belt");
assert.equal(classifyBeltZone(2.6), "Middle Belt");
assert.equal(classifyBeltZone(3.1), "Outer Belt");

const buckets = computeSizeBuckets([
  { diameterKm: 0.7 },
  { diameterKm: 3.4 },
  { diameterKm: 14 },
  { diameterKm: 65 },
  { diameterKm: null }
]);
assert.equal(buckets["<1 km"], 1);
assert.equal(buckets["1-5 km"], 1);
assert.equal(buckets["5-20 km"], 1);
assert.equal(buckets[">=20 km"], 1);
assert.equal(buckets.Unknown, 1);

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

console.log("All utility tests passed.");
