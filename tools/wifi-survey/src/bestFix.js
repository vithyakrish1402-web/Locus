// A single GPS reading is often the worst one: the first fix after a tap is frequently
// 20-30 m out, then tightens over the next few seconds if you stand still. So a point
// takes the most accurate fix seen in a short window rather than the first one.

export const GOOD_FIX_M = 10; // stop waiting as soon as a fix is this accurate
export const FIX_WINDOW_MS = 15_000; // otherwise take the best seen in this long

/** Tracks the most accurate fix. add() returns true once it's good enough to stop. */
export function createFixPicker(goodEnoughM = GOOD_FIX_M) {
  let best = null;
  let count = 0;
  return {
    add(position) {
      const accuracy = position?.coords?.accuracy;
      if (typeof accuracy !== 'number' || !Number.isFinite(accuracy)) return false;
      count += 1;
      if (!best || accuracy < best.coords.accuracy) best = position;
      return best.coords.accuracy <= goodEnoughM;
    },
    get best() {
      return best;
    },
    get count() {
      return count;
    },
  };
}

/**
 * Watch GPS until a fix within goodEnoughM arrives or maxWaitMs passes, then resolve
 * with the best fix seen. Rejects only if no fix arrived at all.
 *
 * @param geo  @capacitor/geolocation (or the simulator): watchPosition + clearWatch
 * @param options.signal  AbortSignal that ends the window early, e.g. when the scan
 *   already failed and the fix is no longer needed
 * @returns {Promise<{position:object, fixes:number, waitedMs:number}>}
 */
export function bestFix(
  geo,
  { goodEnoughM = GOOD_FIX_M, maxWaitMs = FIX_WINDOW_MS, onProgress = () => {}, signal } = {},
) {
  return new Promise((resolve, reject) => {
    const picker = createFixPicker(goodEnoughM);
    const startedAt = Date.now();
    let watchId = null;
    let finished = false;
    let lastError = null;

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (watchId !== null) geo.clearWatch({ id: watchId }).catch(() => {});
      if (picker.best) {
        resolve({ position: picker.best, fixes: picker.count, waitedMs: Date.now() - startedAt });
      } else {
        reject(lastError ?? new Error(`No GPS fix within ${Math.round(maxWaitMs / 1000)} s`));
      }
    };
    const timer = setTimeout(finish, maxWaitMs);
    signal?.addEventListener('abort', finish, { once: true });

    geo
      .watchPosition({ enableHighAccuracy: true, timeout: maxWaitMs, maximumAge: 0 }, (position, err) => {
        if (finished) return;
        if (err) {
          lastError = err;
          return;
        }
        if (!position) return;
        const goodEnough = picker.add(position);
        onProgress({ best: picker.best, fixes: picker.count, elapsedMs: Date.now() - startedAt });
        if (goodEnough) finish();
      })
      .then(
        (id) => {
          watchId = id;
          // The window can close before the watch ID comes back (a good first fix).
          if (finished) geo.clearWatch({ id }).catch(() => {});
        },
        (e) => {
          lastError = e;
          finish();
        },
      );
  });
}
