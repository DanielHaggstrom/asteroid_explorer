import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApplication } from "../server.mjs";
import { ApiLimiter } from "../lib/resource-limits.mjs";
import { createJplClient } from "../lib/jpl-client.mjs";

const records = [
  { id: "1", name: "Alpha", primaryDesignation: "1", zone: "Inner Belt", a: 2.2, e: 0.1, i: 2, diameterKm: 20 },
  { id: "2", name: "Beta", primaryDesignation: "2", zone: "Middle Belt", a: 2.6, e: 0.2, i: 3, diameterKm: null },
  { id: "3", name: "Gamma", primaryDesignation: "3", zone: "Outer Belt", a: 3.1, e: 0.1, i: 4, diameterKm: 5 }
];

async function application(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "asteroid-test-"));
  const startupSamplePath = path.join(directory, "sample.json");
  if (!options.missingSample) await fs.writeFile(startupSamplePath, JSON.stringify({ asteroids: records }));
  const app = createApplication({ startupSamplePath, backgroundEnabled: false, liveFallback: false,
    fetchJson: async () => { throw new Error("Mock JPL is offline."); }, ...options });
  await app.ready;
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { ...app, base: `http://127.0.0.1:${app.server.address().port}` };
}

test("health is ready only after a valid nonempty dataset is available", async (t) => {
  const healthy = await application(t);
  const response = await fetch(`${healthy.base}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, loadedCount: 3 });
  const missing = await application(t, { missingSample: true });
  const unavailable = await fetch(`${missing.base}/healthz`);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { ok: false, loadedCount: 0 });
  assert.equal((await fetch(`${missing.base}/api/main-belt`)).status, 503);
});

test("only explicit browser assets are public; repository and secret paths are denied", async (t) => {
  const app = await application(t);
  const allowed = ["/", "/index.html", "/src/css/styles.css", "/src/js/app.js", "/src/js/charts.js",
    "/src/js/config.js", "/src/js/dataService.js", "/src/js/utils.js", "/src/js/resultCache.js"];
  for (const asset of allowed) {
    const response = await fetch(`${app.base}${asset}`);
    assert.equal(response.status, 200, asset);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
  for (const denied of ["/.env", "/.git/config", "/server.mjs", "/package.json", "/docs/DEPLOYMENT.md",
    "/lib/jpl-api.mjs", "/data/main-belt-startup.json", "/config/startup-sample-core-bodies.json",
    "/src/js/%2e%2e/%2e%2e/server.mjs", "/%252eenv", "/src/js/private.js"]) {
    assert.equal((await fetch(`${app.base}${denied}`)).status, 404, denied);
  }
  assert.equal((await fetch(`${app.base}/%ZZ`)).status, 400);
  assert.equal((await fetch(`${app.base}/`, { method: "HEAD" })).headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal((await fetch(`${app.base}/api/search`, { method: "POST" })).status, 405);
});

test("offline main sample and search remain available; catalog fallback filters/paginates and is explicit", async (t) => {
  const app = await application(t);
  const main = await (await fetch(`${app.base}/api/main-belt`)).json();
  assert.equal(main.asteroids.length, 3);
  const search = await (await fetch(`${app.base}/api/search?q=Beta`)).json();
  assert.deepEqual(search.asteroids.map((row) => row.id), ["2"]);
  assert.match(search.meta.warning, /results come from the prepared startup sample/);
  const all = await (await fetch(`${app.base}/api/catalog`)).json();
  assert.equal(all.asteroids.length, 3);
  assert.equal(all.meta.pageSize, 25);
  assert.equal(all.meta.totalCount, 3);
  assert.match(all.meta.warning, /limited.*prepared startup sample/);
  const filtered = await (await fetch(`${app.base}/api/catalog?diameterFilter=known&minDiameterKm=10`)).json();
  assert.deepEqual(filtered.asteroids.map((row) => row.id), ["1"]);
  const page = await (await fetch(`${app.base}/api/catalog?pageSize=1&page=2&sortKey=a&sortDirection=desc`)).json();
  assert.deepEqual(page.asteroids.map((row) => row.id), ["2"]);
});

test("concurrent identical catalog work deduplicates and successful results cache", async (t) => {
  let calls = 0;
  const app = await application(t, { fetchJson: async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { fields: ["spkid", "full_name", "a", "e", "i"], data: [["100", "Live", "2.5", ".1", "5"]], count: "1" };
  } });
  const responses = await Promise.all(Array.from({ length: 5 }, () => fetch(`${app.base}/api/catalog`)));
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal((await response.json()).asteroids[0].id, "100");
  }
  await fetch(`${app.base}/api/catalog`);
  assert.equal(calls, 1);
});

test("short offline fallback cache prevents repeated failed catalog calls", async (t) => {
  let calls = 0;
  const app = await application(t, { fetchJson: async () => { calls++; throw new Error("Offline"); } });
  await fetch(`${app.base}/api/catalog`);
  await fetch(`${app.base}/api/catalog`);
  assert.equal(calls, 1);
});

test("untrusted forwarded headers cannot bypass per-client API limits", async (t) => {
  const app = await application(t, { limiter: new ApiLimiter({ clientLimit: 1 }) });
  assert.equal((await fetch(`${app.base}/api/search`, { headers: { "X-Real-IP": "192.0.2.1" } })).status, 200);
  const denied = await fetch(`${app.base}/api/search`, { headers: { "X-Real-IP": "192.0.2.2", "X-Forwarded-For": "192.0.2.3" } });
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers.get("retry-after")) > 0);
  assert.equal((await fetch(`${app.base}/healthz`)).status, 200);
});

test("only exact trusted proxy peer can supply one validated client IP", async (t) => {
  const app = await application(t, { trustedProxyIps: ["127.0.0.1"], limiter: new ApiLimiter({ clientLimit: 1 }) });
  assert.equal((await fetch(`${app.base}/api/search`, { headers: { "X-Real-IP": "192.0.2.1" } })).status, 200);
  assert.equal((await fetch(`${app.base}/api/search`, { headers: { "X-Real-IP": "192.0.2.2" } })).status, 200);
  assert.equal((await fetch(`${app.base}/api/search`, { headers: { "X-Real-IP": "192.0.2.1" } })).status, 429);
  assert.equal((await fetch(`${app.base}/api/search`, { headers: { "X-Real-IP": "192.0.2.3,192.0.2.4" } })).status, 200);
  assert.equal((await fetch(`${app.base}/api/search`, { headers: { "X-Real-IP": "not-an-ip" } })).status, 429);
});

test("catalog, exact search and background refresh share the same serialized JPL client", async (t) => {
  let active = 0, maximum = 0, calls = 0;
  const mock = http.createServer(async (req, res) => {
    calls++; active++; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active--;
    res.end(JSON.stringify({ fields: ["spkid", "full_name", "a", "e", "i"], data: [["1", "Alpha refreshed", "2.2", ".1", "2"]] }));
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    mock.closeAllConnections(); await new Promise((resolve) => mock.close(resolve));
  });
  const client = createJplClient();
  const app = await application(t, { fetchJson: (url, options) => {
    const parsed = new URL(url);
    return client.fetchJson(`http://127.0.0.1:${mock.address().port}${parsed.pathname}${parsed.search}`, options);
  } });
  await Promise.all([fetch(`${app.base}/api/catalog`), fetch(`${app.base}/api/search?q=Alpha`), app.refreshSample()]);
  assert.equal(calls, 3);
  assert.equal(maximum, 1);
});
