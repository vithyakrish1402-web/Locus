// The Emergency alert's way out (a fix, 2026-10-07): sends an alert straight away when it
// can reach the group, and otherwise holds it until it can.
//
// Why it exists: an alert sent while offline used to be left to socket.io, which keeps it in
// memory and sends it the moment the connection comes back. But that is a new connection,
// with a new id, and the server only takes alerts from connections on the group's member
// list. The app asks to rejoin on 'connect', after socket.io has already sent its held
// packets, so the server dropped the alert and nobody was told (proved end to end in
// tests/sosOffline.e2e.test.js).
//
// So the app holds it itself. "Can reach the group" means connected, and let back into the
// group on this connection: 'access-granted' since the last 'connect'. Until then the alert
// waits here; markInGroup() sends it. Only one alert is ever held: a second one while
// waiting keeps one alert, with the freshest location and time. drop() lets go of it (the
// group is gone, or this phone left it). Nothing here outlives the app: closing the app
// loses a held alert.
//
// Online it does exactly what the button always did: one socket.emit('sos-broadcast',
// payload), at once, with the same payload.

const hasFix = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);

/**
 * @param {{ connected: boolean, emit: Function, on: Function, off: Function }} socket
 */
export function createSosOutbox(socket) {
  let inGroup = false;
  let held = null;
  const listeners = new Set();
  const tell = (event, reason) => listeners.forEach((fn) => fn({ held: Boolean(held), event, reason }));

  // A new connection, or a lost one, isn't in the group until the server says so again.
  const notReady = () => { inGroup = false; };
  const listen = () => {
    socket.off('connect', notReady);
    socket.off('disconnect', notReady);
    socket.on('connect', notReady);
    socket.on('disconnect', notReady);
  };
  listen();

  const canSend = () => Boolean(socket.connected) && inGroup;

  const outbox = {
    canSend,
    /** Whether an alert is being held. */
    isHolding: () => Boolean(held),
    /** The alert being held (a copy), or null. */
    held: () => (held ? { ...held } : null),
    /** Called with { held, event: 'held' | 'sent' | 'dropped', reason } on every change. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Sends now if it can (returns true), otherwise holds it (returns false). */
    send(payload) {
      if (canSend() && !held) {
        socket.emit('sos-broadcast', payload);
        return true;
      }
      // One alert at a time: the newer press's time, and its location if it has one.
      const first = !held;
      held = held
        ? { ...held, ...payload, ...(hasFix(payload) ? {} : { lat: held.lat, lng: held.lng }) }
        : { ...payload };
      if (first) tell('held');
      outbox.flush();
      return false;
    },
    /** This connection has been let (back) into the group: send anything held. */
    markInGroup() {
      inGroup = true;
      outbox.flush();
    },
    flush() {
      if (!held || !canSend()) return;
      const alert = held;
      held = null;
      socket.emit('sos-broadcast', alert);
      tell('sent');
    },
    /** The group is gone, or this phone left it: let go of a held alert. Returns whether one was held. */
    drop(reason = 'left') {
      inGroup = false;
      if (!held) return false;
      held = null;
      tell('dropped', reason);
      return true;
    },
    /** A fresh start (the app's first render): nothing held, not in a group yet, and its
     *  connection listeners in place (attached once only, however often this is called). */
    reset() {
      inGroup = false;
      held = null;
      listen();
    },
    dispose() {
      socket.off('connect', notReady);
      socket.off('disconnect', notReady);
      listeners.clear();
    },
  };
  return outbox;
}
