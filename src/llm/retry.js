// Retry the right failures only. Timeouts, 429 and 5xx get retried;
// 400, 401 and 403 never do - a bad key will still be a bad key in four
// seconds, and on a metered free tier every pointless retry burns quota.

export function isTimeout(err) {
  return (
    err?.name === "APIConnectionTimeoutError" ||
    err?.code === "ETIMEDOUT" ||
    err?.code === "UND_ERR_CONNECT_TIMEOUT" ||
    /timed? ?out/i.test(String(err?.message ?? ""))
  );
}

export function shouldRetry(err) {
  if (isTimeout(err)) return true;
  const status = err?.status;
  if (typeof status === "number") {
    return status === 429 || status >= 500;
  }
  return false;
}

// Exponential backoff with jitter: 1s, 2s, 4s, each plus a small random
// amount. A 429's Retry-After wins when present.
export function nextBackoffMs(attempt, err) {
  const retryAfter = retryAfterMs(err);
  if (retryAfter != null) return retryAfter;
  return 1000 * 2 ** attempt + Math.floor(Math.random() * 250);
}

export function retryAfterMs(err) {
  const headers = err?.headers ?? err?.response?.headers;
  const raw = headers?.["retry-after"] ?? headers?.get?.("retry-after");
  if (raw == null) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}
