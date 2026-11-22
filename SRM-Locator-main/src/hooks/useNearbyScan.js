// Pressing Nearby (Stage 6): the Group Lead or a moderator (or someone in no group, who first makes
// one) looks for people close by and invites them. Names only, never where anyone is; each person
// still has to accept. utils/nearby.js has the switch and timings.
//
//   const n = useNearbyScan({ socket, roomCode, onServerOff });
//   n.state       'idle' | 'scanning' | 'done' | 'rough' | 'limited' | 'unreachable'
//   n.rows        [{ id, name, selected, status: 'idle'|'invited'|'joined'|'declined'|'expired' }]
//   n.scan()      this phone's position now (with its accuracy), then the server's list
//   n.toggle(id), n.invite(ids), n.inviteAll()
import { useCallback, useEffect, useRef, useState } from 'react';
import { notify } from '../utils/notify';
import { NEARBY_FIX_TIMEOUT_MS, NEARBY_REQUEST_TIMEOUT_MS, answerStatus, fixPayload, mergeInviteResults } from '../utils/nearby';
import { NEARBY } from '../copy/group';

const ANSWER_NOTICE = { joined: NEARBY.joinedNotice, declined: NEARBY.declinedNotice, expired: NEARBY.expiredNotice };

export function useNearbyScan({ socket, roomCode, onServerOff, geolocation = globalThis.navigator?.geolocation }) {
  const [state, setState] = useState('idle');
  const [rows, setRows] = useState([]);
  const rowsRef = useRef([]);
  const offRef = useRef(onServerOff);
  useEffect(() => {
    offRef.current = onServerOff;
    rowsRef.current = rows;
  });

  const setRowsNow = (next) => {
    rowsRef.current = next;
    setRows(next);
  };

  // The server, with a timeout: resolves with its answer, or { ok: false, reason: 'timeout' }.
  const ask = useCallback((event, payload) => new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, reason: 'timeout' });
    }, NEARBY_REQUEST_TIMEOUT_MS);
    socket.emit(event, payload, (reply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(reply ?? { ok: false, reason: 'no-answer' });
    });
  }), [socket]);

  // This phone's position now, with its accuracy (null when it can't be had).
  const hereNow = useCallback(() => new Promise((resolve) => {
    if (!geolocation?.getCurrentPosition) {
      resolve(null);
      return;
    }
    geolocation.getCurrentPosition(
      (position) => resolve(fixPayload(position?.coords)),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: NEARBY_FIX_TIMEOUT_MS },
    );
  }), [geolocation]);

  const scan = useCallback(async () => {
    if (!socket || !roomCode) return;
    setState('scanning');
    const here = await hereNow();
    const reply = await ask('nearby-scan', { roomCode, ...(here ?? {}) });
    if (reply.ok) {
      setRowsNow((reply.people ?? []).map((p) => ({ id: p.id, name: p.name, selected: false, status: 'idle' })));
      setState(reply.hereUsable === false ? 'rough' : 'done');
    } else if (reply.reason === 'too-many') {
      setState('limited');
    } else if (reply.reason === 'disabled') {
      setState('idle');
      offRef.current?.();
      notify.info(NEARBY.unavailable, { haptic: false });
    } else {
      setState('unreachable');
    }
  }, [socket, roomCode, hereNow, ask]);

  const toggle = useCallback((id) => {
    setRowsNow(rowsRef.current.map((row) => (row.id === id && row.status === 'idle' ? { ...row, selected: !row.selected } : row)));
  }, []);

  const send = useCallback(async (payload) => {
    if (!socket) return { ok: false };
    const reply = await ask('nearby-invite', { roomCode, ...payload });
    if (reply.ok) setRowsNow(mergeInviteResults(rowsRef.current, reply.sent).map((row) => ({ ...row, selected: false })));
    else if (reply.reason === 'disabled') offRef.current?.();
    else notify.warning(NEARBY.unreachable);
    return reply;
  }, [socket, roomCode, ask]);

  const invite = useCallback((ids) => send({ ids }), [send]);
  const inviteAll = useCallback(() => send({ all: true }), [send]);

  // Each answer, as it comes: the row says so, and a short notice too.
  useEffect(() => {
    if (!socket || !roomCode) return undefined;
    const onAnswered = (payload) => {
      if (payload?.roomCode && payload.roomCode !== roomCode) return;
      const status = answerStatus(payload);
      const known = rowsRef.current.some((row) => row.inviteId && row.inviteId === payload?.inviteId);
      if (known) setRowsNow(rowsRef.current.map((row) => (row.inviteId === payload.inviteId ? { ...row, status } : row)));
      const words = ANSWER_NOTICE[status](payload?.name);
      if (status === 'joined') notify.success(words, { haptic: false });
      else notify.info(words, { haptic: false });
    };
    socket.on('nearby-invite-answered', onAnswered);
    return () => socket.off('nearby-invite-answered', onAnswered);
  }, [socket, roomCode]);

  const reset = useCallback(() => {
    setState('idle');
    setRowsNow([]);
  }, []);

  return { state, rows, scan, toggle, invite, inviteAll, reset };
}
