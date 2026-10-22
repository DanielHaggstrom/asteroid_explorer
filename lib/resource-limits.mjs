// All retained state has an explicit bound; expiry also runs without cache reads.
export class BoundedCache {
  constructor({ maxEntries = 128, maxBytes = 16 * 1024 * 1024, ttlMs = 600_000, now = Date.now } = {}) {
    Object.assign(this, { maxEntries, maxBytes, ttlMs, now });
    this.entries = new Map();
    this.bytes = 0;
    this.timer = setInterval(() => this.prune(), Math.min(ttlMs, 30_000));
    this.timer.unref();
  }
  prune() {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.delete(key);
    }
  }
  delete(key) {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) { this.delete(key); return null; }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.payload;
  }
  set(key, payload, ttlMs = this.ttlMs) {
    this.prune();
    const bytes = Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(payload));
    this.delete(key);
    if (bytes > this.maxBytes) return;
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      this.delete(this.entries.keys().next().value);
    }
    this.entries.set(key, { payload, bytes, expiresAt: this.now() + ttlMs });
    this.bytes += bytes;
  }
  close() { clearInterval(this.timer); }
}

// Fixed-window admission with a global ceiling, a per-client ceiling, bounded
// identity tracking and no eviction that would let a rotating client reset it.
export class ApiLimiter {
  constructor({ globalLimit = 120, clientLimit = 40, maxClients = 2048, windowMs = 60_000, now = Date.now } = {}) {
    Object.assign(this, { globalLimit, clientLimit, maxClients, windowMs, now });
    this.clients = new Map();
    this.windowStart = now();
    this.total = 0;
  }
  admit(client) {
    const now = this.now();
    if (now - this.windowStart >= this.windowMs) {
      this.clients.clear(); this.total = 0; this.windowStart = now;
    }
    const count = this.clients.get(client) ?? 0;
    if (this.total >= this.globalLimit || count >= this.clientLimit || (!this.clients.has(client) && this.clients.size >= this.maxClients)) {
      return Math.max(1, Math.ceil((this.windowStart + this.windowMs - now) / 1000));
    }
    this.clients.set(client, count + 1);
    this.total += 1;
    return 0;
  }
}
