// Timed Pause and Hidden (Stage 4): asking the server for a hold, following it, and telling the
// person about their own sharing (utils/timedPrivacy.js has the rules and the clock maths).
//
//   const timed = useTimedPrivacy({ socket, roomCode, inGroup, applyMode });
//   timed.active          the app's switch is on and the server has not said its own is off
//   timed.hold            { mode: 'FROZEN'|'GHOST', until } (server clock) or null
//   timed.allowanceLeftMs what the server last said is left of the rolling hour (null: not told yet)
//   timed.offset          the server's clock minus the phone's
//   timed.request(mode, minutes)  asks; resolves with the server's answer ({ ok, reason, ... })
//   timed.onSosSent()     an SOS was sent: any hold is over at once (the server ends it too)
//
// `applyMode(mode, { minutes })` is App's own change of mode (the app's reports, the background
// service). It is called when the server grants a hold, when one ends, and when one is found again
// after reopening, so the app's mode always follows the server's.
//
// Notices are only ever about the person's own sharing: a heads-up HEADS_UP_BEFORE_MS before a hold
// ends (with "Hide again" while the allowance has time), and a clear one when it ends.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { notify, dismiss } from '../utils/notify';
import {
  TIMED_PRIVACY_ENABLED, HOLD_REQUEST_TIMEOUT_MS, HOLD_END_GRACE_MS,
  clockOffset, msLeft, headsUpDelayMs, clockLabel, hideAgainMinutes, rememberServerOffset,
} from '../utils/timedPrivacy';
import { TIMED_PRIVACY } from '../copy/group';

const holdFrom = (reply) => (reply && (reply.mode === 'FROZEN' || reply.mode === 'GHOST') && Number.isFinite(reply.until)
  ? { mode: reply.mode, until: reply.until }
  : null);

