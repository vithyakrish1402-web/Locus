// A fixed-window counter per key, in memory: `limit` requests per `windowMs`, per key.
// check(key) says whether this request is within the limit and, if not, how long until the
// window resets. The table is bounded (maxKeys): when it fills, finished windows go first and
// then the oldest keys, so an attacker using endless keys can cost memory only up to the bound.
// Nothing is logged and nothing persists; a restart starts every count again.

export function createRateLimiter({ limit, windowMs, maxKeys = 10000, now = Date.now }) {
  const windows = new Map(); // key -> { start, count }

  const makeRoom = (at) => {
    for (const [key, w] of windows) if (at - w.start >= windowMs) windows.delete(key);
    for (const key of windows.keys()) {
      if (windows.size < maxKeys) break;
      windows.delete(key); // Map keeps insertion order: the oldest first
    }
  };

  return {
    check(key) {
      const at = now();
      let w = windows.get(key);
      if (!w || at - w.start >= windowMs) {
        if (!w && windows.size >= maxKeys) makeRoom(at);
        w = { start: at, count: 0 };
        windows.delete(key); // re-insert so the table stays ordered oldest-first
        windows.set(key, w);
      }
      w.count += 1;
      if (w.count > limit) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((w.start + windowMs - at) / 1000)) };
      return { ok: true, retryAfterSec: 0 };
    },
    size: () => windows.size,
  };
}
