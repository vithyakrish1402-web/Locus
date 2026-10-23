// The "lost connection" state of a group member whose connection dropped (see App.jsx's
// member-signal-lost handler and GhostMemberMarker.jsx).
//
// Their marker stays exactly where they were last reported, dimmed, with how long ago. Nothing
// guesses where they went: it used to dead-reckon them forward along their last heading and
// speed for up to 90 s (the "Pre-Cog" projection) and draw a fading line to the guess, which put
// them where they were never seen. The last known location is what matters (2026-10).
export const GHOST_OPACITY = 0.5;
export const GHOST_EXPIRE_SECONDS = 120;        // after this the plate says "last seen", not "lost connection"
export const GHOST_FADE_MS = 700;               // reconnect fade-out duration for the ghost marker

// 'lost':    the connection dropped a moment ago ("lost connection 0:45 ago").
// 'expired': gone a while ("last seen 5:00 ago").
export const getGhostPhase = (elapsedSeconds) => (elapsedSeconds > GHOST_EXPIRE_SECONDS ? 'expired' : 'lost');

export const formatElapsed = (totalSeconds) => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

// The view model for every member whose connection is lost. `nowMs` is a shared clock tick
// (App.jsx re-renders this ~1/sec) so every ghost's elapsed time recomputes together instead of
// each running its own interval. `position` is always their last known location.
export const deriveGhostMembers = (offlineNodes, nowMs) =>
  Object.values(offlineNodes).map((ghost) => {
    const elapsedSeconds = (nowMs - ghost.receivedAt) / 1000;
    const lastKnownLocation = { lat: ghost.lat, lng: ghost.lng };
    return {
      ...ghost,
      phase: getGhostPhase(elapsedSeconds),
      elapsedSeconds,
      elapsedLabel: formatElapsed(elapsedSeconds),
      lastKnownLocation,
      position: lastKnownLocation,
    };
  });
