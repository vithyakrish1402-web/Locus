// Request to leave (Stage 5): a member's own request, and the Group Lead's and moderators' list
// (utils/leaveRequests.js has the switch and the rules; backend/leaveRequests.js the server's).
//
//   const leave = useLeaveRequests({ socket, roomCode, inGroup, settings, canAnswer, onApproved });
//   leave.needsRequest     this Group's Leave is a request (the app's switch, and the Group says so)
//   leave.mine             { requestedAt, deadline } (server clock) while this person's request waits
//   leave.offset           the server's clock minus the phone's
//   leave.requests         the requests this Group Lead or moderator may answer
//   leave.request()        asks; resolves with the server's answer. 'not-required' or 'admin': the
//                          caller leaves the way js-1.1.87 did
//   leave.cancel()         takes the request back
//   leave.answer(uid, approved)
//
// `onApproved(auto)` is told when the request was approved (by someone, or by the clock): App takes
// the person back to the lobby. Everything here is a non-blocking notice; nothing is said about
// anyone but the person's own request, except to those who may answer it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { notify } from '../utils/notify';
import { LEAVE_APPROVAL_ENABLED, LEAVE_REQUEST_TIMEOUT_MS, leaveNeedsRequest, sortLeaveRequests } from '../utils/leaveRequests';
import { clockOffset, serverOffset } from '../utils/timedPrivacy';
import { LEAVE_REQUEST, LEAVE_REQUESTS } from '../copy/group';

