import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { resolveSosRoom, recordSos, toSosPayload, pendingSosFor, ackSos, memberKey, sharedSquad } from './sosRelay.js';
import {
  rememberMember, forgetMember, rebindReturningMember, collectStaleSocketIds,
  refuseJoin, addPendingRequest, takePendingRequest, withdrawPendingRequests, pendingRequestsOf,
} from './squadRoster.js';

const app = express();
app.use(cors());
app.use(express.json());

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
setInterval(() => {
  const now = Date.now();
  for (const roomCode in activeSquads) {
    const squad = activeSquads[roomCode];
    squad.members = squad.members.filter(id => io.sockets.sockets.has(id));

    const isStale = now - (squad.lastActivity || 0) > ROOM_TTL_MS;

    if (squad.members.length === 0 || isStale) {
      console.log(`[🧹 SWEEP] Removing abandoned/stale squad: ${roomCode}`);
      deleteSquad(roomCode);
    }
  }
}, SWEEP_INTERVAL_MS);

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
  delete activeSquads[roomCode];
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
    if (!squad || !squad.members.includes(socket.id) || !squad.members.includes(targetId)) return;

    if (!squad.kickVotes) squad.kickVotes = {};
    if (!squad.kickVotes[targetId]) squad.kickVotes[targetId] = new Set();
    squad.kickVotes[targetId].add(socket.id);

    const requiredVotes = Math.max(2, Math.ceil(squad.members.length / 2)); 
    const currentVotes = squad.kickVotes[targetId].size;

    io.to(roomCode).emit('mutiny-status', { targetId, votes: currentVotes, required: requiredVotes });

    if (currentVotes >= requiredVotes) {
      io.to(targetId).emit('exiled');
      delete squad.kickVotes[targetId];
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
    }
  });

  // --- SAFETY PING ENGINE (LKL) ---
  socket.on('safety-ping', (data) => {
    const { latitude, longitude, timestamp, batteryLevel } = data ?? {};
    // Merge rather than overwrite: 'update-location' writes speed/heading/lastSeen
    // into this same cache entry, and clobbering it here would erase that trajectory data.
    locationCache[socket.id] = { ...locationCache[socket.id], latitude, longitude, timestamp, batteryLevel: batteryLevel || 'Unknown' };
  });

  socket.on('request-telemetry', (roomCode) => {
    const squad = activeSquads[roomCode];
    if (squad && squad.ownerId === socket.id) {
      const squadTelemetry = {};
      squad.members.forEach(memberId => {
        if (locationCache[memberId]) squadTelemetry[memberId] = locationCache[memberId];
      });
      socket.emit('telemetry-sync-complete', squadTelemetry);
    }
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
    const refusal = refuseJoin(existing, { intent, uid: requesterUid, isSocketLive: (id) => io.sockets.sockets.has(id) });
    if (refusal) {
      socket.emit(refusal, { roomCode });
      return;
    }

    // Case 1: brand-new or fully abandoned room -> requester becomes the owner.
    if (!existing || existing.members.length === 0) {
      activeSquads[roomCode] = {
        ownerId: socket.id,
        ownerUid: requesterUid,
        members: [socket.id],
        memberUids: requesterUid ? { [socket.id]: requesterUid } : {},
        knownUids: requesterUid ? [requesterUid] : [],
        blockedUids: existing?.blockedUids || [],
        activeWaypoint: null,
        lastActivity: Date.now()
      };
      socket.join(roomCode);
      socket.emit('access-granted', { role: 'OWNER', roomCode });
      sendRallyPoint(socket, activeSquads[roomCode]);
      return;
    }

    // Case 2: this identity was explicitly blocked by the commander -> hard deny.
    if (requesterUid && existing.blockedUids?.includes(requesterUid)) {
      socket.emit('access-denied', { roomCode });
      return;
    }

    // Case 3: the reconnecting socket IS the squad's owner (uid match) -> always
    // let them straight back in as OWNER. Rebind their new socket id and keep
    // everyone else already in the roster instead of wiping it.
    if (requesterUid && existing.ownerUid && requesterUid === existing.ownerUid) {
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
      existing.memberUids = existing.memberUids || {};
      staleIds.forEach(id => delete existing.memberUids[id]);
      existing.memberUids[socket.id] = requesterUid;
      rememberMember(existing, requesterUid);
      existing.lastActivity = Date.now();
      socket.join(roomCode);
      purgeStaleSockets(roomCode, staleIds);
      socket.emit('access-granted', { role: 'OWNER', roomCode });
      sendJoinQueue(existing, roomCode, socket.id);
      sendRallyPoint(socket, existing);
      broadcastSquadUpdate(roomCode);
      return;
    }

    // Case 4: someone else's request against a room whose owner socket is truly
    // gone (crashed/uninstalled, not just mid-reconnect) -> let them take over as
    // caretaker owner rather than stranding the squad, keeping the roster intact.
    const ownerIsLive = io.sockets.sockets.has(existing.ownerId);
    if (!ownerIsLive) {
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
      existing.lastActivity = Date.now();
      socket.join(roomCode);
      purgeStaleSockets(roomCode, staleIds);
      socket.emit('access-granted', { role: 'OWNER', roomCode });
      sendJoinQueue(existing, roomCode, socket.id);
      sendRallyPoint(socket, existing);
      broadcastSquadUpdate(roomCode);
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
      // The same person's previous connection(s): superseded. Detached from the room and
      // stripped of per-socket state so they can't show as a duplicate marker, or later
      // raise a false "signal lost" for someone who is in fact back.
      purgeStaleSockets(roomCode, returning.staleIds);
      existing.lastActivity = Date.now();
      socket.join(roomCode);
      socket.emit('access-granted', { role: returning.role, roomCode });
      if (returning.role === 'OWNER') sendJoinQueue(existing, roomCode, socket.id);
      sendRallyPoint(socket, existing);
      broadcastSquadUpdate(roomCode);
      return;
    }

    // Case 5: normal gatekeeper flow — a genuine new joiner needs the live owner's approval.
    // Recorded, so that only a request still open can be approved (see resolve-access).
    const commanderId = existing.ownerId;
    addPendingRequest(existing, socket.id, { uid: requesterUid, name: user?.name ?? null, photo: user?.photo ?? null });
    io.to(commanderId).emit('access-request', {
      targetId: socket.id, name: user?.name, photo: user?.photo, roomCode: roomCode
    });
    // Every reply names its squad, so a client can ignore one about a squad it has left.
    socket.emit('access-pending', { roomCode });
  });

  // ABORT HANDSHAKE: the joiner stops waiting. Withdrawn server-side, and the Commander
  // told, so a GRANT tapped later on a stale screen can't pull them in after all.
  socket.on('cancel-join', () => {
    withdrawJoinRequests(null);
  });

  socket.on('resolve-access', (payload) => {
    const { targetId, roomCode, approved } = payload ?? {};
    const squad = activeSquads[roomCode];
    if (!squad || squad.ownerId !== socket.id) return;

    // Only a request that is still open. This used to accept any socket id at all: a
    // joiner who had aborted, or had since created or joined another squad, was pulled in
    // anyway (ending up in two squads), or bounced out of the one they'd moved to by a
    // stale denial. The Commander is told the request is gone, so it leaves their queue.
    const request = takePendingRequest(squad, targetId);
    if (!request) {
      socket.emit('access-request-withdrawn', { targetId, roomCode });
      return;
    }

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
        // Put them on everyone's roster now. Previously the squad only learned of a new
        // member when that member's first telemetry arrived, so a mid-session joiner was
        // missing from the list for a polling interval (up to 15s in eco mode) — and
        // indefinitely if they never got a fix at all.
        broadcastSquadUpdate(roomCode);
      }
    } else {
      io.to(targetId).emit('access-denied', { roomCode });
    }
  });

  // --- 🚫 COMMANDER BLOCK (durable — survives the target's reconnects) ---
  socket.on('block-user', (payload) => {
    const { roomCode, targetId } = payload ?? {};
    const squad = activeSquads[roomCode];
    if (!squad || squad.ownerId !== socket.id || targetId === socket.id) return;

    const targetUid = squad.memberUids?.[targetId] || io.sockets.sockets.get(targetId)?.data?.uid;
    squad.blockedUids = squad.blockedUids || [];
    if (targetUid && !squad.blockedUids.includes(targetUid)) squad.blockedUids.push(targetUid);
    forgetMember(squad, targetUid);

    squad.members = squad.members.filter(id => id !== targetId);
    if (squad.memberUids) delete squad.memberUids[targetId];
    delete users[targetId];
    delete locationCache[targetId];

    console.log(`[🚫 BLOCK] Commander banned node ${targetId} from ${roomCode}`);
    io.to(targetId).emit('exiled', { reason: 'blocked' });
    // Same as a mutiny exile: off the roster AND out of the room, without relying on the
    // blocked client to leave when told. Otherwise a modified client stays subscribed to
    // the squad it was banned from, and keeps receiving its locations and SOS alerts.
    io.sockets.sockets.get(targetId)?.leave(roomCode);
    broadcastSquadUpdate(roomCode);
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

    const oldRoom = users[socket.id]?.roomCode;

    if (oldRoom && oldRoom !== newRoom) socket.leave(oldRoom);
    socket.join(newRoom);

    // 👇 Armored Cache Assignment
    users[socket.id] = {
      ...data,
      roomCode: newRoom,
      heading: heading || 0,       // Failsafe: Prevents NaN crashes on the frontend
      lastSeen: Date.now()         // Anchor: Records the exact millisecond of the last known ping
    };

    // Mirror the live trajectory into locationCache too (merged with whatever
    // safety-ping last wrote), so the disconnect handler's Dead Man's Switch
    // actually has real speed/heading/lastSeen instead of permanently-undefined fields.
    locationCache[socket.id] = {
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
    if (!sharedSquad(activeSquads, socket.id, targetId)) {
      console.warn(`[PING] Dropped: ${socket.id} is not in a squad with ${targetId}`);
      return;
    }
    io.to(targetId).emit('receive-ping', { senderName });
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
    console.log(`[🚨 SOS] ${senderName} triggered a distress beacon in ${roomCode}`);
    // One clock reading for both, so a live broadcast is reliably age 0 rather than
    // occasionally 1ms if the second Date.now() ticks over.
    const now = Date.now();
    const sos = recordSos(activeSquads[roomCode], {
      senderKey: memberKey(socket.data?.uid, socket.id),
      senderId: socket.id,
      senderName,
      lat,
      lng,
      timestamp,
    }, now);
    socket.to(roomCode).emit('sos-received', toSosPayload(sos, now));
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

    delete users[socket.id];
    delete locationCache[socket.id];
    rooms.forEach(roomCode => socket.leave(roomCode));

    handleSquadSuccession(socket.id);
    rooms.forEach(roomCode => broadcastSquadUpdate(roomCode));
  });

  socket.on('disconnect', () => {
    console.log(`🔴 Node Disconnected: ${socket.id}`);
    // A joiner who drops off while waiting has nothing left to approve. (Back on a new
    // socket, their client asks again, and that request is the one the Commander sees.)
    withdrawJoinRequests(null);
    
    if (users[socket.id]) {
      const room = users[socket.id].roomCode;
      const userData = users[socket.id];
      const lastLocation = locationCache[socket.id];
      const squad = activeSquads[room];

      // TRIGGER DEAD MAN'S SWITCH 
      if (lastLocation && squad) {
        
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
  });

  // Withdraw every open join request made from this socket, and with a uid, that person's
  // from earlier connections too. Each squad's Commander is told, so the request leaves
  // their queue instead of waiting there for a GRANT that would pull in someone who left.
  function withdrawJoinRequests(uid) {
    for (const { roomCode, targetId } of withdrawPendingRequests(activeSquads, { socketId: socket.id, uid })) {
      const ownerId = activeSquads[roomCode]?.ownerId;
      if (ownerId) io.to(ownerId).emit('access-request-withdrawn', { targetId, roomCode });
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
  function broadcastSquadUpdate(roomCode) {
    const squad = activeSquads[roomCode];
    const ids = new Set(squad ? squad.members : []);
    Object.keys(users).forEach(id => { if (users[id].roomCode === roomCode) ids.add(id); });

    const roomUsers = {};
    ids.forEach(id => {
      const telemetry = users[id];
      if (telemetry && telemetry.roomCode !== roomCode) return;
      const live = io.sockets.sockets.get(id);
      // A roster entry whose socket is gone and which never reported a fix: there is
      // nothing to show, and its own disconnect handler is about to prune it anyway.
      if (!telemetry && !live) return;

      const uid = squad?.memberUids?.[id] || live?.data?.uid || null;
      const profile = live?.data?.profile || {};
      roomUsers[id] = telemetry
        ? { ...telemetry, uid, hasFix: true }
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
          };
    });
    io.to(roomCode).emit('users-update', roomUsers);
  }

  function handleSquadSuccession(disconnectedId) {
    for (const roomCode in activeSquads) {
      const squad = activeSquads[roomCode];

      // Only reached on a deliberate exit (leave-squad, mutiny exile) — never on a raw
      // disconnect. Forget them, so coming back means asking the Commander again.
      const departingUid = squad.memberUids?.[disconnectedId];
      if (departingUid) {
        forgetMember(squad, departingUid);
        delete squad.memberUids[disconnectedId];
      }

      squad.members = squad.members.filter(id => id !== disconnectedId);

      if (squad.members.length === 0) {
        deleteSquad(roomCode);
      } else if (squad.ownerId === disconnectedId) {
        squad.ownerId = squad.members[0];
        // Ownership goes by uid too. The departing Commander's uid used to stay on as
        // ownerUid, so they could walk back in later and be made owner again (request-join
        // Case 3), silently taking the squad from the member promoted here, whose client
        // still said OWNER while every Commander action they took was refused.
        squad.ownerUid = squad.memberUids?.[squad.ownerId] || io.sockets.sockets.get(squad.ownerId)?.data?.uid || null;
        io.to(squad.ownerId).emit('promoted-to-owner', { roomCode });
        sendJoinQueue(squad, roomCode, squad.ownerId);
      }
    }
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 LOCUS Server running on port ${PORT}`);
});