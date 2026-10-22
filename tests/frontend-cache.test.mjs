import assert from "node:assert/strict";
import test from "node:test";
import { ResultCache, describeSearchResult } from "../src/js/resultCache.js";

test("browser fallback cache expires promptly while successful live data has normal TTL", () => {
  let now = 0;
  const cache = new ResultCache({ now: () => now });
  const fallback = { meta: { warning: "Prepared sample only" }, asteroids: [] };
  const live = { meta: { source: "JPL" }, asteroids: [] };
  cache.set("fallback", fallback); cache.set("live", live);
  now = 29_999;
  assert.equal(cache.get("fallback"), fallback);
  now = 30_001;
  assert.equal(cache.has("fallback"), false);
  assert.equal(cache.get("live"), live);
  now = 600_001;
  assert.equal(cache.has("live"), false);
});

test("browser result cache bounds entries and evicts least recently used data", () => {
  const cache = new ResultCache({ maxEntries: 2 });
  cache.set("a", { meta: {} }); cache.set("b", { meta: {} });
  assert.ok(cache.get("a"));
  cache.set("c", { meta: {} });
  assert.equal(cache.get("b"), null);
  assert.equal(cache.entries.size, 2);
});

test("search labels identify prepared results without claiming a live lookup", () => {
  const description = describeSearchResult({ asteroids: [{ name: "Ceres" }],
    meta: { source: "Prepared startup sample search", warning: "Live JPL lookup is unavailable." } }, "Ceres");
  assert.match(description.message, /Source: Prepared startup sample search/);
  assert.match(description.message, /Live JPL lookup is unavailable/);
  assert.doesNotMatch(description.message, /from the live JPL search/);
  assert.equal(description.type, "warning");
  const live = describeSearchResult({ asteroids: [{ name: "Ceres" }], meta: { source: "NASA/JPL exact lookup" } }, "Ceres");
  assert.match(live.message, /NASA\/JPL exact lookup/);
  assert.equal(live.type, "info");
});
