export class UpstreamError extends Error {
  constructor(message, { statusCode = 502, retryAfter = 5 } = {}) {
    super(message);
    this.statusCode = statusCode;
    this.retryAfter = retryAfter;
  }
}

export function createJplClient({
  fetchImpl = globalThis.fetch,
  maxQueued = 12,
  totalTimeoutMs = 15_000,
  maxResponseBytes = 8 * 1024 * 1024,
  maxRetries = 1,
  userAgent = process.env.JPL_USER_AGENT || "AsteroidExplorer/0.1.1 (+https://github.com/DanielHaggstrom/asteroid_explorer/issues)"
} = {}) {
  if (!userAgent || /[\r\n]/.test(userAgent) || userAgent.length > 512) throw new Error("Invalid JPL_USER_AGENT.");
  const queued = [];
  const inFlight = new Map();
  let active = false;
  let blockedUntil = 0;

  async function drain() {
    if (active) return;
    active = true;
    try {
      while (queued.length) {
        const job = queued.shift();
        clearTimeout(job.queueTimer);
        if (Date.now() >= job.deadline) { job.reject(deadlineError()); continue; }
        try { job.resolve(await request(job)); }
        catch (error) { job.reject(error); }
      }
    } finally { active = false; }
  }

  async function request(job) {
    let lastError;
    for (let attempt = 0; attempt <= job.maxRetries; attempt += 1) {
      const delay = blockedUntil - Date.now();
      if (delay > 0) {
        if (Date.now() + delay >= job.deadline) throw busyError(delay);
        await sleep(delay);
      }
      const remaining = job.deadline - Date.now();
      if (remaining <= 0) throw deadlineError();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), remaining);
      try {
        const response = await fetchImpl(job.url, {
          method: "GET", redirect: "error",
          headers: { Accept: "application/json", "User-Agent": userAgent },
          signal: controller.signal
        });
        if (!response.ok) {
          await response.body?.cancel();
          const retryable = response.status === 429 || response.status >= 500;
          if (retryable) {
            const retryDelay = retryAfterMs(response.headers.get("retry-after"), attempt);
            blockedUntil = Math.max(blockedUntil, Date.now() + retryDelay);
          }
          const error = new UpstreamError(`JPL returned HTTP ${response.status}.`, {
            statusCode: retryable ? 503 : 502,
            retryAfter: Math.max(1, Math.ceil((blockedUntil - Date.now()) / 1000))
          });
          error.retryable = retryable;
          throw error;
        }
        if (Number(response.headers.get("content-length")) > maxResponseBytes) {
          await response.body?.cancel();
          throw new UpstreamError("JPL response exceeds the size limit.");
        }
        const reader = response.body?.getReader();
        const chunks = [];
        let bytes = 0;
        if (!reader) throw new UpstreamError("JPL response was empty.");
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > maxResponseBytes) {
              await reader.cancel();
              throw new UpstreamError("JPL response exceeds the size limit.");
            }
            chunks.push(Buffer.from(value));
          }
        } finally { reader.releaseLock(); }
        const payload = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
        if (Date.now() >= job.deadline) throw deadlineError();
        return payload;
      } catch (error) {
        lastError = error instanceof UpstreamError ? error : new UpstreamError("JPL request failed or timed out.");
        if (Date.now() >= job.deadline || controller.signal.aborted) throw deadlineError();
        // Parse/size/HTTP 4xx errors are not retried. Network failures back off.
        if (error instanceof SyntaxError || (error instanceof UpstreamError && !error.retryable)) throw lastError;
        if (!(error instanceof UpstreamError)) blockedUntil = Math.max(blockedUntil, Date.now() + 500 * (2 ** attempt));
        if (attempt >= job.maxRetries) throw lastError;
      } finally { clearTimeout(timeout); }
    }
    throw lastError;
  }

  function fetchJson(url, options = {}) {
    // This single queue is shared by catalog, exact search, initialization and
    // background refresh. Holding the slot includes body parsing and backoff.
    const key = String(url);
    if (inFlight.has(key)) return inFlight.get(key);
    if (queued.length >= maxQueued) return Promise.reject(busyError(1000));
    if (blockedUntil >= Date.now() + totalTimeoutMs) return Promise.reject(busyError(blockedUntil - Date.now()));
    const timeoutMs = Math.min(totalTimeoutMs, options.timeoutMs ?? totalTimeoutMs);
    const promise = new Promise((resolve, reject) => {
      const job = { url: key, resolve, reject, deadline: Date.now() + timeoutMs,
        maxRetries: Math.min(maxRetries, options.maxRetries ?? maxRetries) };
      job.queueTimer = setTimeout(() => {
        const index = queued.indexOf(job);
        if (index >= 0) { queued.splice(index, 1); reject(deadlineError()); }
      }, timeoutMs);
      queued.push(job);
      void drain();
    }).finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  }
  return { fetchJson, get stats() { return { active, queued: queued.length, inFlight: inFlight.size }; } };
}

function deadlineError() { return new UpstreamError("JPL request deadline exceeded.", { statusCode: 504 }); }
function busyError(delay) { return new UpstreamError("JPL service is busy; try again shortly.", { statusCode: 503, retryAfter: Math.max(1, Math.ceil(delay / 1000)) }); }
function retryAfterMs(value, attempt) {
  if (value !== null) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(86_400_000, seconds * 1000);
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.min(86_400_000, Math.max(0, date - Date.now()));
  }
  return Math.min(30_000, 1000 * (2 ** attempt));
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
