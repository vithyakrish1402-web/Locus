// Short-lived, per-recipient inbox for the authenticated native background listener.
// Only enqueue AFTER the existing permissions, cooldown and personal mute checks.
export const PING_TTL_MS = 2 * 60 * 1000;
export function queueBackgroundPing(squad, uid, senderName, now = Date.now()) {
  if (!uid) return null;
  const rev = squad.pingRev = (squad.pingRev || 0) + 1;
  const ping = { rev, uid, senderName: String(senderName || 'A group member').slice(0, 80), expiresAt: now + PING_TTL_MS };
  squad.backgroundPings = [...(squad.backgroundPings || []).filter(p => p.expiresAt > now), ping].slice(-200);
  return ping;
}
export function pendingBackgroundPings(squad, uid, after, now = Date.now()) {
  if (after < 0) return [];
  return (squad?.backgroundPings || [])
    .filter(p => p.uid === uid && p.rev > after && p.expiresAt > now)
    .map(({ rev, senderName }) => ({ rev, senderName }));
}
