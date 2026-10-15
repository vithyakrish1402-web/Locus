// Which of a person's two position feeds the Group sees, when they have both.
//
// A person can be reporting twice: through the app's own socket (users[socketId]) and through
// the background service (a presence entry, presence.js). The roster shows the live socket and
// hides the presence entry, so one person is never two markers. But a socket that is still
// "connected" is not always still updating: when the app is paused the WebView freezes and the
// socket goes quiet, and behind Render's proxy it can take up to about 45 s for the server to
// notice it is dead. In that time the Group saw a frozen position while the service's fresh
// ones were hidden.
//
// This picks the feed to show, for one person at a time:
//
//   - Only when the person has BOTH a live socket and a presence entry. With no presence entry
//     nothing here applies and the live socket is shown exactly as before.
//   - The presence entry wins when the live socket's last update is older than `staleMs` AND the
//     presence entry is newer than it.
//   - Once presence has won it keeps winning for at least `dwellMs`, and returns to the live
//     socket only when the socket has sent something newer than the presence entry. So two feeds
//     that leapfrog each other cannot make the marker jump back and forth.
//   - Whichever wins, the other is hidden: never two markers.
//
// Pure: it takes the clock and the previous choice and returns the new choice. server.js keeps
// the choice per person on the squad (squad.displaySource[uid]).

const envNumber = (name, fallback) => {
  const raw = process.env[`LOCUS_${name}`];
  const value = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

/** How old a live socket's last update must be before a newer presence entry is preferred. */
export const LIVE_STALE_SEC = envNumber('LIVE_STALE_SEC', 15);
/** The least time a switch to presence is held before going back to the live socket. */
export const SOURCE_DWELL_SEC = envNumber('SOURCE_DWELL_SEC', 30);

export const LIVE = 'live';
export const PRESENCE = 'presence';

/**
 * @param {{ liveLastSeen: number|null, presenceLastSeen: number|null, now: number,
 *   previous?: { source: string, since: number }|null, staleMs?: number, dwellMs?: number }} input
 *   `liveLastSeen` is the newest update across the person's connected sockets (null if none),
 *   `presenceLastSeen` the presence entry's last report (null if none or its lease ended).
 * @returns {{ source: 'live'|'presence', since: number }}
 */
export function chooseSource({
  liveLastSeen,
  presenceLastSeen,
  now,
  previous = null,
  staleMs = LIVE_STALE_SEC * 1000,
  dwellMs = SOURCE_DWELL_SEC * 1000,
}) {
  const hasLive = Number.isFinite(liveLastSeen);
  const hasPresence = Number.isFinite(presenceLastSeen);
  // One feed only (or none): nothing to choose, and nothing remembered. The caller shows the one it has.
  if (!hasPresence || !hasLive) return { source: LIVE, since: now };

  const presenceIsNewer = presenceLastSeen > liveLastSeen;
  if (previous?.source === PRESENCE) {
    const heldLongEnough = now - previous.since >= dwellMs;
    const liveCaughtUp = liveLastSeen > presenceLastSeen;
    return heldLongEnough && liveCaughtUp ? { source: LIVE, since: now } : previous;
  }
  if (presenceIsNewer && now - liveLastSeen > staleMs) return { source: PRESENCE, since: now };
  return previous?.source === LIVE ? previous : { source: LIVE, since: now };
}
