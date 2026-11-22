// Being discoverable (Stage 6): a person in no Group lets people nearby find them, and answers the
// invites that come. Only while it is on does the app ask for or send a position from the lobby;
// it stops the moment it is turned off, the person joins a Group, or the app goes to the background
// (it never runs there). utils/nearby.js has the switch and timings.
//
//   const d = useDiscoverable({ socket, enabled, inLobby, user, getIdToken, onAccepted, onServerOff });
//   d.on, d.starting      the toggle's state
//   d.setOn(true|false)   opt in (asks for location then) or out
//   d.invite              the invite being shown: { inviteId, fromName, expiresAt, serverNow, offset, shownAt }
//   d.respond(accept)     answers it; Accept goes through onAccepted(roomCode), the app's own join
import { useCallback, useEffect, useRef, useState } from 'react';
import { notify } from '../utils/notify';
import { NEARBY_ENABLED, NEARBY_POSITION_EVERY_MS, NEARBY_REQUEST_TIMEOUT_MS, fixPayload } from '../utils/nearby';
import { clockOffset } from '../utils/timedPrivacy';
import { NEARBY } from '../copy/group';

const RESPOND_WORDS = {
  expired: NEARBY.inviteExpired,
  used: NEARBY.inviteUsed,
  'no-invite': NEARBY.inviteGone,
  'no-group': NEARBY.inviteGone,
  blocked: NEARBY.inviteBlocked,
  'in-group': NEARBY.inviteInGroup,
};