export function useLeaveRequests({ socket, roomCode, inGroup, settings, canAnswer, myUid, onApproved, enabled = LEAVE_APPROVAL_ENABLED }) {
  const [mineState, setMine] = useState(null);
  const [requestsState, setRequests] = useState([]);
  const [offset, setOffset] = useState(() => serverOffset());
  const [pending, setPending] = useState(false);
  const approvedRef = useRef(onApproved);
  // Read by the socket handlers at the moment an event comes (state updaters must stay pure).
  const mineRef = useRef(null);
  const requestsRef = useRef([]);
  useEffect(() => {
    approvedRef.current = onApproved;
    mineRef.current = mineState;
    requestsRef.current = requestsState;
  });

  const needsRequest = inGroup && leaveNeedsRequest(enabled, settings, roomCode);
  // Out of the Group, or in one that does not need it, nothing is shown.
  const mine = needsRequest ? mineState : null;
  const requests = needsRequest && canAnswer ? requestsState : [];

  const learnClock = useCallback((payload) => {
    if (Number.isFinite(payload?.serverNow)) setOffset(clockOffset(payload.serverNow, Date.now()));
  }, []);

  // Asks the server, waiting at most LEAVE_REQUEST_TIMEOUT_MS. Resolves with its answer.
  const ask = useCallback((event, payload) => new Promise((resolve) => {
    let settled = false;
    setPending(true);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      setPending(false);
      notify.warning(LEAVE_REQUEST.unreachable);
      resolve({ ok: false, reason: 'timeout' });
    }, LEAVE_REQUEST_TIMEOUT_MS);
    socket.emit(event, payload, (reply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      setPending(false);
      resolve(reply ?? { ok: false, reason: 'no-answer' });
    });
  }), [socket]);

  const request = useCallback(async () => {
    if (!needsRequest || !socket) return { ok: false, reason: 'not-required' };
    const answer = await ask('request-leave', { roomCode });
    if (answer.ok) {
      learnClock(answer);
      setMine({ requestedAt: answer.requestedAt, deadline: answer.deadline });
      notify.info(LEAVE_REQUEST.sent, { haptic: false });
    }
    return answer;
  }, [needsRequest, socket, ask, roomCode, learnClock]);

  const cancel = useCallback(async () => {
    if (!socket) return { ok: false };
    const answer = await ask('cancel-leave', { roomCode });
    if (answer.ok || answer.reason === 'no-request') setMine(null);
    return answer;
  }, [socket, ask, roomCode]);

  const answer = useCallback(async (uid, approved) => {
    if (!socket) return { ok: false };
    const reply = await ask('resolve-leave', { roomCode, uid, approved });
    if (reply.ok || reply.reason === 'no-request') setRequests((list) => list.filter((r) => r.uid !== uid));
    if (!reply.ok && reply.reason !== 'timeout') notify.warning(LEAVE_REQUESTS.refused[reply.reason] ?? LEAVE_REQUESTS.gone);
    return reply;
  }, [socket, ask, roomCode]);

  // The server's word, while in a Group whose Leave is a request.
  useEffect(() => {
    if (!socket || !needsRequest) return undefined;
    const forThisGroup = (payload) => !payload?.roomCode || payload.roomCode === roomCode;
    const onPending = (payload) => {
      if (!forThisGroup(payload)) return;
      learnClock(payload);
      setMine({ requestedAt: payload.requestedAt, deadline: payload.deadline });
    };
    const onApprovedEvent = (payload) => {
      if (!forThisGroup(payload)) return;
      setMine(null);
      notify.success(payload?.auto ? LEAVE_REQUEST.approvedAuto : LEAVE_REQUEST.approved, { haptic: false });
      approvedRef.current?.(Boolean(payload?.auto));
    };
    const onRejected = (payload) => {
      if (!forThisGroup(payload)) return;
      setMine(null);
      notify.info(LEAVE_REQUEST.rejected(payload?.byName ?? null), { haptic: false });
    };
    const onCancelled = (payload) => {
      if (!forThisGroup(payload)) return;
      setMine(null);
      notify.info(payload?.reason === 'took-command' ? LEAVE_REQUEST.tookCommand : LEAVE_REQUEST.cancelled, { haptic: false });
    };
    // A request closed: off the list; and, if it was this person's own and nothing else said why, so.
    const onWithdrawn = (payload) => {
      if (!forThisGroup(payload)) return;
      requestsRef.current = requestsRef.current.filter((r) => r.uid !== payload?.uid);
      setRequests(requestsRef.current);
      if (payload?.uid && payload.uid === myUid && ['removed', 'gone'].includes(payload.reason) && mineRef.current) {
        mineRef.current = null;
        setMine(null);
        notify.info(LEAVE_REQUEST.gone, { haptic: false });
      }
    };
    const onRequest = (payload) => {
      if (!forThisGroup(payload) || !canAnswer) return;
      learnClock(payload);
      const fresh = !requestsRef.current.some((r) => r.uid === payload.uid);
      const next = sortLeaveRequests([...requestsRef.current.filter((r) => r.uid !== payload.uid), payload]);
      requestsRef.current = next;
      setRequests(next);
      // Only a new one is announced: the server re-sends the list to whoever takes command.
      if (fresh) notify.info(LEAVE_REQUESTS.newNotice(payload.name), { haptic: false });
    };
    socket.on('leave-request-pending', onPending);
    socket.on('leave-approved', onApprovedEvent);
    socket.on('leave-rejected', onRejected);
    socket.on('leave-request-cancelled', onCancelled);
    socket.on('leave-request-withdrawn', onWithdrawn);
    socket.on('leave-request', onRequest);
    return () => {
      socket.off('leave-request-pending', onPending);
      socket.off('leave-approved', onApprovedEvent);
      socket.off('leave-rejected', onRejected);
      socket.off('leave-request-cancelled', onCancelled);
      socket.off('leave-request-withdrawn', onWithdrawn);
      socket.off('leave-request', onRequest);
    };
  }, [socket, needsRequest, roomCode, canAnswer, myUid, learnClock]);

  // The Group Lead and moderators: the list as it stands, on opening the Group and on becoming one.
  useEffect(() => {
    if (!socket || !needsRequest || !canAnswer) return;
    socket.emit('get-leave-requests', { roomCode }, (reply) => {
      if (!reply?.ok) return;
      learnClock(reply);
      requestsRef.current = sortLeaveRequests(reply.requests);
      setRequests(requestsRef.current);
    });
  }, [socket, needsRequest, canAnswer, roomCode, learnClock]);

  return { needsRequest, mine, requests, offset, pending, request, cancel, answer };
}
