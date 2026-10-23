import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { resolveSosRoom, recordSos, coalesceSos, toSosPayload, pendingSosFor, ackSos, memberKey, sharedSquad } from './sosRelay.js';
import {
  rememberMember, forgetMember, rebindReturningMember, collectStaleSocketIds,
  refuseJoin, addPendingRequest, takePendingRequest, withdrawPendingRequests, pendingRequestsOf,
  isKnownMember, commanderOf,
} from './squadRoster.js';
import { toTelemetryRecord } from './telemetry.js';
import { evaluateAlertPermission, DEFAULT_RULES_CONFIG } from './alertRules.js';
import {
  PING_WINDOW_MIN, SOS_COALESCE_SEC, SOS_REPEAT_FLAG_COUNT, SOS_REPEAT_WINDOW_MIN, ALERT_LOG_SIZE,
  SETTINGS_RESTORE_TTL_HOURS, forceClassHoursStatus, classClock, guardStartupLine,
} from './alertConfig.js';
import {
  settingsOf, canChangeSettings, updateSwitches, isPingerMuted, setPingerMuted,
  setPersonallyMuted, isPersonallyMuted, settingsFor, createSettingsStore,
} from './groupSettings.js';
import { logAlert, pingHistory, recordPing, noteSosAttempt } from './alertLog.js';
import {
  setPresence, presenceOf, livePresence, hasPresence, removePresence, expirePresence,
  presenceKey, uidOfPresenceKey, liveUids,
} from './presence.js';
import { chooseSource, PRESENCE } from './displaySource.js';
import { createIdTokenVerifier } from './identity.js';
import { createSosWatch } from './sosWatch.js';
import {
  createBackgroundRouter, backgroundConfig, backgroundStartupLine, endSession, endAllSessions,
} from './backgroundSharing.js';
import {
  ROLE_ADMIN, ROLE_MODERATOR, roleOf, can, canActOn, canSetModerators, setModerator, dropModerator,
  rememberBlocked, forgetBlocked, blockedList,
} from './groupRoles.js';
import { ACTIVITY, logActivity, activityOf, noteSharingMode, forgetSharingMode } from './activityLog.js';
import { createJoinNotifier } from './joinNotify.js';

const app = express();
app.use(cors());
// One proxy hop (Render's): lets req.ip be the caller rather than the proxy, for rate limits.
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- STATE MANAGERS ---
// Keyed by client-chosen room codes, so no prototype: on a plain {} a code like
// 'constructor' or '__proto__' already "exists" (as Object / Object.prototype), with
// no members list, and the first handler to read squad.members threw and took the
// whole server down.
const activeSquads = Object.create(null);
const users = {};
const locationCache = {};

// --- BACKGROUND SHARING (backgroundSharing.js) ---
// HTTPS endpoints for a phone reporting its position while LOCUS is closed. Off unless
// LOCUS_BACKGROUND_SHARING_ENABLED=true and LOCUS_DEVICE_TOKEN_SECRET is set; off, they answer 503
// and nothing else changes. Mounted before the general JSON parser: they bring their own, with a
// much smaller limit.
const backgroundSettings = backgroundConfig();
console.log(backgroundStartupLine(backgroundSettings));
// Rung when an SOS is raised or updated in a Group, so a phone listening for it from the
// background (GET /api/background/sos) hears at once instead of at its next question.
const sosWatch = createSosWatch();
app.use('/api/background', createBackgroundRouter({
  config: backgroundSettings,
  sosWatch,
  verifyIdToken: createIdTokenVerifier().verifyIdToken,
  getSquad: (roomCode) => activeSquads[roomCode],
  accept: (roomCode, uid, report, now) => acceptBackgroundPosition(roomCode, uid, report, now),
  endSharing: (roomCode, uid) => endSharing(roomCode, uid),
}));
app.use(express.json());

// --- 🧹 STALE SQUAD SWEEP ---
// Defense-in-depth against ghost rooms: mobile clients that get killed/backgrounded
// don't always fire a clean 'disconnect', so a squad can be left with a dead owner
// or dead members for a while. Prune anything with no live members or no activity
// for 5+ minutes so an old test-session code can't shadow a new one.
//
// Deliberately NOT killing a squad just because the owner's socket looks offline
// at this exact instant ("!ownerIsLive" used to be an immediate kill switch here):
// that fires on any brief reconnect (app backgrounded, signal blip — normal on
// mobile), and this sweep runs every 60s, so it was routinely nuking perfectly
// live squads — with other members still actively connected — out from under
// everyone mid-session. `isStale` already covers real abandonment: lastActivity
// is refreshed by any live member's traffic, not just the owner's, so an owner
// who's genuinely gone for good still gets caught once nobody's been active for
// the full TTL.
//
// "Any live member's traffic" used to mean GPS reports ('update-location') and nothing
// else, so a squad where nobody had a fix (indoors, location denied, GPS timing out) was
// deleted with every member still connected. Their phones kept the code, and the next
// reconnect re-created a different squad under it. The latency probe that every joined
// client sends every 2 seconds ('check-ping') now counts too.
//
// Both timings can be shortened through the environment, which is only for the e2e tests
// (tests/squadSweep.e2e.test.js): minutes are too long to wait for in a test run.
const ROOM_TTL_MS = Number(process.env.LOCUS_ROOM_TTL_MS) || 5 * 60 * 1000;
const SWEEP_INTERVAL_MS = Number(process.env.LOCUS_SWEEP_INTERVAL_MS) || 60 * 1000;
const sweepTimer = setInterval(() => {
  const now = Date.now();
  expireLeases(now);
  for (const roomCode in activeSquads) {
    const squad = activeSquads[roomCode];
    squad.members = squad.members.filter(id => io.sockets.sockets.has(id));

    // Someone still sharing their position from the background (presence.js) holds the squad
    // open: they count as activity, and as members, until their lease runs out.
    const held = hasPresence(squad, now);
    const isStale = !held && now - (squad.lastActivity || 0) > ROOM_TTL_MS;

    if ((squad.members.length === 0 && !held) || isStale) {
      console.log(`[🧹 SWEEP] Removing abandoned/stale squad: ${roomCode}`);
      deleteSquad(roomCode);
    }
  }
}, SWEEP_INTERVAL_MS);

// A lease that runs out is noticed within this long. (Only the e2e tests shorten it.)
const PRESENCE_CHECK_MS = Number(process.env.LOCUS_PRESENCE_CHECK_MS) || 5 * 1000;
const presenceTimer = setInterval(() => expireLeases(Date.now()), PRESENCE_CHECK_MS);

// Every deletion of a squad comes through here, so nothing it leaves behind outlives it.
function deleteSquad(roomCode) {
  const squad = activeSquads[roomCode];
  if (!squad) return;
  // Whoever is still waiting to be let in would otherwise sit in the waiting room forever,
  // waiting on a Commander who no longer exists.
  for (const targetId of Object.keys(squad.pending ?? {})) {
    io.to(targetId).emit('squad-not-found', { roomCode });
  }
  // And no socket stays subscribed to the room. Deleting only the squad left its members
  // listening, so a squad founded later under the same code broadcast its rally points
  // and SOS to the old squad's phones.
  io.in(roomCode).socketsLeave(roomCode);
  joinNotifier.cancel(roomCode);
  delete activeSquads[roomCode];
}

// --- SOS / PING GUARD (alertRules.js decides; this gathers the input and acts) ---
// Group settings outlast the squad that holds them (see groupSettings.js). Set
// LOCUS_SETTINGS_FILE to a path on storage that survives a restart to keep them across one.
const settingsStore = createSettingsStore({
  filePath: process.env.LOCUS_SETTINGS_FILE || null,
  ttlMs: SETTINGS_RESTORE_TTL_HOURS * 60 * 60 * 1000,
});

const forced = forceClassHoursStatus();
console.log(guardStartupLine({ quietZonesEnabled: DEFAULT_RULES_CONFIG.quietZonesEnabled, forceClassHours: forced.forced }));
if (forced.forced) {
  console.warn('[⚠️  GUARD] LOCUS_FORCE_CLASS_HOURS is ON: every moment counts as class time. Demo/testing only.');
}
if (forced.refused) {
  console.error('[⚠️  GUARD] LOCUS_FORCE_CLASS_HOURS ignored: NODE_ENV is production and LOCUS_ALLOW_FORCE_IN_PRODUCTION is not "true".');
}
if (classClock() !== null) {
  console.warn('[⚠️  GUARD] LOCUS_CLASS_CLOCK_ISO pins the class-hours clock. Tests only.');
}

// A person's stable identity on this squad: their uid, else (an old client) their socket id.
const keyOf = (squad, socketId) =>
  memberKey(squad?.memberUids?.[socketId] || io.sockets.sockets.get(socketId)?.data?.uid, socketId);

// --- ROLES (groupRoles.js has the permissions table) ---
const uidOfSocket = (squad, socketId) => squad?.memberUids?.[socketId] || io.sockets.sockets.get(socketId)?.data?.uid || null;
const roleOfSocket = (squad, socketId) => roleOf(squad, socketId, uidOfSocket(squad, socketId));
// The connected sockets of everyone allowed `action` (the main admin and/or moderators).
const socketsAllowed = (squad, action) =>
  (squad?.members ?? []).filter((id) => io.sockets.sockets.has(id) && can(roleOfSocket(squad, id), action));

// Each member is told their own role, and everyone who the moderators are (socket ids, as the
// member list uses them), whenever it may have changed. The main admin is the role-less 'OWNER'
// of access-granted, as before.
function sendGroupRole(target, squad, roomCode) {
  const moderatorIds = squad.members.filter((id) => roleOfSocket(squad, id) === ROLE_MODERATOR);
  target.emit('group-role', { roomCode, role: roleOfSocket(squad, target.id), moderatorIds });
}
function broadcastGroupRoles(roomCode) {
  const squad = activeSquads[roomCode];
  if (!squad) return;
  for (const id of squad.members) {
    const member = io.sockets.sockets.get(id);
    if (member) sendGroupRole(member, squad, roomCode);
  }
}

