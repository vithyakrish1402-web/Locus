import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- STATE MANAGERS ---
const activeSquads = {};
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
const ROOM_TTL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const roomCode in activeSquads) {
    const squad = activeSquads[roomCode];
    squad.members = squad.members.filter(id => io.sockets.sockets.has(id));

    const isStale = now - (squad.lastActivity || 0) > ROOM_TTL_MS;

    if (squad.members.length === 0 || isStale) {
      console.log(`[🧹 SWEEP] Removing abandoned/stale squad: ${roomCode}`);
      delete activeSquads[roomCode];
    }
  }
}, 60 * 1000);

io.on('connection', (socket) => {
  console.log(`🟢 Node Connected: ${socket.id}`);

  // --- GEOFENCE ALARM RELAY ---
  socket.on('geofence-alert', (data) => {
    console.log(`[🚨 BREACH] ${data.userName} ${data.type === 'ENTER' ? 'entered' : 'left'} ${data.zoneName}`);
    // Broadcast the alarm to everyone else in the squad
    socket.to(data.roomCode).emit('geofence-alert', data);
  });

  // --- TACTICAL ZONE RELAY ---
    socket.on('publish-zone', (data) => {
      console.log(`[SYS] Relaying new Tactical Zone to squad: ${data.roomCode}`);
      
      // Broadcasts the zone to everyone in the room EXCEPT the person who drew it
      socket.to(data.roomCode).emit('new-zone', data.zone);
    });

  // --- BACKEND ---
socket.on('check-ping', (clientTimestamp) => {
  // Immediately bounce the exact same timestamp back to the client
  socket.emit('pong-bounce', clientTimestamp);
});
  // --- ⚖️ THE MUTINY PROTOCOL ---
  socket.on('vote-to-kick', ({ targetId, roomCode }) => {
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
      handleSquadSuccession(targetId);
      broadcastSquadUpdate(roomCode);
    }
  });

  // --- SAFETY PING ENGINE (LKL) ---
  socket.on('safety-ping', (data) => {
    const { latitude, longitude, timestamp, batteryLevel } = data;
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
    const { roomCode, user } = data;
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

    // Case 1: brand-new or fully abandoned room -> requester becomes the owner.
    if (!existing || existing.members.length === 0) {
      activeSquads[roomCode] = {
        ownerId: socket.id,
        ownerUid: requesterUid,
        members: [socket.id],
        memberUids: requesterUid ? { [socket.id]: requesterUid } : {},
        blockedUids: existing?.blockedUids || [],
        activeWaypoint: null,
        lastActivity: Date.now()
      };
      socket.join(roomCode);
      socket.emit('access-granted', { role: 'OWNER', roomCode });
      return;
    }

    // Case 2: this identity was explicitly blocked by the commander -> hard deny.
    if (requesterUid && existing.blockedUids?.includes(requesterUid)) {
      socket.emit('access-denied');
      return;
    }

    // Case 3: the reconnecting socket IS the squad's owner (uid match) -> always
    // let them straight back in as OWNER. Rebind their new socket id and keep
    // everyone else already in the roster instead of wiping it.
    if (requesterUid && existing.ownerUid && requesterUid === existing.ownerUid) {
      existing.members = existing.members.filter(id => id !== existing.ownerId && io.sockets.sockets.has(id));
      existing.members.push(socket.id);
      existing.ownerId = socket.id;
      existing.memberUids = existing.memberUids || {};
      existing.memberUids[socket.id] = requesterUid;
      existing.lastActivity = Date.now();
      socket.join(roomCode);
      socket.emit('access-granted', { role: 'OWNER', roomCode });
      return;
    }

    // Case 4: someone else's request against a room whose owner socket is truly
    // gone (crashed/uninstalled, not just mid-reconnect) -> let them take over as
    // caretaker owner rather than stranding the squad, keeping the roster intact.
    const ownerIsLive = io.sockets.sockets.has(existing.ownerId);
    if (!ownerIsLive) {
      existing.ownerId = socket.id;
      existing.ownerUid = requesterUid;
      if (!existing.members.includes(socket.id)) existing.members.push(socket.id);
      existing.memberUids = existing.memberUids || {};
      existing.memberUids[socket.id] = requesterUid;
      existing.lastActivity = Date.now();
      socket.join(roomCode);
      socket.emit('access-granted', { role: 'OWNER', roomCode });
      return;
    }

    // Case 5: normal gatekeeper flow — a genuine new joiner needs the live owner's approval.
    const commanderId = existing.ownerId;
    io.to(commanderId).emit('access-request', {
      targetId: socket.id, name: user.name, photo: user.photo, roomCode: roomCode
    });
    socket.emit('access-pending');
  });

  socket.on('resolve-access', ({ targetId, roomCode, approved }) => {
    if (activeSquads[roomCode] && activeSquads[roomCode].ownerId === socket.id) {
      if (approved) {
        const targetSocket = io.sockets.sockets.get(targetId);
        // Only add to the roster if the requester is still actually connected —
        // pushing targetId unconditionally left a phantom member in squad.members
        // (never cleaned up until the next 60s stale sweep) whenever someone
        // disconnected while their join request was awaiting approval.
        if (targetSocket) {
          activeSquads[roomCode].members.push(targetId);
          targetSocket.join(roomCode);
          targetSocket.emit('access-granted', { role: 'MEMBER', roomCode });
          activeSquads[roomCode].memberUids = activeSquads[roomCode].memberUids || {};
          activeSquads[roomCode].memberUids[targetId] = targetSocket.data?.uid || null;

          if (activeSquads[roomCode].activeWaypoint) {
            targetSocket.emit('new-waypoint', activeSquads[roomCode].activeWaypoint);
          }
        }
      } else {
        io.to(targetId).emit('access-denied');
      }
    }
  });

  // --- 🚫 COMMANDER BLOCK (durable — survives the target's reconnects) ---
  socket.on('block-user', ({ roomCode, targetId }) => {
    const squad = activeSquads[roomCode];
    if (!squad || squad.ownerId !== socket.id || targetId === socket.id) return;

    const targetUid = squad.memberUids?.[targetId] || io.sockets.sockets.get(targetId)?.data?.uid;
    squad.blockedUids = squad.blockedUids || [];
    if (targetUid && !squad.blockedUids.includes(targetUid)) squad.blockedUids.push(targetUid);

    squad.members = squad.members.filter(id => id !== targetId);
    if (squad.memberUids) delete squad.memberUids[targetId];
    delete users[targetId];
    delete locationCache[targetId];

    console.log(`[🚫 BLOCK] Commander banned node ${targetId} from ${roomCode}`);
    io.to(targetId).emit('exiled', { reason: 'blocked' });
    broadcastSquadUpdate(roomCode);
  });

  socket.on('publish-custom-route', (payload) => {
    // Scoped to the sender's own squad — this used to be socket.broadcast.emit,
    // which leaked every squad's secret tactical routes to every other squad
    // connected to the server, regardless of room membership.
    if (payload?.roomCode) socket.to(payload.roomCode).emit('new-custom-route', payload);
  });

  // --- 🎯 COMMANDER WAYPOINTS ---
  socket.on('publish-waypoint', (data) => {
    const { roomCode, waypoint } = data;
    if (activeSquads[roomCode] && activeSquads[roomCode].ownerId === socket.id) {
      console.log(`[🎯 TACTICAL] New Rally Point designated in ${roomCode} at ${waypoint.lat}, ${waypoint.lng}`);
      activeSquads[roomCode].activeWaypoint = waypoint;
      socket.to(roomCode).emit('new-waypoint', waypoint);
      // Also emit back to the sender just in case they need to update state without trusting the client UI
      socket.emit('new-waypoint', waypoint); 
    }
  });

  socket.on('clear-waypoint', (roomCode) => {
    if (activeSquads[roomCode] && activeSquads[roomCode].ownerId === socket.id) {
      console.log(`[🚫 TACTICAL] Rally Point cleared in ${roomCode}`);
      activeSquads[roomCode].activeWaypoint = null;
      io.to(roomCode).emit('remove-waypoint');
    }
  });

  // --- 🌐 LOCATION & ROOM ENGINE (CENTRALIZED) ---
  socket.on('update-location', (data) => {
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

  socket.on('ping-user', ({ targetId, senderName }) => {
    io.to(targetId).emit('receive-ping', { senderName });
  });

  socket.on('leave-squad', () => {
    if (users[socket.id]) {
      const room = users[socket.id].roomCode;
      delete users[socket.id]; 
      broadcastSquadUpdate(room);
      handleSquadSuccession(socket.id);
    }
  });

  socket.on('disconnect', () => {
    console.log(`🔴 Node Disconnected: ${socket.id}`);
    
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

  function broadcastSquadUpdate(roomCode) {
    const roomUsers = {};
    Object.keys(users).forEach(id => {
      if (users[id].roomCode === roomCode) roomUsers[id] = users[id];
    });
    io.to(roomCode).emit('users-update', roomUsers);
  }

  function handleSquadSuccession(disconnectedId) {
    for (const roomCode in activeSquads) {
      const squad = activeSquads[roomCode];
      squad.members = squad.members.filter(id => id !== disconnectedId);

      if (squad.members.length === 0) {
        delete activeSquads[roomCode];
      } else if (squad.ownerId === disconnectedId) {
        squad.ownerId = squad.members[0];
        io.to(squad.ownerId).emit('promoted-to-owner', { roomCode });
      }
    }
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 LOCUS Server running on port ${PORT}`);
});