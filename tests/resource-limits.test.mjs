import assert from "node:assert/strict";
import test from "node:test";
import { BoundedCache, ApiLimiter } from "../lib/resource-limits.mjs";

test("cache evicts least recently used items and respects its byte ceiling", (t) => {
  const cache = new BoundedCache({ maxEntries: 2, maxBytes: 40 });
  t.after(() => cache.close());
  cache.set("a", { v: 1 }); cache.set("b", { v: 2 });
  assert.deepEqual(cache.get("a"), { v: 1 });
  cache.set("c", { v: 3 });
  assert.equal(cache.get("b"), null);
  assert.equal(cache.entries.size, 2);
  cache.set("large", "x".repeat(50));
  assert.equal(cache.get("large"), null);
  assert.ok(cache.bytes <= 40);
  cache.set("d", "x".repeat(30));
  assert.equal(cache.entries.size, 1);
  assert.ok(cache.bytes <= 40);
});

test("expired cache entries are actively removed without a read", async (t) => {
  const cache = new BoundedCache({ ttlMs: 20 });
  t.after(() => cache.close());
  cache.set("unused", { v: 1 });
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(cache.entries.size, 0);
  assert.equal(cache.bytes, 0);
});

test("cache TTL is not extended by hits; short fallback TTL is honored", (t) => {
  let now = 0;
  const cache = new BoundedCache({ ttlMs: 100, now: () => now });
  t.after(() => cache.close());
  cache.set("normal", { v: 1 }); cache.set("fallback", { v: 2 }, 10);
  now = 20;
  assert.equal(cache.get("fallback"), null);
  assert.deepEqual(cache.get("normal"), { v: 1 });
  now = 101;
  assert.equal(cache.get("normal"), null);
});

test("rate limiter bounds clients, per-client requests and global requests", () => {
  let now = 0;
  const limiter = new ApiLimiter({ globalLimit: 3, clientLimit: 2, maxClients: 2, windowMs: 1000, now: () => now });
  assert.equal(limiter.admit("a"), 0);
  assert.equal(limiter.admit("a"), 0);
  assert.equal(limiter.admit("a"), 1);
  assert.equal(limiter.admit("b"), 0);
  assert.equal(limiter.admit("c"), 1);
  assert.equal(limiter.clients.size, 2);
  now = 1000;
  assert.equal(limiter.admit("c"), 0);
  assert.equal(limiter.clients.size, 1);
});

test("new identities cannot evict tracked clients to bypass a limit", () => {
  const limiter = new ApiLimiter({ maxClients: 1, globalLimit: 100, clientLimit: 1 });
  assert.equal(limiter.admit("a"), 0);
  assert.ok(limiter.admit("b") > 0);
  assert.ok(limiter.admit("a") > 0);
  assert.equal(limiter.clients.size, 1);
});
