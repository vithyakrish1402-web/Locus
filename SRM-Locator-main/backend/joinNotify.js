// Telling the people who admit (the main admin and moderators) how many are waiting to join,
// in one message per burst rather than one per request.
//
// A request starts a batch; every request inside the next JOIN_NOTIFY_BATCH_MS joins it; when
// the window closes, `deliver(roomCode, count)` is called once with the number waiting then.
// The waiting list itself is squad.pending (squadRoster.js), which stays on the server while
// every admitter is away, so the count is right whenever they come back. Like the rest of the
// server it is in memory: a Render restart empties it, and the joiners' phones ask again when
// they reconnect.

// How long requests are gathered into one notification.
export const JOIN_NOTIFY_BATCH_MS = Number(process.env.LOCUS_JOIN_NOTIFY_BATCH_MS) || 20 * 1000;

export function createJoinNotifier({ deliver, batchMs = JOIN_NOTIFY_BATCH_MS }) {
  const timers = new Map(); // roomCode -> timeout

  return {
    /** A request arrived in `roomCode`: starts a batch, or joins the open one. */
    requested(roomCode) {
      if (timers.has(roomCode)) return;
      timers.set(roomCode, setTimeout(() => {
        timers.delete(roomCode);
        deliver(roomCode);
      }, batchMs));
    },
    /** The Group is gone: no batch outlives it. */
    cancel(roomCode) {
      clearTimeout(timers.get(roomCode));
      timers.delete(roomCode);
    },
    stop() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
