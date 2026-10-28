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
// Sent is not delivered (a fix, 2026-10-28). For up to a minute after a phone loses signal its
// connection still looks open, and an alert written to it then was lost while the app said
// "sent". Now an alert stays held until the server answers it ('alert-result', which names it by
// the `clientId` it carries). No answer within SOS_ACK_TIMEOUT_MS: 'unconfirmed' ("Not delivered,
// retrying"), and the same alert is sent again (same clientId, so the server answers a copy it
// already has as delivered, never as a second alarm) until it is answered or let go of.

const hasFix = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);

// How long an answer may take before the alert counts as not delivered and is sent again.
export const SOS_ACK_TIMEOUT_MS = 4000;

const newClientId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/**
 * @param {{ connected: boolean, emit: Function, on: Function, off: Function, volatile?: object }} socket
 * @param {{ ackTimeoutMs?: number, setTimer?: Function, clearTimer?: Function }} [options]
 */
export function createSosOutbox(socket, { ackTimeoutMs = SOS_ACK_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let inGroup = false;
  let held = null;
  // The copy sent and not yet answered: its answer is awaited until `timer` fires.
  let awaiting = false;
  let timer = null;
  // It had to wait (for a connection, or for an answer that didn't come): said once, and its
  // "sent" then says it went late.
  let waited = false;
  let unconfirmedTold = false;
  const listeners = new Set();
  const tell = (event, details = {}) => listeners.forEach((fn) => fn({ held: Boolean(held), event, ...details }));

  const stopWaiting = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    awaiting = false;
  };
  const unconfirmed = () => {
    waited = true;
    if (unconfirmedTold) return;
    unconfirmedTold = true;
    tell('unconfirmed');
  };

  // A new connection, or a lost one, isn't in the group until the server says so again. A copy
  // still awaiting its answer on a lost connection may never have arrived: sent again once back.
  const notReady = () => {
    inGroup = false;
    if (awaiting) {
      stopWaiting();
      unconfirmed();
    }
  };
  const onResult = (result) => {
    if (result?.type !== 'sos' || !held) return;
    // An answer about another alert (an earlier one), or, from a server that names none, one
    // that came when nothing of ours was awaiting an answer.
    if (result.clientId ? result.clientId !== held.clientId : !awaiting) return;
    // Sent before this connection was back in the group: not an answer about the alert.
    if (result.reasonCode === 'NOT_IN_GROUP') {
      stopWaiting();
      unconfirmed();
      return;
    }
    stopWaiting();
    const alert = held;
    held = null;
    if (result.allowed) tell('sent', { late: waited, withLocation: hasFix(alert) });
    else tell('refused', { reasonCode: result.reasonCode ?? null });
  };
  const listen = () => {
    socket.off('connect', notReady);
    socket.off('disconnect', notReady);
    socket.off('alert-result', onResult);
    socket.on('connect', notReady);
    socket.on('disconnect', notReady);
    socket.on('alert-result', onResult);
  };
  listen();

  const canSend = () => Boolean(socket.connected) && inGroup;

  const outbox = {
    canSend,
    /** Whether an alert is being held (waiting for a connection, or for the server's answer). */
    isHolding: () => Boolean(held),
    /** The alert being held (a copy), or null. */
    held: () => (held ? { ...held } : null),
    /** Called on every change with { held, event: 'held' | 'unconfirmed' | 'sent' | 'refused' |
     *  'dropped' }, plus, for 'sent', { late, withLocation } (late: it had to wait), for
     *  'refused', { reasonCode }, and for 'dropped', { reason: 'gone' | 'left' }. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Sends now if it can (returns true), otherwise holds it (returns false). Either way it
     *  stays held until the server has answered it. */
    send(payload) {
      // One alert at a time: the newer press's time, and its location if it has one.
      const first = !held;
      held = held
        ? { ...held, ...payload, clientId: held.clientId, ...(hasFix(payload) ? {} : { lat: held.lat, lng: held.lng }) }
        : { ...payload, clientId: newClientId() };
      if (first) {
        waited = false;
        unconfirmedTold = false;
      }
      if (canSend()) {
        outbox.flush();
        return true;
      }
      if (first) {
        waited = true;
        tell('held');
      }
      return false;
    },
    /** This connection has been let (back) into the group: send anything held. */
    markInGroup() {
      inGroup = true;
      outbox.flush();
    },
    /** Sends the held alert, unless it can't reach the group or a copy is awaiting its answer. */
    flush() {
      if (!held || !canSend() || awaiting) return;
      awaiting = true;
      // Volatile: a copy the connection can't take is dropped rather than queued for a later
      // connection, where the server would not yet know this phone. It is sent again from here.
      (socket.volatile ?? socket).emit('sos-broadcast', held);
      timer = setTimer(() => {
        timer = null;
        awaiting = false;
        unconfirmed();
        outbox.flush();
      }, ackTimeoutMs);
    },
    /** The group is gone, or this phone left it: let go of a held alert. Returns whether one was held. */
    drop(reason = 'left') {
      inGroup = false;
      stopWaiting();
      if (!held) return false;
      held = null;
      tell('dropped', { reason });
      return true;
    },
    /** A fresh start (the app's first render): nothing held, not in a group yet, and its
     *  connection listeners in place (attached once only, however often this is called). */
    reset() {
      inGroup = false;
      stopWaiting();
      held = null;
      listen();
    },
    dispose() {
      stopWaiting();
      socket.off('connect', notReady);
      socket.off('disconnect', notReady);
      socket.off('alert-result', onResult);
      listeners.clear();
    },
  };
  return outbox;
}
