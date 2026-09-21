// Android 9+ lets a foreground app start 4 WiFi scans per rolling 2 minutes; past that,
// startScan() is refused and getScanResults() keeps handing back the previous scan.
// This only *reports* the budget - the tool deliberately adds no cooldown of its own.
export const SCAN_LIMIT = 4;
export const SCAN_WINDOW_MS = 120_000;

/**
 * @param {number[]} acceptedAt epoch-ms times of scans the OS accepted this session
 * @param {number} now          epoch ms
 * @returns {{used:number, limit:number, retryInMs:number}} retryInMs is 0 when a scan
 *   should be allowed now (as far as this session knows - scans from before an app
 *   restart are invisible to it, so a throttle can still happen with retryInMs 0).
 */
export function scanBudget(acceptedAt, now) {
  const recent = acceptedAt.filter((t) => now - t < SCAN_WINDOW_MS).sort((a, b) => a - b);
  const retryInMs =
    recent.length >= SCAN_LIMIT ? Math.max(0, recent[recent.length - SCAN_LIMIT] + SCAN_WINDOW_MS - now) : 0;
  return { used: recent.length, limit: SCAN_LIMIT, retryInMs };
}