// --- ACTIVITY LOG (activityLog.js) ---
// Logged, and sent at once to whoever may read the log and is connected.
function recordActivity(roomCode, entry) {
  const squad = activeSquads[roomCode];
  const logged = squad && logActivity(squad, entry);
  if (!logged) return;
  for (const id of socketsAllowed(squad, 'readActivityLog')) io.to(id).emit('activity-entry', { roomCode, entry: logged });
}
const nameOf = (squad, socketId) =>
  io.sockets.sockets.get(socketId)?.data?.profile?.name ?? users[socketId]?.name ?? squad?.profiles?.[uidOfSocket(squad, socketId)]?.name ?? null;

// --- JOIN REQUESTS WAITING (joinNotify.js) ---
// One message per burst of requests to everyone who may admit, with how many are waiting then.
// PUSH SEAM: `joinRequestsWaiting` below is where the phone-notification pipeline (being built
// separately) is meant to hook in, for admitters whose app is closed. Until it does, only
// connected admitters hear it, and the count waits for the others on squad.pending.
function joinRequestsWaiting(roomCode) {
  const squad = activeSquads[roomCode];
  const count = Object.keys(squad?.pending ?? {}).length;
  if (!squad || count === 0) return;
  for (const id of socketsAllowed(squad, 'seeJoinQueue')) io.to(id).emit('join-requests-waiting', { roomCode, count });
}
const joinNotifier = createJoinNotifier({ deliver: joinRequestsWaiting });

// Where the server last saw `socketId`, as alertRules.js wants it. accuracyM is only there
// once phones send an accuracy; until then it is unknown, which is never held against them.
function lastKnownLocation(socketId, now) {
  const u = users[socketId];
  if (!u || !Number.isFinite(u.lat) || !Number.isFinite(u.lng)) return null;
  return { lat: u.lat, lng: u.lng, ageMs: now - (u.lastSeen ?? 0), accuracyM: Number.isFinite(u.accuracy) ? u.accuracy : undefined };
}

// The one place a verdict is asked for. Every SOS and Ping the server relays goes through it.
function decideAlert({ type, squad, senderId, targetId = null, now }) {
  const senderKey = keyOf(squad, senderId);
  return evaluateAlertPermission({
    type,
    settings: settingsOf(squad),
    senderMuted: isPingerMuted(squad, senderKey),
    location: lastKnownLocation(senderId, now),
    history: type === 'ping'
      ? pingHistory(squad, senderKey, keyOf(squad, targetId), now, PING_WINDOW_MIN * 60 * 1000)
      : { lastSosAt: squad.sosSentAt?.[senderKey] ?? null },
    now,
    classNow: classClock() ?? now,
  }, DEFAULT_RULES_CONFIG);
}

// Tell the sender what happened to their alert, and keep it in the Group's log (which the
// Group Lead can read, and is sent each new entry as it happens).
function reportAlert(socket, squad, roomCode, type, verdict, now, extra = {}) {
  const name = socket.data?.profile?.name ?? null;
  const entry = logAlert(squad, {
    at: now, type, senderId: socket.id, senderName: name,
    allowed: verdict.allowed, mode: verdict.mode, reasonCode: verdict.reasonCode, ...extra,
  }, ALERT_LOG_SIZE);
  socket.emit('alert-result', {
    type, roomCode, allowed: verdict.allowed, mode: verdict.mode, reasonCode: verdict.reasonCode,
    ...(verdict.retryAfterSec ? { retryAfterSec: verdict.retryAfterSec } : {}),
  });
  if (squad.ownerId && squad.ownerId !== socket.id) io.to(squad.ownerId).emit('alert-log-entry', { roomCode, entry });
}

// A Group's switches and mutes, as each member should see them.
function sendGroupSettings(target, squad, roomCode) {
  target.emit('group-settings', settingsFor(squad, roomCode, {
    key: keyOf(squad, target.id),
    isLead: squad.ownerId === target.id,
    keyOf: (id) => keyOf(squad, id),
  }));
}
function broadcastGroupSettings(roomCode) {
  const squad = activeSquads[roomCode];
  if (!squad) return;
  for (const id of squad.members) {
    const member = io.sockets.sockets.get(id);
    if (member) sendGroupSettings(member, squad, roomCode);
  }
}
// Remember the Group's settings past the squad itself, but only once anyone has set any.
function persistGroupSettings(roomCode) {
  const squad = activeSquads[roomCode];
  if (squad?.settings) settingsStore.save(roomCode, commanderOf(squad), squad.settings);
}

// The squad's roster, as everyone else's member list and map see it.
//
// Built from `squad.members` — the authoritative roster — rather than only from whoever
// has sent telemetry. `users` fills in on the first GPS fix, so a member who is indoors,
// has denied location permission, or has simply just been approved used to be missing
// from this payload altogether: absent from the squad list as well as the map. They now
// come through with their telemetry merged in where there is any and `hasFix: false`
// where there isn't, so the client can list them without trying to plot them.
//
// Every entry carries `uid`, the person's stable identity. Socket ids are reminted on
// every mobile reconnect, and a client holding only socket ids cannot tell "same person,
// new socket" — which is what left a returning member buried under an orphaned ghost
// marker of themselves that nothing could clear.
// Whose background (presence) position the Group should see instead of a connected socket's.
// A person with a live socket AND a presence entry normally shows as the socket. When the socket
// has gone quiet (its app is paused, the WebView frozen, the server not yet aware it is dead) and
// the service has reported something newer, the newer one is shown (displaySource.js has the
// rules, including not flapping). Only people with both feeds are looked at: with no presence
// entry nothing changes. Returns the set of uids for whom presence wins.
function presenceWins(squad, now) {
  const winners = new Set();
  if (!squad) return winners;
  const newestLive = new Map(); // uid -> newest update across their connected sockets that have a fix
  for (const id of squad.members) {
    const uid = squad.memberUids?.[id];
    const seen = users[id]?.lastSeen;
    if (!uid || !io.sockets.sockets.has(id) || !Number.isFinite(seen)) continue;
    newestLive.set(uid, Math.max(newestLive.get(uid) ?? -Infinity, seen));
  }
  const both = new Set();
  for (const entry of livePresence(squad, now)) {
    const liveLastSeen = newestLive.get(entry.uid);
    if (liveLastSeen === undefined) continue;
    both.add(entry.uid);
    squad.displaySource ??= Object.create(null);
    const choice = chooseSource({
      liveLastSeen, presenceLastSeen: entry.lastSeen, now, previous: squad.displaySource[entry.uid],
    });
    squad.displaySource[entry.uid] = choice;
    if (choice.source === PRESENCE) winners.add(entry.uid);
  }
  // A choice is only remembered while the person has both feeds.
  for (const uid of Object.keys(squad.displaySource ?? {})) if (!both.has(uid)) delete squad.displaySource[uid];
  return winners;
}

// The uids whose background service holds a PAUSED spot (status FROZEN, lease running) while none
// of their connections in the squad has a position at all. That is someone who opened the app again
// while sharing is paused: a paused app sends nothing newer than where it paused, and a fresh
// connection has nothing. Their position-less connection used to hide the service's Paused marker,
// so the Group saw them in the list and not on the map. For these people the service's entry is
// shown instead (one entry each). Only a pause: a live service and a connection still waiting for
// its first fix stay as displaySource.js left them (the connection is shown).
function fixlessPresenceUids(squad, roomCode, now) {
  const result = new Set();
  if (!squad) return result;
  const withFix = new Set();
  for (const id of Object.keys(users)) {
    if (users[id].roomCode !== roomCode) continue;
    const uid = squad.memberUids?.[id] || io.sockets.sockets.get(id)?.data?.uid;
    if (uid) withFix.add(uid);
  }
  for (const entry of livePresence(squad, now)) {
    if (entry.status === 'FROZEN' && !withFix.has(entry.uid)) result.add(entry.uid);
  }
  return result;
}

function broadcastSquadUpdate(roomCode) {
  const squad = activeSquads[roomCode];
  const ids = new Set(squad ? squad.members : []);
  const winners = presenceWins(squad, Date.now());
  Object.keys(users).forEach(id => { if (users[id].roomCode === roomCode) ids.add(id); });
  const fixless = fixlessPresenceUids(squad, roomCode, Date.now());

  const roomUsers = {};
  ids.forEach(id => {
    const telemetry = users[id];
    if (telemetry && telemetry.roomCode !== roomCode) return;
    const live = io.sockets.sockets.get(id);
    // A roster entry whose socket is gone and which never reported a fix: there is
    // nothing to show, and its own disconnect handler is about to prune it anyway.
    if (!telemetry && !live) return;

    const uid = squad?.memberUids?.[id] || live?.data?.uid || null;
    // Their background position is fresher than this frozen socket's: shown below instead, never both.
    if (telemetry && uid && winners.has(uid)) return;
    // No position on this connection, one from the background: that one is shown below, never both.
    if (!telemetry && uid && fixless.has(uid)) return;
    const profile = live?.data?.profile || {};
    // Hidden means hidden: a member sharing as GHOST is listed, but nobody is sent where they are.
    const hidden = telemetry?.status === 'GHOST';
    roomUsers[id] = telemetry
      ? (hidden
          ? { uid, roomCode, name: telemetry.name, photo: telemetry.photo, status: 'GHOST', speed: 0, heading: 0, battery: telemetry.battery, lastSeen: telemetry.lastSeen, hasFix: false, role: roleOf(squad, id, uid) }
          : { ...telemetry, uid, hasFix: true, role: roleOf(squad, id, uid) })
      : {
          uid,
          roomCode,
          name: profile.name,
          photo: profile.photo,
          status: 'ACTIVE',
          speed: 0,
          heading: 0,
          battery: 0,
          hasFix: false,
          role: roleOf(squad, id, uid),
        };
  });

  // People still sharing from the background (presence.js): on the map and in the list, keyed
  // apart from any socket. Not when they also have a connection on the roster, which already
  // shows them: one person is never two markers.
  if (squad) {
    const connected = liveUids(squad, (id) => io.sockets.sockets.has(id));
    for (const entry of livePresence(squad, Date.now())) {
      if (connected.has(entry.uid) && !winners.has(entry.uid) && !fixless.has(entry.uid)) continue;
      roomUsers[presenceKey(entry.uid)] = {
        uid: entry.uid,
        roomCode,
        name: entry.name,
        photo: entry.photo,
        lat: entry.lat,
        lng: entry.lng,
        speed: entry.speed,
        heading: entry.heading,
        battery: entry.battery,
        ...(entry.accuracy === null ? {} : { accuracy: entry.accuracy }),
        status: entry.status,
        lastSeen: entry.lastSeen,
        hasFix: true,
        presence: true,
      };
    }
  }
  io.to(roomCode).emit('users-update', roomUsers);
}

