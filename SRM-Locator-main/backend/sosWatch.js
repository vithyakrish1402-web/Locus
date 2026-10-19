// Waking a phone that is listening for an SOS from the background.
//
// That phone has no socket to be pushed to, so it asks the server (GET /api/background/sos) and
// the server holds the question open until something happens or a few seconds pass (a "long
// poll"). This is the bell: a request waits on its Group's code, and the SOS handlers ring it
// when an SOS is raised or updated. It carries no data. A woken request looks at the Group again, with its own checks, as if it had just arrived.
//
// In memory, like everything else here. Nothing waits for longer than the timeout it was given.

export function createSosWatch() {
  const waiting = new Map(); // roomCode -> Set of wake functions

  return {
    /**
     * @returns {{ done: Promise<'woken' | 'timeout' | 'cancelled'>, cancel: () => void }}
     * `cancel` is for a caller whose connection closed: it stops waiting at once.
     */
    wait(roomCode, timeoutMs) {
      let finish;
      const done = new Promise((resolve) => { finish = resolve; });
      let timer;
      const settle = (outcome) => {
        clearTimeout(timer);
        const set = waiting.get(roomCode);
        if (set) {
          set.delete(wake);
          if (set.size === 0) waiting.delete(roomCode);
        }
        finish(outcome);
      };
      const wake = () => settle('woken');
      if (!waiting.has(roomCode)) waiting.set(roomCode, new Set());
      waiting.get(roomCode).add(wake);
      timer = setTimeout(() => settle('timeout'), timeoutMs);
      return { done, cancel: () => settle('cancelled') };
    },

    /** Something happened in this Group: everyone waiting on it looks again. */
    notify(roomCode) {
      const set = waiting.get(roomCode);
      if (!set) return;
      for (const wake of [...set]) wake();
    },

    /** How many requests are waiting (for tests). */
    count() {
      let total = 0;
      for (const set of waiting.values()) total += set.size;
      return total;
    },
  };
}