export function useDiscoverable({ socket, inLobby, user, getIdToken, onAccepted, onServerOff, enabled = NEARBY_ENABLED, geolocation = globalThis.navigator?.geolocation }) {
  const [wanted, setWanted] = useState(false); // the person's choice
  const [starting, setStarting] = useState(false);
  const [invites, setInvites] = useState([]); // queued, oldest first
  const watchRef = useRef(null);
  const lastSentRef = useRef(0);
  const lastFixRef = useRef(null);
  const liveRef = useRef(false); // the server has said yes
  // Read when used, so a new `user` object or callback never restarts the watch or re-announces.
  const callbacks = useRef({ onAccepted, onServerOff, getIdToken, user });
  const invitesRef = useRef([]); // read by the socket handlers (state updaters stay pure)
  useEffect(() => {
    callbacks.current = { onAccepted, onServerOff, getIdToken, user };
    invitesRef.current = invites;
  });

  const on = Boolean(enabled) && inLobby && wanted;

  const stopWatching = useCallback(() => {
    if (watchRef.current !== null) geolocation?.clearWatch?.(watchRef.current);
    watchRef.current = null;
    lastFixRef.current = null;
  }, [geolocation]);

  // Tells the server: on, with who this is and where, or off.
  const announce = useCallback(async (fix) => {
    if (!socket) return;
    let idToken;
    try {
      idToken = await callbacks.current.getIdToken?.();
    } catch {
      // No token to be had: the server decides (it refuses unproven people where sign-in is required).
    }
    socket.emit('nearby-discoverable', {
      on: true,
      ...(idToken ? { idToken } : {}),
      user: { uid: callbacks.current.user?.uid, name: callbacks.current.user?.displayName },
      ...fix,
    }, (reply) => {
      if (reply?.ok) {
        liveRef.current = true;
        setStarting(false);
        return;
      }
      liveRef.current = false;
      setStarting(false);
      setWanted(false);
      if (reply?.reason === 'disabled') {
        callbacks.current.onServerOff?.();
        notify.info(NEARBY.unavailable, { haptic: false });
      } else if (reply?.reason !== 'in-group') {
        notify.warning(NEARBY.unreachable);
      }
    });
  }, [socket]);

  // While on: watch the position (this is when location is asked for), announce with the first fix,
  // then send a fresh one every NEARBY_POSITION_EVERY_MS.
  useEffect(() => {
    if (!on) {
      if (liveRef.current && socket) socket.emit('nearby-discoverable', { on: false });
      liveRef.current = false;
      stopWatching();
      return undefined;
    }
    if (!geolocation?.watchPosition) {
      setWanted(false);
      notify.warning(NEARBY.permissionDenied);
      return undefined;
    }
    setStarting(true);
    let announced = false;
    watchRef.current = geolocation.watchPosition(
      (position) => {
        const fix = fixPayload(position?.coords);
        if (!fix) return;
        lastFixRef.current = fix;
        if (!announced) {
          announced = true;
          lastSentRef.current = Date.now();
          announce(fix);
          return;
        }
        if (liveRef.current && Date.now() - lastSentRef.current >= NEARBY_POSITION_EVERY_MS) {
          lastSentRef.current = Date.now();
          socket?.emit('nearby-position', fix);
        }
      },
      (error) => {
        setStarting(false);
        setWanted(false);
        if (error?.code === 1) notify.warning(NEARBY.permissionDenied);
      },
      { enableHighAccuracy: true, maximumAge: NEARBY_POSITION_EVERY_MS, timeout: 20000 },
    );
    return () => stopWatching();
  }, [on, geolocation, socket, announce, stopWatching]);

  // A dropped connection forgets this on the server: say it again once back.
  useEffect(() => {
    if (!on || !socket) return undefined;
    const again = () => {
      if (lastFixRef.current) announce(lastFixRef.current);
    };
    socket.on('connect', again);
    return () => socket.off('connect', again);
  }, [on, socket, announce]);

  // Never in the background: going there turns it off, and the person is told on coming back.
  useEffect(() => {
    if (!on || typeof document === 'undefined') return undefined;
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      setWanted(false);
      notify.info(NEARBY.stoppedHidden, { duration: 0, haptic: false });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [on]);

  // Invites, and their running out, while discoverable (the server sends them to nobody else).
  useEffect(() => {
    if (!on || !socket) return undefined;
    const onInvite = (payload) => {
      if (typeof payload?.inviteId !== 'string') return;
      const invite = { ...payload, offset: clockOffset(payload.serverNow, Date.now()), shownAt: Date.now() };
      setInvites((list) => (list.some((i) => i.inviteId === invite.inviteId) ? list : [...list, invite]));
    };
    const onExpired = (payload) => {
      if (!invitesRef.current.some((i) => i.inviteId === payload?.inviteId)) return;
      invitesRef.current = invitesRef.current.filter((i) => i.inviteId !== payload.inviteId);
      setInvites(invitesRef.current);
      notify.info(NEARBY.inviteExpired, { haptic: false });
    };
    socket.on('nearby-invite', onInvite);
    socket.on('nearby-invite-expired', onExpired);
    return () => {
      socket.off('nearby-invite', onInvite);
      socket.off('nearby-invite-expired', onExpired);
    };
  }, [on, socket]);

  const invite = on ? invites[0] ?? null : null;

  /** Answers the invite on show. Accept: the server admits them, and the app joins the usual way. */
  const respond = useCallback((accept) => new Promise((resolve) => {
    const current = invites[0];
    if (!current || !socket) {
      resolve({ ok: false, reason: 'no-invite' });
      return;
    }
    setInvites((list) => list.filter((i) => i.inviteId !== current.inviteId));
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      notify.warning(NEARBY.unreachable);
      resolve({ ok: false, reason: 'timeout' });
    }, NEARBY_REQUEST_TIMEOUT_MS);
    socket.emit('nearby-respond', { inviteId: current.inviteId, accept }, (reply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const answer = reply ?? { ok: false, reason: 'no-answer' };
      if (answer.ok && accept && answer.roomCode) callbacks.current.onAccepted?.(answer.roomCode);
      else if (!answer.ok) notify.info(RESPOND_WORDS[answer.reason] ?? NEARBY.inviteGone, { haptic: false });
      resolve(answer);
    });
  }), [invites, socket]);

  return { on, starting, setOn: setWanted, invite, respond };
}