// A presence lease that has run out: the person is gone from the map and the list, and the
// Group is told their signal is lost (the same notice a dropped connection raises, after a
// grace period the phone itself set). Not for someone who has a connection on the roster.
function expireLeases(now) {
  for (const roomCode in activeSquads) {
    const squad = activeSquads[roomCode];
    const expired = expirePresence(squad, now);
    if (expired.length === 0) continue;
    const connected = liveUids(squad, (id) => io.sockets.sockets.has(id));
    for (const entry of expired) {
      if (connected.has(entry.uid)) continue;
      io.to(roomCode).emit('member-signal-lost', {
        targetId: presenceKey(entry.uid),
        uid: entry.uid,
        name: entry.name,
        photo: entry.photo,
        lastKnownLocation: {
          latitude: entry.lat,
          longitude: entry.lng,
          speed: entry.speed,
          heading: entry.heading,
          batteryLevel: entry.battery,
        },
        timeDelta: (now - entry.lastSeen) / 1000,
        disconnectTime: new Date(now).toISOString(),
      });
    }
    broadcastSquadUpdate(roomCode);
  }
}

// The person stops sharing (their own choice, through the endpoint): off the map without a
// "signal lost", since they did not go dark, they went away. Their session is ended by the caller.
function endSharing(roomCode, uid) {
  const squad = activeSquads[roomCode];
  if (!squad) return;
  if (removePresence(squad, uid)) broadcastSquadUpdate(roomCode);
}

// Ends every device token `uid` holds, in every squad. (Leaving, a vote-out and a block already
// end the one for their squad; this is for anything that must cut a person off everywhere.)
export function revokeAllDeviceTokens(uid) {
  return endAllSessions(activeSquads, uid);
}

// A position reported by a phone that is sharing without a socket (the background service),
// for the squad `roomCode`. The endpoint that receives those reports calls this for each one
// it has authenticated. Refuses, with a reason, anyone the Commander has not admitted or has
// blocked, and a Group that no longer exists. Otherwise it renews the person's lease (see
// presence.js), counts as the Group's activity, and puts them on everyone's map.
export function acceptBackgroundPosition(roomCode, uid, report, now = Date.now()) {
  const squad = activeSquads[roomCode];
  if (!squad) return { ok: false, reason: 'no-group' };
  if (squad.blockedUids?.includes(uid)) return { ok: false, reason: 'blocked' };
  if (!isKnownMember(squad, uid)) return { ok: false, reason: 'not-member' };
  const entry = setPresence(squad, uid, report, now);
  if (!entry) return { ok: false, reason: 'bad-report' };
  squad.lastActivity = now;
  broadcastSquadUpdate(roomCode);
  return { ok: true, leaseUntil: entry.leaseUntil };
}

