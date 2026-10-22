// Browser-only result cache. A temporary sample fallback must be retried soon
// so a restored live catalog does not remain hidden until the page is reloaded.
export class ResultCache {
  constructor({ maxEntries = 18, ttlMs = 600_000, fallbackTtlMs = 30_000, now = Date.now } = {}) {
    Object.assign(this, { maxEntries, ttlMs, fallbackTtlMs, now });
    this.entries = new Map();
  }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) { this.entries.delete(key); return null; }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.result;
  }
  has(key) { return this.get(key) !== null; }
  set(key, result) {
    const now = this.now();
    for (const [entryKey, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(entryKey);
    this.entries.delete(key);
    this.entries.set(key, { result, expiresAt: now + (result.meta?.warning ? this.fallbackTtlMs : this.ttlMs) });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
  }
}

export function describeSearchResult(result, query) {
  const matches = result.asteroids;
  const source = result.meta?.source || "Unknown source";
  const warning = result.meta?.warning;
  const selection = matches.length === 0
    ? `No matching asteroid found for "${query}".`
    : `Selected ${matches[0].name}${matches.length > 1 ? `; ${matches.length} matches returned` : ""}.`;
  return { message: `${selection} Source: ${source}.${warning ? ` ${warning}` : ""}`,
    type: warning || matches.length === 0 ? "warning" : "info" };
}