export function useTimedPrivacy({ socket, roomCode, inGroup, applyMode, enabled = TIMED_PRIVACY_ENABLED }) {
  const [heldState, setHold] = useState(null);
  // Only while in the Group: out of it, nothing is held here (a rejoin is told its hold again).
  const hold = inGroup ? heldState : null;
  const [allowanceLeftMs, setAllowanceLeftMs] = useState(null);
  const [offset, setOffset] = useState(0);
  // Whether the server has timed holds on: only once it says so (a 'sharing-hold', which it sends on
  // every admission when they are on and never when they are off, or a granted hold). Until then the app
  // is exactly as in js-1.1.87, whatever its own switch says.
  const [serverOn, setServerOn] = useState(false);
  const [pending, setPending] = useState(false);

  // Read at the moment something happens (socket handlers, timers), not when they were set up.
  const holdRef = useRef(null);
  const offsetRef = useRef(0);
  const allowanceRef = useRef(null);
  const applyRef = useRef(applyMode);
  useLayoutEffect(() => {
    applyRef.current = applyMode;
  });
  const headsUpRef = useRef(null); // { until, id } of the heads-up shown for the running hold

  const setHoldNow = (next) => {
    holdRef.current = next;
    setHold(next);
  };

  // What a reply or a 'sharing-hold' says: the clock, what is left, the hold.
  const learn = useCallback((reply, receivedAt) => {
    if (Number.isFinite(reply?.serverNow)) {
      const next = clockOffset(reply.serverNow, receivedAt);
      offsetRef.current = next;
      rememberServerOffset(next);
      setOffset(next);
    }
    if (Number.isFinite(reply?.allowanceLeftMs)) {
      allowanceRef.current = reply.allowanceLeftMs;
      setAllowanceLeftMs(reply.allowanceLeftMs);
    }
  }, []);

  // The hold is over (the server said so, the person went Live, an SOS, or its end passed with no
  // word from the server): Live again, and they are told once.
  const endHold = useCallback((reason) => {
    if (!holdRef.current) return;
    setHoldNow(null);
    if (headsUpRef.current?.id) dismiss(headsUpRef.current.id);
    headsUpRef.current = null;
    applyRef.current?.('ACTIVE');
    notify.success(TIMED_PRIVACY.ended[reason] ?? TIMED_PRIVACY.ended.expired, { haptic: false });
  }, []);

  const active = Boolean(enabled) && serverOn;

  /** Asks the server for `mode` (Paused or Hidden for `minutes`, or Live). Resolves with its answer. */
  const request = useCallback((mode, minutes) => new Promise((resolve) => {
    if (!enabled || !socket) {
      resolve({ ok: false, reason: 'off' });
      return;
    }
    let settled = false;
    setPending(true);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      setPending(false);
      notify.warning(TIMED_PRIVACY.unreachable);
      resolve({ ok: false, reason: 'timeout' });
    }, HOLD_REQUEST_TIMEOUT_MS);
    socket.emit('set-sharing-mode', { roomCode, mode, ...(mode === 'ACTIVE' ? {} : { minutes }) }, (reply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      setPending(false);
      const answer = reply ?? { ok: false, reason: 'no-answer' };
      learn(answer, Date.now());
      if (answer.ok) {
        setServerOn(true);
        const next = holdFrom(answer);
        if (next) {
          setHoldNow(next);
          applyRef.current?.(next.mode, { minutes: Math.ceil(msLeft(next.until, offsetRef.current) / 60000) });
        } else {
          endHold('resumed');
          applyRef.current?.('ACTIVE');
        }
      } else if (answer.reason === 'disabled') {
        // The server's own switch is off: the caller does what js-1.1.87 did.
        setServerOn(false);
      } else if (answer.reason === 'allowance' || answer.reason === 'bad-minutes') {
        notify.warning(TIMED_PRIVACY.refused(answer.allowanceLeftMs ?? 0));
      }
      resolve(answer);
    });
  }), [enabled, socket, roomCode, learn, endHold]);

  // The server's word: a hold (on admission, on every return, and when one starts on another phone of
  // theirs) and the end of one.
  useEffect(() => {
    // Listened for from before admission: the server sends 'sharing-hold' with 'access-granted'.
    if (!enabled || !socket) return undefined;
    const forThisGroup = (payload) => !payload?.roomCode || payload.roomCode === roomCode;
    const onHold = (payload) => {
      if (!forThisGroup(payload)) return;
      learn(payload, Date.now());
      setServerOn(true);
      const next = holdFrom(payload);
      if (next) {
        const fresh = holdRef.current?.until !== next.until || holdRef.current?.mode !== next.mode;
        setHoldNow(next);
        // Opened again mid-hold: the app takes the hold back up, countdown and all.
        if (fresh) applyRef.current?.(next.mode, { minutes: Math.ceil(msLeft(next.until, offsetRef.current) / 60000) });
      } else if (holdRef.current) {
        endHold('expired');
      }
    };
    const onEnded = (payload) => {
      learn(payload, Date.now());
      endHold(payload?.reason);
    };
    socket.on('sharing-hold', onHold);
    socket.on('sharing-hold-ended', onEnded);
    return () => {
      socket.off('sharing-hold', onHold);
      socket.off('sharing-hold-ended', onEnded);
    };
  }, [enabled, socket, inGroup, roomCode, learn, endHold]);

  // Out of the Group: nothing held here any more (the shown hold is already null, above).
  useEffect(() => {
    if (inGroup) return;
    holdRef.current = null;
    headsUpRef.current = null;
  }, [inGroup]);

  // The heads-up before the end, timed by the server's clock (shown at once for a hold with less
  // than that left, as after reopening late in one), and the end itself if the server's word is
  // late (the connection down): the hold never outlives its end time here.
  useEffect(() => {
    if (!hold) return undefined;
    const showHeadsUp = () => {
      if (headsUpRef.current?.until === hold.until) return; // once per hold
      const left = msLeft(hold.until, offsetRef.current);
      const minutes = hideAgainMinutes(allowanceRef.current, left);
      const id = notify.info(TIMED_PRIVACY.headsUp(clockLabel(hold.until, offsetRef.current)), {
        duration: Math.max(4000, left),
        haptic: false,
        ...(minutes >= 1 ? { action: { label: TIMED_PRIVACY.again[hold.mode], onClick: () => request(hold.mode, minutes) } } : {}),
      });
      headsUpRef.current = { until: hold.until, id };
    };
    const headsUp = setTimeout(showHeadsUp, headsUpDelayMs(hold.until, offsetRef.current));
    const lateEnd = setTimeout(() => endHold('expired'), msLeft(hold.until, offsetRef.current) + HOLD_END_GRACE_MS);
    return () => {
      clearTimeout(headsUp);
      clearTimeout(lateEnd);
    };
  }, [hold, request, endHold]);

  /** An SOS was sent: shown as Live at once (the server ends the hold too, and says so). */
  const onSosSent = useCallback(() => {
    if (enabled) endHold('sos');
  }, [enabled, endHold]);

  return { active, hold, allowanceLeftMs, offset, pending, serverOn, request, onSosSent };
}