io.on('connection', (socket) => {
  console.log(`🟢 Node Connected: ${socket.id}`);

  // A note on payloads: a handler that throws is an uncaught exception, which kills the
  // whole process (and every squad with it, since nothing is persisted). A client can
  // send no payload, or null, so every handler reads its payload through `?? {}` — a
  // `= {}` parameter default only covers the first of those.

  // Whether this socket is on the roster of `roomCode`. The relays below fan out to a
  // room the client names; they used to take that name on trust, so any socket — in no
  // squad, or in another one — could push alerts, zones and routes into any squad.
  const isMemberOf = (roomCode) => Boolean(activeSquads[roomCode]?.members.includes(socket.id));

  // --- GEOFENCE ALARM RELAY ---
  socket.on('geofence-alert', (data) => {
    if (!isMemberOf(data?.roomCode)) return;
    console.log(`[🚨 BREACH] ${data.userName} ${data.type === 'ENTER' ? 'entered' : 'left'} ${data.zoneName}`);
    // Broadcast the alarm to everyone else in the squad
    socket.to(data.roomCode).emit('geofence-alert', data);
  });

  // --- TACTICAL ZONE RELAY ---
    socket.on('publish-zone', (data) => {
      if (!isMemberOf(data?.roomCode)) return;
      console.log(`[SYS] Relaying new Tactical Zone to squad: ${data.roomCode}`);

      // Broadcasts the zone to everyone in the room EXCEPT the person who drew it
      socket.to(data.roomCode).emit('new-zone', data.zone);
    });

  // --- BACKEND ---
socket.on('check-ping', (clientTimestamp) => {
  // Immediately bounce the exact same timestamp back to the client
  socket.emit('pong-bounce', clientTimestamp);
  // And count it as activity for the stale-squad sweep: every joined client sends this
  // every 2 seconds, with or without a GPS fix (see the sweep at the top of this file).
  const now = Date.now();
  for (const room of socket.rooms) {
    const squad = activeSquads[room];
    if (squad?.members.includes(socket.id)) squad.lastActivity = now;
  }
});
  // --- ⚖️ THE MUTINY PROTOCOL ---
  socket.on('vote-to-kick', (payload) => {
    const { targetId, roomCode } = payload ?? {};
    const squad = activeSquads[roomCode];
    const sharingUid = uidOfPresenceKey(targetId);
    const targetIsSharing = Boolean(sharingUid) && Boolean(presenceOf(squad, sharingUid, Date.now()));
    if (!squad || !squad.members.includes(socket.id) || !(squad.members.includes(targetId) || targetIsSharing)) return;

    if (!squad.kickVotes) squad.kickVotes = {};
    if (!squad.kickVotes[targetId]) squad.kickVotes[targetId] = new Set();
    squad.kickVotes[targetId].add(socket.id);

    const requiredVotes = Math.max(2, Math.ceil(squad.members.length / 2)); 
    const currentVotes = squad.kickVotes[targetId].size;

    io.to(roomCode).emit('mutiny-status', { targetId, votes: currentVotes, required: requiredVotes });

    if (currentVotes >= requiredVotes) {
      const exiledUid = sharingUid || uidOfSocket(squad, targetId);
      recordActivity(roomCode, { kind: ACTIVITY.KICKED, uid: exiledUid, name: nameOf(squad, targetId), byName: 'Group vote' });
      dropModerator(squad, exiledUid);
      forgetSharingMode(squad, exiledUid);
      io.to(targetId).emit('exiled');
      delete squad.kickVotes[targetId];
      if (targetIsSharing) {
        // No socket to detach: off the roster and out of the map, and they must be admitted again.
        forgetMember(squad, sharingUid);
        removePresence(squad, sharingUid);
        endSession(squad, sharingUid);
      }
      if (users[targetId]) {
        delete users[targetId];
        delete locationCache[targetId];
      }
      // Off the roster isn't enough: take the socket out of the room too, so it stops
      // receiving the squad's traffic whether or not the removed client cooperates.
      // (The 'exiled' notice above goes to the socket's own room, so it still arrives.)
      io.sockets.sockets.get(targetId)?.leave(roomCode);
      handleSquadSuccession(targetId);
      broadcastSquadUpdate(roomCode);
      broadcastGroupRoles(roomCode);
    }
  });

  // --- SAFETY PING ENGINE (LKL) ---
  socket.on('safety-ping', (data) => {
    const { latitude, longitude, timestamp, batteryLevel } = data ?? {};
    // Hidden (the last update-location said GHOST): an older app still sends its position here.
    if (users[socket.id]?.status === 'GHOST') return;
    // Merge rather than overwrite: 'update-location' writes speed/heading/lastSeen
    // into this same cache entry, and clobbering it here would erase that trajectory data.
    locationCache[socket.id] = { ...locationCache[socket.id], latitude, longitude, timestamp, batteryLevel: batteryLevel || 'Unknown' };
  });

  // The Commander's telemetry matrix (SYNC_TELEMETRY). It used to answer only when the
  // squad existed and the asker was its Commander, and to say nothing at all otherwise, so
  // on the phone the button simply did nothing. A client that passes an acknowledgement
  // now always gets one: { ok: true }, or { ok: false, reason } with 'not-in-squad' (the
  // server has no record of this socket in that squad: a restart, a sweep, a reconnect
  // not yet re-joined) or 'not-owner'. The data itself still comes as
  // 'telemetry-sync-complete', which is all that installed builds listen for.
  socket.on('request-telemetry', (roomCode, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const squad = activeSquads[roomCode];
    if (!squad || !squad.members.includes(socket.id)) return reply({ ok: false, reason: 'not-in-squad' });
    if (squad.ownerId !== socket.id) return reply({ ok: false, reason: 'not-owner' });

    const squadTelemetry = {};
    const winners = presenceWins(squad, Date.now());
    squad.members.forEach(memberId => {
      if (winners.has(squad.memberUids?.[memberId])) return; // their background position is fresher
      const record = toTelemetryRecord(locationCache[memberId]);
      if (record) squadTelemetry[memberId] = record;
    });
    const connected = liveUids(squad, (id) => io.sockets.sockets.has(id));
    const fixless = fixlessPresenceUids(squad, roomCode, Date.now());
    for (const entry of livePresence(squad, Date.now())) {
      if (connected.has(entry.uid) && !winners.has(entry.uid) && !fixless.has(entry.uid)) continue;
      const record = toTelemetryRecord({ lat: entry.lat, lng: entry.lng, lastSeen: entry.lastSeen, battery: entry.battery });
      if (record) squadTelemetry[presenceKey(entry.uid)] = record;
    }
    socket.emit('telemetry-sync-complete', squadTelemetry);
    reply({ ok: true });
  });

  // --- GATEKEEPER ENTRY PROTOCOL ---
  socket.on('request-join', (data) => {
    const { roomCode, user, intent } = data ?? {};
    // The code becomes an object key, so anything else was coerced into one: no code at
    // all created a squad called "undefined" with the sender as its Commander, and
    // whoever typed that code for real was queued behind them.
    if (typeof roomCode !== 'string' || !roomCode) {
      console.warn(`[GATE] Dropped join from ${socket.id}: invalid room code`);
      return;
    }
    const existing = activeSquads[roomCode];
    // Ownership used to be tracked purely by ephemeral socket.id. Any reconnect
    // (backgrounding the app, a signal blip — routine on mobile) killed the old
    // socket and handed a squad member's disconnect handler a chance to silently
    // promote someone else to owner (see handleSquadSuccession below), so the real
    // creator would come back to their OWN squad and get dropped into the pending
    // "awaiting clearance" queue behind a "commander" who never asked to be one.
    // A stable per-person uid (Firebase uid, survives reconnects/new socket ids)
    // lets the server recognize "this is genuinely the same person who owns this
    // squad" and let them straight back in, no race, no vote required.
    const requesterUid = user?.uid || null;
    socket.data.uid = requesterUid;
    // Remember who this socket is independently of their telemetry. broadcastSquadUpdate
    // needs a name and photo for members who haven't got a GPS fix yet (indoors, location
    // permission denied, just joined) — they're on the roster, so they must be nameable
    // there, rather than being invisible until their first coordinate arrives.
    socket.data.profile = { name: user?.name || null, photo: user?.photo || null };

    // Whatever this socket, or this person on an earlier connection, was still waiting on
    // is superseded by this request, wherever it was (a request that ends up pending below
    // is recorded afresh). Clients that don't send 'cancel-join' on ABORT HANDSHAKE rely on
    // this: without it, a joiner who gave up on one squad and moved to another could still
    // be approved into the first, and end up in both.
    withdrawJoinRequests(requesterUid);

    // A JOIN for a code no live squad has, or a CREATE for a code a live squad already
    // has, is refused here rather than turned into the other (see refuseJoin).
    const refusal = refuseJoin(existing, {
      intent,
      uid: requesterUid,
      isSocketLive: (id) => io.sockets.sockets.has(id),
      holdsPresence: Boolean(existing) && hasPresence(existing, Date.now()),
    });
    if (refusal) {
      socket.emit(refusal, { roomCode });
      return;
    }

    // Case 1: brand-new or fully abandoned room -> requester becomes the owner. A squad whose
    // members are all sharing from the background is not abandoned: starting afresh here would
    // wipe its roster out from under them.
    if (!existing || (existing.members.length === 0 && !hasPresence(existing, Date.now()))) {
      activeSquads[roomCode] = {
        ownerId: socket.id,
        ownerUid: requesterUid,
        // The squad's own Commander, as opposed to whoever holds command right now
        // (ownerId/ownerUid), which is a stand-in while the Commander is away. Only a
        // deliberate exit hands it on (see handleSquadSuccession).
        commanderUid: requesterUid,
        members: [socket.id],
        memberUids: requesterUid ? { [socket.id]: requesterUid } : {},
        knownUids: requesterUid ? [requesterUid] : [],
        blockedUids: existing?.blockedUids || [],
        activeWaypoint: null,
        lastActivity: Date.now()
      };
      // The same person setting this Group up again gets their switches back.
      const saved = settingsStore.restore(roomCode, requesterUid);
      if (saved) activeSquads[roomCode].settings = saved;
      socket.join(roomCode);
      socket.emit('access-granted', { role: 'OWNER', roomCode });
      sendRallyPoint(socket, activeSquads[roomCode]);
      sendGroupSettings(socket, activeSquads[roomCode], roomCode);
      sendGroupRole(socket, activeSquads[roomCode], roomCode);
      return;
    }

    // Case 2: this identity was explicitly blocked by the commander -> hard deny.
    if (requesterUid && existing.blockedUids?.includes(requesterUid)) {
      socket.emit('access-denied', { roomCode });
      return;
    }

    // Case 3: the reconnecting socket IS the squad's Commander (uid match) -> always
    // let them straight back in as OWNER. Rebind their new socket id and keep
    // everyone else already in the roster instead of wiping it.
    //
    // However long they were away, and whoever stood in meanwhile. This used to match
    // ownerUid, which a caretaker (Case 4) overwrote with their own uid, so a Commander
    // who came back after anyone had stood in was let in as a plain member of their own
    // squad, for good.
    if (requesterUid && commanderOf(existing) === requesterUid) {
      // Whoever holds command now, if it isn't this person on an earlier connection.
      const standInId = existing.ownerUid !== requesterUid ? existing.ownerId : null;
      // Their own superseded connection(s). This used to only drop the old id from
      // `members` and leave everything else behind: the stale socket stayed subscribed to
      // the room, and its `users`/`locationCache` entries survived — so every other client
      // saw the Commander twice (once stale, once live), the Commander saw a phantom of
      // themselves listed as a squad member, and when the dead socket finally timed out it
      // raised a 'member-signal-lost' for someone sitting right there, leaving a ghost
      // marker nobody could ever clear. Same teardown the member path (Case 4b) already did.
      const staleIds = collectStaleSocketIds(existing, requesterUid, socket.id);
      existing.members = existing.members.filter(id => !staleIds.includes(id) && io.sockets.sockets.has(id));
      if (!existing.members.includes(socket.id)) existing.members.push(socket.id);
      existing.ownerId = socket.id;
      existing.ownerUid = requesterUid;
      existing.memberUids = existing.memberUids || {};
      staleIds.forEach(id => delete existing.memberUids[id]);
      existing.memberUids[socket.id] = requesterUid;
      rememberMember(existing, requesterUid);
      removePresence(existing, requesterUid);
      existing.lastActivity = Date.now();
      socket.join(roomCode);
      purgeStaleSockets(roomCode, staleIds);
      socket.emit('access-granted', { role: 'OWNER', roomCode });
      // The stand-in goes back to being a member, and is told so. They used to hear
      // nothing: their screen kept its Commander controls and join queue, and every
      // decision they took on it was refused.
      if (standInId) io.to(standInId).emit('demoted-to-member', { roomCode });
      sendJoinQueue(existing, roomCode, socket.id);
      sendRallyPoint(socket, existing);
      sendGroupSettings(socket, existing, roomCode);
      broadcastSquadUpdate(roomCode);
      broadcastGroupRoles(roomCode);
      return;
    }

    // Case 4: a member the Commander already let in, back on a new socket while the
    // Commander's socket is gone -> they take over as caretaker rather than the squad
    // being stranded, keeping the roster intact, until the Commander returns (Case 3).
    //
    // Members only. This used to be anyone at all: a stranger's first request with the
    // code, arriving while the Commander's phone had dropped off, made them Commander
    // with no approval. A stranger's request now waits (Case 5).
    const ownerIsLive = io.sockets.sockets.has(existing.ownerId);
    if (!ownerIsLive && isKnownMember(existing, requesterUid)) {
      // The caretaker may themselves be arriving on a new socket, so tear their old one
      // down here too — same reason as Case 3 above.
      const staleIds = collectStaleSocketIds(existing, requesterUid, socket.id);
      existing.ownerId = socket.id;
      existing.ownerUid = requesterUid;
      existing.members = existing.members.filter(id => !staleIds.includes(id));
      if (!existing.members.includes(socket.id)) existing.members.push(socket.id);
      existing.memberUids = existing.memberUids || {};
      staleIds.forEach(id => delete existing.memberUids[id]);
      existing.memberUids[socket.id] = requesterUid;
      rememberMember(existing, requesterUid);
      removePresence(existing, requesterUid);
      existing.lastActivity = Date.now();
      socket.join(roomCode);
      purgeStaleSockets(roomCode, staleIds);
      socket.emit('access-granted', { role: 'OWNER', roomCode });
      sendJoinQueue(existing, roomCode, socket.id);
      sendRallyPoint(socket, existing);
      sendGroupSettings(socket, existing, roomCode);
      broadcastSquadUpdate(roomCode);
      broadcastGroupRoles(roomCode);
      return;
    }

    // Case 4b: a member the Commander already approved, back on a new socket (signal
    // blip, backgrounded app, relaunch). Approval was never revoked — they didn't
    // leave, and weren't kicked or blocked — so don't make the Commander re-approve
    // them on every reconnect, and don't drop them into the waiting room in the
    // meantime (which also cut them off from live alerts, SOS included). Recognised by
    // uid, not socket id: see squadRoster.js. Sits after Cases 3/4 so an owner (or a
    // squad whose owner has vanished) is still handled the way it always was.
    const returning = rebindReturningMember(existing, { uid: requesterUid, socketId: socket.id });
    if (returning) {
      removePresence(existing, requesterUid);
      // The same person's previous connection(s): superseded. Detached from the room and
      // stripped of per-socket state so they can't show as a duplicate marker, or later
      // raise a false "signal lost" for someone who is in fact back.
      purgeStaleSockets(roomCode, returning.staleIds);
      existing.lastActivity = Date.now();
      socket.join(roomCode);
      socket.emit('access-granted', { role: returning.role, roomCode });
      // A moderator is handed the queue on every return, as the admin is.
      if (can(roleOfSocket(existing, socket.id), 'seeJoinQueue')) sendJoinQueue(existing, roomCode, socket.id);
      sendRallyPoint(socket, existing);
      sendGroupSettings(socket, existing, roomCode);
      broadcastSquadUpdate(roomCode);
      broadcastGroupRoles(roomCode);
      return;
    }

    // Case 5: normal gatekeeper flow — a genuine new joiner needs the owner's approval.
    // Recorded, so that only a request still open can be approved (see resolve-access).
    addPendingRequest(existing, socket.id, { uid: requesterUid, name: user?.name ?? null, photo: user?.photo ?? null });
    // Every reply names its squad, so a client can ignore one about a squad it has left.
    socket.emit('access-pending', { roomCode });
    joinNotifier.requested(roomCode);
    const request = { targetId: socket.id, name: user?.name, photo: user?.photo, roomCode: roomCode };
    // Moderators admit too, so each connected one sees the request as the admin does.
    for (const id of socketsAllowed(existing, 'seeJoinQueue')) {
      if (id !== existing.ownerId) io.to(id).emit('access-request', request);
    }
    if (ownerIsLive) {
      io.to(existing.ownerId).emit('access-request', request);
    } else {
      // Nobody holds command. A connected member stands in and is handed the queue; with
      // none connected, the request waits on file for whoever takes command next (the
      // Commander back, or a member back as caretaker), and each of those sends the queue.
      promoteStandIn(existing, roomCode);
    }
  });

  // ABORT HANDSHAKE: the joiner stops waiting. Withdrawn server-side, and the Commander
  // told, so a GRANT tapped later on a stale screen can't pull them in after all.
  socket.on('cancel-join', () => {
    withdrawJoinRequests(null);
  });

  socket.on('resolve-access', (payload) => {
    const { targetId, roomCode, approved } = payload ?? {};
    const squad = activeSquads[roomCode];
    // The main admin or a moderator, one request at a time (groupRoles.js: admitOne).
    if (!squad || !can(roleOfSocket(squad, socket.id), 'admitOne')) return;

    // Only a request that is still open. This used to accept any socket id at all: a
    // joiner who had aborted, or had since created or joined another squad, was pulled in
    // anyway (ending up in two squads), or bounced out of the one they'd moved to by a
    // stale denial. The Commander is told the request is gone, so it leaves their queue.
    const request = takePendingRequest(squad, targetId);
    if (!request) {
      socket.emit('access-request-withdrawn', { targetId, roomCode });
      return;
    }
    // Everyone else who could have answered it: it is decided, so it leaves their queue too.
    for (const id of socketsAllowed(squad, 'seeJoinQueue')) {
      if (id !== socket.id) io.to(id).emit('access-request-withdrawn', { targetId, roomCode });
    }
    admitOrDeny(squad, roomCode, targetId, approved);
  });

  // Admit all: the main admin only (groupRoles.js). Every request still open is admitted whose
  // joiner is still connected. Acknowledged with { ok, admitted } or { ok: false, reason }.
  socket.on('admit-all', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const { roomCode } = payload ?? {};
    const squad = activeSquads[roomCode];
    if (!squad || !squad.members.includes(socket.id)) return reply({ ok: false, reason: 'not-in-squad' });
    if (!can(roleOfSocket(squad, socket.id), 'admitAll')) return reply({ ok: false, reason: 'not-allowed' });
    let admitted = 0;
    for (const targetId of Object.keys(squad.pending ?? {})) {
      if (!takePendingRequest(squad, targetId)) continue;
      for (const id of socketsAllowed(squad, 'seeJoinQueue')) io.to(id).emit('access-request-withdrawn', { targetId, roomCode });
      if (admitOrDeny(squad, roomCode, targetId, true)) admitted += 1;
    }
    reply({ ok: true, admitted });
  });

  // Lets in (or turns away) one joiner whose request has already been taken off the queue.
  // Returns whether they were admitted.
  function admitOrDeny(squad, roomCode, targetId, approved) {
    if (approved) {
      const targetSocket = io.sockets.sockets.get(targetId);
      // Only add to the roster if the requester is still actually connected —
      // pushing targetId unconditionally left a phantom member in squad.members
      // (never cleaned up until the next 60s stale sweep) whenever someone
      // disconnected while their join request was awaiting approval.
      if (targetSocket) {
        squad.members.push(targetId);
        targetSocket.join(roomCode);
        targetSocket.emit('access-granted', { role: 'MEMBER', roomCode });
        squad.memberUids = squad.memberUids || {};
        squad.memberUids[targetId] = targetSocket.data?.uid || null;
        // Approved once; remembered by uid so a reconnect isn't a fresh request.
        rememberMember(squad, targetSocket.data?.uid);
        sendRallyPoint(targetSocket, squad);
        sendGroupSettings(targetSocket, squad, roomCode);
        // Put them on everyone's roster now. Previously the squad only learned of a new
        // member when that member's first telemetry arrived, so a mid-session joiner was
        // missing from the list for a polling interval (up to 15s in eco mode) — and
        // indefinitely if they never got a fix at all.
        broadcastSquadUpdate(roomCode);
        sendGroupRole(targetSocket, squad, roomCode);
        return true;
      }
      return false;
    }
    io.to(targetId).emit('access-denied', { roomCode });
    return false;
  }

  // --- 🚫 REMOVE / BLOCK (the main admin and moderators, groupRoles.js) ---
  // Kick takes someone out (they must ask again to come back); block also keeps them out
  // (squad.blockedUids, checked in request-join) until the main admin or a moderator unblocks
  // them. Neither touches the main admin or the Group's own Commander, and a moderator never
  // touches another moderator. Both answer an acknowledgement, if one is passed, with { ok } or
  // { ok: false, reason }.
  const removeMember = (payload, ack, { block }) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const { roomCode, targetId } = payload ?? {};
    const squad = activeSquads[roomCode];
    if (!squad || !squad.members.includes(socket.id)) return reply({ ok: false, reason: 'not-in-squad' });
    const role = roleOfSocket(squad, socket.id);
    if (!can(role, block ? 'block' : 'kick')) return reply({ ok: false, reason: 'not-allowed' });
    if (typeof targetId !== 'string' || targetId === socket.id) return reply({ ok: false, reason: 'bad-target' });

    const sharingUid = uidOfPresenceKey(targetId);
    // On the roster: a connection, or (by a 'bg:' key) an admitted person sharing from the
    // background, whether or not their latest report is still fresh.
    const onRoster = squad.members.includes(targetId) || Boolean(sharingUid && isKnownMember(squad, sharingUid));
    if (!onRoster) return reply({ ok: false, reason: 'bad-target' });
    const targetUid = squad.memberUids?.[targetId] || io.sockets.sockets.get(targetId)?.data?.uid || sharingUid;
    // A stand-in holds command only until the Commander returns. Blocking the Commander
    // (whose old connection is still on the roster while they're away) would turn
    // "temporarily" into "for good": a block is checked before the Commander's return.
    const target = {
      isAdmin: squad.ownerId === targetId,
      isCommander: Boolean(targetUid) && targetUid === commanderOf(squad),
      isModerator: Boolean(targetUid) && Boolean(squad.moderatorUids?.includes(targetUid)),
    };
    if (!canActOn(role, target)) return reply({ ok: false, reason: 'not-allowed' });

    const targetName = nameOf(squad, targetId) ?? presenceOf(squad, targetUid, Date.now())?.name ?? null;
    if (block) rememberBlocked(squad, targetUid, targetName);
    forgetMember(squad, targetUid);
    removePresence(squad, targetUid);
    endSession(squad, targetUid);
    dropModerator(squad, targetUid);
    forgetSharingMode(squad, targetUid);

    squad.members = squad.members.filter(id => id !== targetId);
    if (squad.memberUids) delete squad.memberUids[targetId];
    delete users[targetId];
    delete locationCache[targetId];

    console.log(`[🚫 ${block ? 'BLOCK' : 'KICK'}] ${role} removed node ${targetId} from ${roomCode}`);
    recordActivity(roomCode, {
      kind: block ? ACTIVITY.BLOCKED : ACTIVITY.KICKED, uid: targetUid, name: targetName,
      byUid: socket.data?.uid, byName: socket.data?.profile?.name,
    });
    io.to(targetId).emit('exiled', { reason: block ? 'blocked' : 'kicked' });
    // Same as a mutiny exile: off the roster AND out of the room, without relying on the
    // removed client to leave when told. Otherwise a modified client stays subscribed to
    // the squad it was removed from, and keeps receiving its locations and SOS alerts.
    io.sockets.sockets.get(targetId)?.leave(roomCode);
    broadcastSquadUpdate(roomCode);
    broadcastGroupRoles(roomCode);
    reply({ ok: true });
  };
  socket.on('block-user', (payload, ack) => removeMember(payload, ack, { block: true }));
  socket.on('kick-member', (payload, ack) => removeMember(payload, ack, { block: false }));

  // Who is blocked from this Group ([{ uid, name }]), for the main admin and moderators.
  socket.on('get-blocked', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const squad = activeSquads[payload?.roomCode];
    if (!squad || !can(roleOfSocket(squad, socket.id), 'unblock')) return reply({ ok: false, reason: 'not-allowed' });
    reply({ ok: true, blocked: blockedList(squad) });
  });

  socket.on('unblock-user', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const { roomCode, uid } = payload ?? {};
    const squad = activeSquads[roomCode];
    if (!squad || !can(roleOfSocket(squad, socket.id), 'unblock')) return reply({ ok: false, reason: 'not-allowed' });
    if (typeof uid !== 'string') return reply({ ok: false, reason: 'bad-target' });
    const name = squad.blockedNames?.[uid] ?? null;
    if (!forgetBlocked(squad, uid)) return reply({ ok: false, reason: 'not-blocked' });
    recordActivity(roomCode, { kind: ACTIVITY.UNBLOCKED, uid, name, byUid: socket.data?.uid, byName: socket.data?.profile?.name });
    reply({ ok: true, blocked: blockedList(squad) });
  });

  // The Group's own Commander makes a member a moderator, or a moderator a member again.
  socket.on('set-moderator', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const { roomCode, targetId, moderator } = payload ?? {};
    const squad = activeSquads[roomCode];
    if (!squad || !squad.members.includes(socket.id)) return reply({ ok: false, reason: 'not-in-squad' });
    if (!can(roleOfSocket(squad, socket.id), 'setModerator') || !canSetModerators(squad, socket.id, socket.data?.uid, commanderOf(squad))) {
      return reply({ ok: false, reason: 'not-allowed' });
    }
    const targetUid = uidOfSocket(squad, targetId);
    if (typeof moderator !== 'boolean' || targetId === socket.id || !squad.members.includes(targetId) || !targetUid) {
      return reply({ ok: false, reason: 'bad-target' });
    }
    if (setModerator(squad, targetUid, moderator)) {
      broadcastSquadUpdate(roomCode);
      broadcastGroupRoles(roomCode);
      // A new moderator admits from now on: hand them the queue.
      if (moderator) sendJoinQueue(squad, roomCode, targetId);
    }
    reply({ ok: true });
  });

  // The activity log (activityLog.js), for the main admin and moderators.
  socket.on('get-activity-log', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const squad = activeSquads[payload?.roomCode];
    if (!squad || !can(roleOfSocket(squad, socket.id), 'readActivityLog')) return reply({ ok: false, reason: 'not-allowed' });
    reply({ ok: true, log: activityOf(squad) });
  });

  socket.on('publish-custom-route', (payload) => {
    // Scoped to the sender's own squad — this used to be socket.broadcast.emit,
    // which leaked every squad's secret tactical routes to every other squad
    // connected to the server, regardless of room membership. And only from a member
    // of it: the room is the client's claim, so it's checked against the roster.
    if (isMemberOf(payload?.roomCode)) socket.to(payload.roomCode).emit('new-custom-route', payload);
  });

  // --- 🎯 RALLY POINT WAYPOINTS ---
  // Any accepted squad member can drop one — the mobile Rally Point FAB (App.jsx's
  // "TARGETING MODE" two-step tap) is shown to every member, not just the Commander,
  // so gating this to ownerId only silently dropped every non-owner's rally point:
  // the presser's own client had already optimistically shown it to themselves
  // (setActiveWaypoint runs before the emit), so only they ever saw it — nobody else
  // in the squad did, without so much as a console warning that anything failed.
  //
  // Who dropped it is recorded (`setBy`: their uid, or socket id without one) and sent
  // with it, so the client knows whether to offer its own user the clear control. Taken
  // from the server's own record of the socket, never from the payload, and only
  // position and name are copied from the client's waypoint.
  socket.on('publish-waypoint', (data) => {
    const { roomCode, waypoint } = data ?? {};
    if (waypoint && activeSquads[roomCode] && activeSquads[roomCode].members.includes(socket.id)) {
      console.log(`[🎯 TACTICAL] New Rally Point designated in ${roomCode} at ${waypoint.lat}, ${waypoint.lng}`);
      const rallyPoint = {
        lat: waypoint.lat,
        lng: waypoint.lng,
        name: waypoint.name,
        setBy: memberKey(socket.data?.uid, socket.id),
      };
      activeSquads[roomCode].activeWaypoint = rallyPoint;
      socket.to(roomCode).emit('new-waypoint', rallyPoint);
      // Also emit back to the sender just in case they need to update state without trusting the client UI
      socket.emit('new-waypoint', rallyPoint);
    }
  });

  // The Commander can clear any Rally Point, and a member the one they dropped. This used
  // to be Commander-only while any member could drop one, so an operative's own Rally
  // Point (FAB, or a building chosen as a destination) stayed on everyone's map with no
  // way for them to take it back: their clear was refused without a word.
  socket.on('clear-waypoint', (roomCode) => {
    const squad = activeSquads[roomCode];
    if (!squad || !squad.members.includes(socket.id)) return;
    const isCommander = squad.ownerId === socket.id;
    const droppedIt = Boolean(squad.activeWaypoint) && squad.activeWaypoint.setBy === memberKey(socket.data?.uid, socket.id);
    if (!isCommander && !droppedIt) return;
    console.log(`[🚫 TACTICAL] Rally Point cleared in ${roomCode}`);
    squad.activeWaypoint = null;
    io.to(roomCode).emit('remove-waypoint');
  });

  // --- 🌐 LOCATION & ROOM ENGINE (CENTRALIZED) ---
  socket.on('update-location', (data) => {
    if (!data) return;
    const { lat, lng, speed, battery, heading } = data;
    const newRoom = data.roomCode || 'GLOBAL';

    // 🔒 GATEKEEPER ENFORCEMENT: this used to join any roomCode the client sent,
    // regardless of whether the socket ever passed request-join/resolve-access.
    // That let a client "tailgate" straight into another squad's live feed —
    // skipping approval entirely. Only accept telemetry from sockets already
    // recorded as members of that squad.
    const squad = activeSquads[newRoom];
    if (!squad || !squad.members.includes(socket.id)) {
      return;
    }
    squad.lastActivity = Date.now();
    const reporter = squad.memberUids?.[socket.id];
    if (reporter) {
      squad.profiles ??= Object.create(null);
      squad.profiles[reporter] = { name: data.name ?? null, photo: data.photo ?? null };
      // Going hidden, or coming back from it, goes in the activity log.
      const changed = noteSharingMode(squad, { uid: reporter, name: data.name ?? null, status: data.status });
      if (changed) recordActivity(newRoom, changed);
    }
    // Hidden: no position is kept, whatever an older app still sends.
    const hidden = data.status === 'GHOST';

    const oldRoom = users[socket.id]?.roomCode;

    if (oldRoom && oldRoom !== newRoom) socket.leave(oldRoom);
    socket.join(newRoom);

    // 👇 Armored Cache Assignment
    users[socket.id] = {
      ...data,
      ...(hidden ? { lat: undefined, lng: undefined, building: undefined, floor: undefined } : {}),
      roomCode: newRoom,
      heading: heading || 0,       // Failsafe: Prevents NaN crashes on the frontend
      lastSeen: Date.now()         // Anchor: Records the exact millisecond of the last known ping
    };

    // Mirror the live trajectory into locationCache too (merged with whatever
    // safety-ping last wrote), so the disconnect handler's Dead Man's Switch
    // actually has real speed/heading/lastSeen instead of permanently-undefined fields.
    // Hidden: the position it had is dropped, so neither the Lead's table nor a lost-signal
    // marker can show where a hidden person is.
    locationCache[socket.id] = hidden
      ? { battery: battery || 0, lastSeen: Date.now() }
      : {
          ...locationCache[socket.id],
          lat, lng,
          speed: speed || 0,
          heading: heading || 0,
          battery: battery || 0,
          lastSeen: Date.now()
        };

    broadcastSquadUpdate(newRoom);
  });

  // Single-target member ping: a sonar blip and a short notice on one squadmate's
  // screen. Not an emergency — that is 'sos-broadcast' below. Relayed only between
  // members of the same squad; see sharedSquad in sosRelay.js for what it used to allow.
  // Reads its payload through `?? {}` because a bare emit (no payload) used to throw
  // here and take the whole server down — and so did a null one, after the fix for that
  // was a `= {}` default, which null skips.
  socket.on('ping-user', (payload) => {
    const { targetId, senderName } = payload ?? {};
    const roomCode = sharedSquad(activeSquads, socket.id, targetId);
    if (!roomCode) {
      console.warn(`[PING] Dropped: ${socket.id} is not in a squad with ${targetId}`);
      return;
    }
    // The only way a ping is relayed: asked of alertRules.js first (see decideAlert).
    const squad = activeSquads[roomCode];
    const now = Date.now();
    const verdict = decideAlert({ type: 'ping', squad, senderId: socket.id, targetId, now });
    let delivered = false;
    if (verdict.allowed) {
      const senderKey = keyOf(squad, socket.id);
      const targetKey = keyOf(squad, targetId);
      recordPing(squad, senderKey, targetKey, now, PING_WINDOW_MIN * 60 * 1000);
      // Pings the target has muted still count against the sender, and the sender is not
      // told: a muted person gets silence, not a way to find out they were muted.
      if (!isPersonallyMuted(squad, targetKey, senderKey)) {
        io.to(targetId).emit('receive-ping', { senderName });
        delivered = true;
      }
    } else {
      console.log(`[PING] Refused in ${roomCode}: ${verdict.reasonCode}`);
    }
    reportAlert(socket, squad, roomCode, 'ping', verdict, now, { targetId, delivered });
  });

  // Squad-wide distress beacon (the "SOS" promised in onboarding) — broadcasts
  // to every other member of the sender's own squad. The room is resolved from the
  // squad roster (see sosRelay.js), not from `users`, which only exists once the
  // sender has a GPS fix — a member with no fix used to have their SOS dropped here
  // with no sign of it on their end. The client's claimed roomCode is only honoured
  // if the roster confirms they're in it, same gatekeeper reasoning as the
  // telemetry handler above.
  //
  // Emits its own 'sos-received' event rather than reusing 'receive-ping' — that
  // event belongs to the separate single-target 'ping-user' feature (Commander
  // pinging one specific member), and reusing it here meant a squad-wide SOS was
  // indistinguishable from a single ping on the client, plus lat/lng/timestamp
  // from the sender's payload were being silently discarded (only senderName was
  // ever destructured), so nothing downstream could show the sender's location.
  socket.on('sos-broadcast', (payload) => {
    const { senderName, lat, lng, roomCode: claimedRoomCode, timestamp } = payload ?? {};
    const roomCode = resolveSosRoom(activeSquads, users, socket.id, claimedRoomCode);
    if (!roomCode) {
      console.warn(`[🚨 SOS] Dropped: ${socket.id} (${senderName}) is not a member of any squad`);
      return;
    }
    // One clock reading for both, so a live broadcast is reliably age 0 rather than
    // occasionally 1ms if the second Date.now() ticks over.
    const now = Date.now();
    const squad = activeSquads[roomCode];
    // The only way an SOS is relayed: asked of alertRules.js first (see decideAlert). An
    // SOS is only ever refused by the Group Lead's switch, or by the quiet-zone setting
    // when that is 'blocked'; otherwise at worst it goes out flagged.
    const verdict = decideAlert({ type: 'sos', squad, senderId: socket.id, now });
    const senderKey = memberKey(socket.data?.uid, socket.id);
    // Someone pressing it again and again: tell the Group Lead, quietly (not an alarm). Every
    // press counts, including the ones the cooldown refuses; not while SOS is switched off.
    if (verdict.reasonCode !== 'GROUP_DISABLED') {
      const repeats = noteSosAttempt(squad, senderKey, now, SOS_REPEAT_WINDOW_MIN * 60 * 1000, SOS_REPEAT_FLAG_COUNT);
      if (repeats.flag && squad.ownerId && squad.ownerId !== socket.id) {
        io.to(squad.ownerId).emit('group-notice', {
          roomCode, kind: 'sos-repeat', senderId: socket.id, senderName: senderName ?? null,
          count: repeats.count, windowMin: SOS_REPEAT_WINDOW_MIN,
        });
      }
    }
    if (!verdict.allowed) {
      console.log(`[🚨 SOS] Refused in ${roomCode}: ${verdict.reasonCode}`);
      reportAlert(socket, squad, roomCode, 'sos', verdict, now);
      return;
    }
    console.log(`[🚨 SOS] ${senderName} triggered a distress beacon in ${roomCode}`);
    const details = {
      senderKey, senderId: socket.id, senderName, lat, lng, timestamp,
      flag: verdict.mode === 'guarded' ? verdict.reasonCode : null,
    };
    // Pressing again while the last one is fresh updates it: no second alarm.
    const coalesced = coalesceSos(squad, details, now, SOS_COALESCE_SEC * 1000);
    const sos = coalesced ?? recordSos(squad, details, now);
    // The per-person cooldown (alertRules.js) counts from each new alarm.
    if (!coalesced) {
      squad.sosSentAt ??= Object.create(null);
      squad.sosSentAt[senderKey] = now;
    }
    socket.to(roomCode).emit(coalesced ? 'sos-updated' : 'sos-received', toSosPayload(sos, now));
    sosWatch.notify(roomCode); // and the phones listening from the background
    reportAlert(socket, squad, roomCode, 'sos', verdict, now, coalesced ? { coalesced: true } : {});
  });

  // --- GROUP SWITCHES AND MUTES ---
  // The Group's own Commander turns SOS and Ping on and off for the Group, and mutes one
  // member's pings (never their SOS). Each is acknowledged with { ok } or
  // { ok: false, reason }: 'not-in-squad' or 'not-commander'. Every change goes to every
  // member at once as 'group-settings'.
  const settingsRequest = (payload, ack, { leadOnly }) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const { roomCode } = payload ?? {};
    const squad = activeSquads[roomCode];
    if (!squad || !squad.members.includes(socket.id)) { reply({ ok: false, reason: 'not-in-squad' }); return null; }
    if (leadOnly && !canChangeSettings(squad, socket.id, socket.data?.uid, commanderOf(squad))) {
      reply({ ok: false, reason: 'not-commander' });
      return null;
    }
    return { reply, roomCode, squad };
  };

  socket.on('set-group-settings', (payload, ack) => {
    const request = settingsRequest(payload, ack, { leadOnly: true });
    if (!request) return;
    if (updateSwitches(request.squad, payload)) {
      persistGroupSettings(request.roomCode);
      broadcastGroupSettings(request.roomCode);
    }
    request.reply({ ok: true });
  });

  socket.on('set-member-ping-mute', (payload, ack) => {
    const request = settingsRequest(payload, ack, { leadOnly: true });
    if (!request) return;
    const { squad, roomCode } = request;
    const { targetId, muted } = payload ?? {};
    if (targetId === socket.id || !squad.members.includes(targetId) || typeof muted !== 'boolean') {
      return request.reply({ ok: false, reason: 'bad-target' });
    }
    if (setPingerMuted(squad, keyOf(squad, targetId), muted)) {
      persistGroupSettings(roomCode);
      broadcastGroupSettings(roomCode);
    }
    request.reply({ ok: true });
  });

  // Any member, for themselves only: stop receiving pings from one person.
  socket.on('set-personal-ping-mute', (payload, ack) => {
    const request = settingsRequest(payload, ack, { leadOnly: false });
    if (!request) return;
    const { squad } = request;
    const { targetId, muted } = payload ?? {};
    if (targetId === socket.id || !squad.members.includes(targetId) || typeof muted !== 'boolean') {
      return request.reply({ ok: false, reason: 'bad-target' });
    }
    setPersonallyMuted(squad, keyOf(squad, socket.id), keyOf(squad, targetId), muted);
    request.reply({ ok: true });
  });

  // The Group's recent SOS and Ping decisions, for whoever holds command.
  socket.on('get-alert-log', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const { roomCode } = payload ?? {};
    const squad = activeSquads[roomCode];
    if (!squad || squad.ownerId !== socket.id) return reply({ ok: false, reason: 'not-owner' });
    const log = [...(squad.alertLog ?? [])];
    socket.emit('alert-log', { roomCode, log });
    reply({ ok: true });
  });

  // Catch-up for a member who wasn't (fully) in the room when an SOS fired — offline,
  // reconnecting, or approved afterwards. The client asks once it has (re)entered the
  // squad, rather than the server pushing right after 'access-granted': that push
  // could beat the client's own React re-render and arrive with nobody listening.
  // Only SOS this member hasn't acknowledged, and hasn't sent themselves, come back.
  socket.on('sos-sync', () => {
    const roomCode = resolveSosRoom(activeSquads, users, socket.id, null);
    if (!roomCode) return;
    const now = Date.now();
    const key = memberKey(socket.data?.uid, socket.id);
    for (const sos of pendingSosFor(activeSquads[roomCode], key, now)) {
      socket.emit('sos-received', toSosPayload(sos, now));
    }
  });

  // Acknowledgement is per member and stored by stable identity (uid), so it survives
  // a reconnect: without it every reconnect would re-raise an SOS the member had
  // already dealt with.
  socket.on('sos-ack', (payload) => {
    const { id } = payload ?? {};
    const roomCode = resolveSosRoom(activeSquads, users, socket.id, null);
    if (!roomCode) return;
    ackSos(activeSquads[roomCode], id, memberKey(socket.data?.uid, socket.id));
  });

  // Leaving means leaving: off every roster the socket is on, out of every room it is
  // subscribed to, and clear of its per-socket state.
  //
  // This used to be wrapped in `if (users[socket.id])`, but `users` only fills in once a
  // GPS fix arrives via update-location — so a member with no fix (permission denied,
  // indoors, just joined) pressing "leave" did nothing at all: still on the roster,
  // and, since a returning uid is now readmitted without approval, free to walk
  // straight back in. It also never called socket.leave(): the app keeps the socket
  // connected after leaving (and after logging out), so a former member stayed
  // subscribed to the squad's locations, SOS and Rally Points.
  //
  // Rooms are taken from the socket itself (socket.rooms), not just the roster, so
  // nothing it is still subscribed to can be missed even if the two have drifted apart.
  // (Mutiny exiles and blocks now detach the socket themselves; this is the backstop.)
  socket.on('leave-squad', () => {
    // Logging out from the waiting room is a leave too: nothing left to approve.
    withdrawJoinRequests(null);
    const rooms = new Set([...socket.rooms].filter(room => room !== socket.id));
    for (const roomCode in activeSquads) {
      if (activeSquads[roomCode].members.includes(socket.id)) rooms.add(roomCode);
    }

    // A deliberate Leave, in the log of each Group they were on (not a dropped connection).
    rooms.forEach((roomCode) => {
      const squad = activeSquads[roomCode];
      if (!squad?.members.includes(socket.id)) return;
      const uid = uidOfSocket(squad, socket.id);
      recordActivity(roomCode, { kind: ACTIVITY.LEFT, uid, name: nameOf(squad, socket.id) });
      dropModerator(squad, uid);
      forgetSharingMode(squad, uid);
    });

    delete users[socket.id];
    delete locationCache[socket.id];
    rooms.forEach(roomCode => socket.leave(roomCode));

    handleSquadSuccession(socket.id);
    rooms.forEach(roomCode => broadcastGroupRoles(roomCode));
    rooms.forEach(roomCode => broadcastSquadUpdate(roomCode));
  });

  socket.on('disconnect', () => {
    console.log(`🔴 Node Disconnected: ${socket.id}`);
    // A joiner who drops off while waiting has nothing left to approve. (Back on a new
    // socket, their client asks again, and that request is the one the Commander sees.)
    withdrawJoinRequests(null);

    // A connection lost, as opposed to a Leave: logged only when this was the person's
    // connection to the Group (not one already replaced by a reconnect) and no other is live.
    for (const roomCode in activeSquads) {
      const squad = activeSquads[roomCode];
      if (!squad.members.includes(socket.id)) continue;
      const uid = uidOfSocket(squad, socket.id);
      const otherLive = Boolean(uid) && squad.members.some(
        (id) => id !== socket.id && squad.memberUids?.[id] === uid && io.sockets.sockets.has(id)
      );
      if (!otherLive) recordActivity(roomCode, { kind: ACTIVITY.CONNECTION_LOST, uid, name: nameOf(squad, socket.id) });
    }

    if (users[socket.id]) {
      const room = users[socket.id].roomCode;
      const userData = users[socket.id];
      const lastLocation = locationCache[socket.id];
      const squad = activeSquads[room];
      // Still sharing from the background (presence.js)? Then the connection dropping is not
      // them going dark: their lease says when that is.
      const sharingUid = squad ? (squad.memberUids?.[socket.id] || socket.data?.uid) : null;
      const stillSharing = Boolean(sharingUid) && Boolean(presenceOf(squad, sharingUid, Date.now()));

      // TRIGGER DEAD MAN'S SWITCH 
      if (lastLocation && squad && !stillSharing) {
        
        // 1. Calculate the exact time in the dark (in seconds)
        const lastSeenTime = lastLocation.lastSeen || Date.now(); 
        const timeDeltaSeconds = (Date.now() - lastSeenTime) / 1000;

        // 2. Broadcast to the ENTIRE squad (or keep it ownerId if strictly classified)
        io.to(room).emit('member-signal-lost', {
          targetId: socket.id,
          // Stable identity alongside the (now dead) socket id: without it the client
          // can't tell that the node it just ghosted is the same person who reconnects
          // a second later under a fresh socket id.
          uid: squad.memberUids?.[socket.id] || socket.data?.uid || null,
          name: userData.name,
          photo: userData.photo,
          // 3. Package the trajectory data for the frontend's Pre-Cog engine
          lastKnownLocation: {
            latitude: lastLocation.lat || lastLocation.latitude, 
            longitude: lastLocation.lng || lastLocation.longitude,
            speed: lastLocation.speed || 0,
            heading: lastLocation.heading || 0,          // <-- The trajectory
            batteryLevel: lastLocation.battery || 0
          },
          timeDelta: timeDeltaSeconds,                   // <-- The exact lag time
          disconnectTime: new Date().toISOString()
        });
      }

      delete users[socket.id];
      delete locationCache[socket.id];
      if (room) broadcastSquadUpdate(room);
    }

    // NOTE: deliberately NOT calling handleSquadSuccession() here. A raw 'disconnect'
    // fires on any transient drop (app backgrounded, brief signal loss — routine on
    // mobile), not just genuine departures. Immediately handing ownership to another
    // member on every blip meant the real owner's own reconnect would find someone
    // else already crowned commander and get stuck begging them for "clearance" to
    // re-enter their own squad. Ownership now only changes hands on deliberate exits
    // (leave-squad, vote-to-kick/block) or, for a truly-gone owner, lazily the next
    // time someone actually tries to join the room (see request-join's Case 4) or via
    // the periodic stale-squad sweep.
    //
    // One exception: someone is already waiting on this Commander. Their request arrived
    // while this socket still looked live (a dead phone is only noticed at the heartbeat
    // timeout, up to ~45 s behind Render's proxy), so it was addressed here and nobody
    // was promoted. Without this, it waited for as long as the Commander stayed away.
    // A stand-in is temporary: the Commander still gets the squad back on return.
    for (const roomCode in activeSquads) {
      const squad = activeSquads[roomCode];
      if (squad.ownerId === socket.id && Object.keys(squad.pending ?? {}).length > 0) {
        promoteStandIn(squad, roomCode);
      }
    }
  });

  // Withdraw every open join request made from this socket, and with a uid, that person's
  // from earlier connections too. Each squad's Commander is told, so the request leaves
  // their queue instead of waiting there for a GRANT that would pull in someone who left.
  function withdrawJoinRequests(uid) {
    for (const { roomCode, targetId } of withdrawPendingRequests(activeSquads, { socketId: socket.id, uid })) {
      const squad = activeSquads[roomCode];
      const ownerId = squad?.ownerId;
      if (ownerId) io.to(ownerId).emit('access-request-withdrawn', { targetId, roomCode });
      for (const id of socketsAllowed(squad, 'seeJoinQueue')) {
        if (id !== ownerId) io.to(id).emit('access-request-withdrawn', { targetId, roomCode });
      }
    }
  }

  // Send a squad's open join requests to whoever is now its Commander: back on a new
  // socket (an app restart loses its own queue), a caretaker, or a member promoted when
  // the Commander left. Requests used to be addressed only to the Commander at the time,
  // so any change of hands left their joiners waiting on nobody.
  function sendJoinQueue(squad, roomCode, ownerId) {
    for (const request of pendingRequestsOf(squad, roomCode)) {
      io.to(ownerId).emit('access-request', request);
    }
  }

  // Tell a socket just let into a squad what its Rally Point is, including that there is
  // none. Only one that existed used to be sent, so a member who was offline when it was
  // cleared came back to it still on their map (as did a client carrying one over from a
  // previous squad), and no clear control was left anywhere that could remove it: the
  // Commander's only appear while their own map has a Rally Point.
  function sendRallyPoint(target, squad) {
    if (squad.activeWaypoint) target.emit('new-waypoint', squad.activeWaypoint);
    else target.emit('remove-waypoint');
  }

  // Tear down a person's superseded connection(s) after they've been rebound onto a new
  // socket: out of the room, and clear of the per-socket state that would otherwise keep
  // them on everyone's map as a second, frozen copy of themselves.
  function purgeStaleSockets(roomCode, staleIds = []) {
    for (const staleId of staleIds) {
      io.sockets.sockets.get(staleId)?.leave(roomCode);
      delete users[staleId];
      delete locationCache[staleId];
    }
  }

  function handleSquadSuccession(disconnectedId) {
    for (const roomCode in activeSquads) {
      const squad = activeSquads[roomCode];

      // Only reached on a deliberate exit (leave-squad, mutiny exile) — never on a raw
      // disconnect. Forget them, so coming back means asking the Commander again.
      const departingUid = squad.memberUids?.[disconnectedId];
      if (departingUid) {
        forgetMember(squad, departingUid);
        removePresence(squad, departingUid);
        endSession(squad, departingUid);
        delete squad.memberUids[disconnectedId];
      }

      squad.members = squad.members.filter(id => id !== disconnectedId);

      if (squad.members.length === 0) {
        if (!hasPresence(squad, Date.now())) deleteSquad(roomCode);
        // Members still sharing from the background keep the squad. Nobody connected holds
        // command; whoever of the admitted comes back first takes it (request-join, Case 4).
        else if (squad.ownerId === disconnectedId) {
          squad.ownerId = null;
          squad.ownerUid = null;
        }
      } else if (squad.ownerId === disconnectedId) {
        // A connected member, if there is one. members[0] could be a dead socket still on
        // the roster (typically the Commander's, while they're away), and promoting it
        // left nobody holding command and the promotion addressed to no one.
        squad.ownerId = squad.members.find(id => io.sockets.sockets.has(id)) ?? squad.members[0];
        // Ownership goes by uid too. The departing Commander's uid used to stay on as
        // ownerUid, so they could walk back in later and be made owner again (request-join
        // Case 3), silently taking the squad from the member promoted here, whose client
        // still said OWNER while every Commander action they took was refused.
        squad.ownerUid = squad.memberUids?.[squad.ownerId] || io.sockets.sockets.get(squad.ownerId)?.data?.uid || null;
        io.to(squad.ownerId).emit('promoted-to-owner', { roomCode });
        sendJoinQueue(squad, roomCode, squad.ownerId);
      }

      // The Commander leaving on purpose (or voted out) gives up the squad for good: it
      // becomes the squad of whoever holds command now, who is then the one a return
      // hands it back to. (A stand-in leaving changes nothing here: the squad is still
      // the Commander's to reclaim.)
      if (departingUid && departingUid === squad.commanderUid) {
        squad.commanderUid = squad.ownerUid;
        persistGroupSettings(roomCode);
      }
    }
  }

  // Put a connected member the Commander let in in charge while nobody holds command, and
  // hand them the join queue. First on the roster wins, the same order succession uses.
  // Returns whether anyone was promoted.
  function promoteStandIn(squad, roomCode) {
    const standInId = squad.members.find(
      id => io.sockets.sockets.has(id) && isKnownMember(squad, squad.memberUids?.[id])
    );
    if (!standInId) return false;
    squad.ownerId = standInId;
    squad.ownerUid = squad.memberUids[standInId];
    io.to(standInId).emit('promoted-to-owner', { roomCode });
    sendJoinQueue(squad, roomCode, standInId);
    return true;
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 LOCUS Server running on port ${PORT}`);
});

// For tests that run this server inside their own process: the port it chose (PORT=0), and a
// way to stop everything it started. Running `node backend/server.js` never uses either.
export const listening = new Promise((resolve) => server.once('listening', () => resolve(server.address().port)));
export function stopServer() {
  clearInterval(sweepTimer);
  clearInterval(presenceTimer);
  return new Promise((resolve) => io.close(() => resolve()));
}