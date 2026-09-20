// Which squad room an incoming 'sos-broadcast' belongs to, or null if the sender
// isn't a member of any squad.
//
// The authoritative source is the squad roster (activeSquads[room].members), which
// is written at join/approval time. The `users` map is NOT: it's only populated by
// 'update-location', i.e. after the client has a GPS fix. Keying SOS off `users`
// meant a member with no fix yet (permission denied, indoors, just joined) had
// their distress beacon silently dropped while their button still said "SOS SENT".
//
// The client-claimed room is only honoured if the roster confirms the sender is in
// it, so it can't be used to broadcast into a squad the sender doesn't belong to.
export function resolveSosRoom(activeSquads, users, socketId, claimedRoomCode) {
  const isMemberOf = (room) =>
    typeof room === 'string' && Boolean(activeSquads[room]?.members?.includes(socketId));

  const recorded = users[socketId]?.roomCode;
  if (isMemberOf(recorded)) return recorded;
  if (isMemberOf(claimedRoomCode)) return claimedRoomCode;

  return Object.keys(activeSquads).find(isMemberOf) ?? null;
}
