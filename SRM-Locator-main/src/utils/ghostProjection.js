// "Ghost" state machine for a squad member who's gone signal-lost — see
// App.jsx's member-signal-lost handler and GhostMemberMarker.jsx.
//
// Flagged per the task spec: these are reasonable-sounding defaults, not
// measured against real disconnect patterns on campus (e.g. how long dead
// zones near certain buildings actually last). Fine to ship with and tune
// after seeing real signal-loss durations in use.
export const GHOST_OPACITY = 0.5;
export const GHOST_PROJECTION_CAP_SECONDS = 90; // stop advancing the dot past this
export const GHOST_EXPIRE_SECONDS = 120;        // after this, drop the projection entirely
export const GHOST_FADE_MS = 700;               // reconnect fade-out duration for the ghost marker

// 'projecting': dot still advancing along the heading vector.
// 'frozen':     dot stopped advancing, but still ghost-styled with a tag.
// 'expired':    projection abandoned — plain static pin at lastKnownLocation.
export const getGhostPhase = (elapsedSeconds) => {
  if (elapsedSeconds > GHOST_EXPIRE_SECONDS) return 'expired';
  if (elapsedSeconds > GHOST_PROJECTION_CAP_SECONDS) return 'frozen';
  return 'projecting';
};

// Dead-reckoning offset from a last-known fix, given heading/speed and how
// long they've been presumed to keep moving on that vector. Same Haversine
// approach as App.jsx's original one-shot projectGhostLocation, but taking
// elapsed seconds as an explicit input so callers can re-run it every tick.
export const projectDeadReckoning = (lat, lng, speedKmh, headingDeg, elapsedSeconds) => {
  if (!speedKmh || speedKmh < 1 || elapsedSeconds <= 0) return { lat, lng };

  const R = 6371e3; // Earth's radius in meters
  const distanceMeters = (speedKmh * (5 / 18)) * elapsedSeconds; // km/h -> m/s

  const radLat = lat * (Math.PI / 180);
  const radLng = lng * (Math.PI / 180);
  const radHeading = headingDeg * (Math.PI / 180);

  const projectedLat = Math.asin(
    Math.sin(radLat) * Math.cos(distanceMeters / R) +
    Math.cos(radLat) * Math.sin(distanceMeters / R) * Math.cos(radHeading)
  );

  const projectedLng = radLng + Math.atan2(
    Math.sin(radHeading) * Math.sin(distanceMeters / R) * Math.cos(radLat),
    Math.cos(distanceMeters / R) - Math.sin(radLat) * Math.sin(projectedLat)
  );

  return {
    lat: projectedLat * (180 / Math.PI),
    lng: projectedLng * (180 / Math.PI),
  };
};

// Current displayed position for a ghost, given its raw last-known fix and
// how long it's been dark. Advances up to the cap, then holds still.
export const getGhostPosition = (ghost, elapsedSeconds) => {
  const phase = getGhostPhase(elapsedSeconds);
  if (phase === 'expired') return { lat: ghost.lat, lng: ghost.lng };

  // timeDelta (server lag before disconnect was confirmed) is a fixed
  // head start on top of however long we've been ticking client-side —
  // the member kept moving through that gap too.
  const projectionSeconds = Math.min(elapsedSeconds, GHOST_PROJECTION_CAP_SECONDS) + (ghost.timeDelta || 0);
  return projectDeadReckoning(ghost.lat, ghost.lng, ghost.speedKmh, ghost.heading, projectionSeconds);
};

export const formatElapsed = (totalSeconds) => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

// Derives the live-ticking view model for every currently-dark member.
// `nowMs` is a shared clock tick (App.jsx re-renders this ~1/sec) so every
// ghost's elapsed time recomputes together instead of each running its own
// interval.
export const deriveGhostMembers = (offlineNodes, nowMs) =>
  Object.values(offlineNodes).map((ghost) => {
    const elapsedSeconds = (nowMs - ghost.receivedAt) / 1000;
    const phase = getGhostPhase(elapsedSeconds);
    const position = getGhostPosition(ghost, elapsedSeconds);
    return {
      ...ghost,
      phase,
      elapsedSeconds,
      elapsedLabel: formatElapsed(elapsedSeconds),
      lastKnownLocation: { lat: ghost.lat, lng: ghost.lng },
      position,
    };
  });

// Segments a straight line from `from` to `to` into N short pieces with
// linearly decreasing opacity, so both map engines can render the
// projection vector as a dashed line that reads as "less certain" the
// further it extends from the last confirmed fix.
export const getProjectionSegments = (from, to, segmentCount = 6, maxOpacity = 0.6) => {
  if (from.lat === to.lat && from.lng === to.lng) return [];
  const segments = [];
  for (let i = 0; i < segmentCount; i += 1) {
    const t0 = i / segmentCount;
    const t1 = (i + 1) / segmentCount;
    const opacity = maxOpacity * (1 - i / segmentCount);
    segments.push({
      from: { lat: from.lat + (to.lat - from.lat) * t0, lng: from.lng + (to.lng - from.lng) * t0 },
      to: { lat: from.lat + (to.lat - from.lat) * t1, lng: from.lng + (to.lng - from.lng) * t1 },
      opacity,
    });
  }
  return segments;
};
