import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createJplClient } from "../lib/jpl-client.mjs";

async function mock(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("JPL calls are serialized through body consumption and identical calls deduplicate", async (t) => {
  let active = 0, maximum = 0, requests = 0;
  const base = await mock(t, async (req, res) => {
    requests++; active++; maximum = Math.max(maximum, active);
    assert.match(req.headers["user-agent"], /^AsteroidExplorer\/.*github.com/);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"ok":');
    await sleep(25);
    active--;
    res.end("true}");
  });
  const client = createJplClient();
  const first = client.fetchJson(`${base}/one`);
  const duplicate = client.fetchJson(`${base}/one`);
  assert.equal(first, duplicate);
  await Promise.all([first, duplicate, client.fetchJson(`${base}/two`), client.fetchJson(`${base}/three`)]);
  assert.equal(maximum, 1);
  assert.equal(requests, 3);
  assert.deepEqual(client.stats, { active: false, queued: 0, inFlight: 0 });
});

test("upstream queue is bounded", async (t) => {
  let requests = 0;
  const base = await mock(t, async (req, res) => {
    requests++; await sleep(40); res.end('{}');
  });
  const client = createJplClient({ maxQueued: 1 });
  const first = client.fetchJson(`${base}/one`);
  const second = client.fetchJson(`${base}/two`);
  await assert.rejects(client.fetchJson(`${base}/three`), (error) => error.statusCode === 503);
  await Promise.all([first, second]);
  assert.equal(requests, 2);
});

test("deadline includes queue wait; expired jobs never reach upstream", async (t) => {
  const paths = [];
  const base = await mock(t, async (req, res) => {
    paths.push(req.url); await sleep(100); res.end('{}');
  });
  const client = createJplClient({ totalTimeoutMs: 500 });
  const first = client.fetchJson(`${base}/one`);
  await assert.rejects(client.fetchJson(`${base}/expired`, { timeoutMs: 30 }), (error) => error.statusCode === 504);
  await first;
  assert.deepEqual(paths, ["/one"]);
});

test("deadline covers a stalled JSON body, not only response headers", async (t) => {
  const base = await mock(t, (req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"never":"complete');
  });
  const client = createJplClient({ totalTimeoutMs: 80, maxRetries: 0 });
  const start = Date.now();
  await assert.rejects(client.fetchJson(base), (error) => error.statusCode === 504);
  assert.ok(Date.now() - start < 500);
});

test("streamed oversized and invalid JSON responses are rejected without retries", async (t) => {
  let requests = 0;
  const base = await mock(t, (req, res) => {
    requests++;
    if (req.url === "/large") { res.write("x".repeat(40)); res.end("x".repeat(40)); }
    else res.end("not JSON");
  });
  const client = createJplClient({ maxResponseBytes: 50 });
  await assert.rejects(client.fetchJson(`${base}/large`), /size limit/);
  await assert.rejects(client.fetchJson(`${base}/invalid`), /failed/);
  assert.equal(requests, 2);
});

test("429 Retry-After pauses every queued request and retry", async (t) => {
  const arrivals = [];
  const base = await mock(t, (req, res) => {
    arrivals.push(Date.now());
    if (arrivals.length === 1) {
      res.writeHead(429, { "Retry-After": "1" }); res.end('{}');
    } else res.end('{"ok":true}');
  });
  const client = createJplClient({ totalTimeoutMs: 2500 });
  await Promise.all([client.fetchJson(`${base}/one`), client.fetchJson(`${base}/two`)]);
  assert.equal(arrivals.length, 3);
  assert.ok(arrivals[1] - arrivals[0] >= 950);
});

test("long upstream cooldown fails fast without ignoring Retry-After", async (t) => {
  let requests = 0;
  const base = await mock(t, (req, res) => {
    requests++; res.writeHead(503, { "Retry-After": "120" }); res.end('{}');
  });
  const client = createJplClient({ totalTimeoutMs: 1000 });
  await assert.rejects(client.fetchJson(base), (error) => error.statusCode === 503 && error.retryAfter >= 119);
  await assert.rejects(client.fetchJson(`${base}/next`), (error) => error.statusCode === 503);
  assert.equal(requests, 1);
});

test("upstream redirects are not followed", async (t) => {
  let destinationCalls = 0;
  const base = await mock(t, (req, res) => {
    if (req.url === "/private") { destinationCalls++; res.end('{}'); }
    else { res.writeHead(302, { Location: "/private" }); res.end(); }
  });
  const client = createJplClient({ maxRetries: 0 });
  await assert.rejects(client.fetchJson(base));
  assert.equal(destinationCalls, 0);
});
