import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

// --- ORACLE PROXY ---
app.post('/api/oracle', async (req, res) => {
  try {
    const { query, myStatus, squadTelemetry, nearestBuildings, prompt, systemInstruction } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error("🚨 [SYS_FAILURE] Missing GEMINI_API_KEY in backend environment");
      return res.status(500).json({ error: 'Missing API Key on Server' });
    }

    const effectiveSystemInstruction = systemInstruction || `You are SYS_ORACLE, a tactical AI on the LOCUS network at SRM KTR. 
MY_STATUS: ${myStatus || 'OFFLINE'}
SQUAD_TELEMETRY: ${squadTelemetry || 'NO_ACTIVE_NODES'}
NEAREST_BUILDINGS: ${nearestBuildings || 'UNKNOWN'}
DIRECTIVE: Answer the user's query utilizing the data above. Keep answers strictly under 3 sentences. Use a concise, military-comms tone. Provide spatial awareness when asked.`;

    const userQuery = query || prompt || "";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

    const payload = {
      system_instruction: {
        parts: [{ text: effectiveSystemInstruction }]
      },
      contents: [
        { role: "user", parts: [{ text: userQuery }] }
      ]
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("🚨 [GEMINI ERROR]:", errorData);
        return res.status(response.status).json({ error: 'Gemini API Error', details: errorData });
      }

      const data = await response.json();
      const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response found.";
      return res.json({ reply: replyText });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') {
        console.error("🚨 [ORACLE PROXY TIMEOUT]: Gemini API request timed out (10s)");
        return res.status(504).json({ error: 'Oracle Request Timeout' });
      }
      throw fetchErr;
    }
  } catch (error) {
    console.error("🚨 [ORACLE PROXY ERROR]:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

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
// or dead members for a while. Prune anything with no live members, a dead owner,
// or no activity for 5+ minutes so an old test-session code can't shadow a new one.
const ROOM_TTL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const roomCode in activeSquads) {
    const squad = activeSquads[roomCode];
    squad.members = squad.members.filter(id => io.sockets.sockets.has(id));

    const ownerIsLive = io.sockets.sockets.has(squad.ownerId);
    const isStale = now - (squad.lastActivity || 0) > ROOM_TTL_MS;

    if (squad.members.length === 0 || !ownerIsLive || isStale) {
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
    // A room only counts as "occupied" if its owner socket is still actually
    // connected. Mobile clients (killed/backgrounded APKs) often vanish without
    // a clean disconnect, leaving a ghost owner that a real request-join would
    // otherwise be silently routed to (see 'access-request' below).
    const ownerIsLive = existing && io.sockets.sockets.has(existing.ownerId);

    if (!existing || existing.members.length === 0 || !ownerIsLive) {
      activeSquads[roomCode] = { ownerId: socket.id, members: [socket.id], activeWaypoint: null, lastActivity: Date.now() };
      socket.join(roomCode);
      socket.emit('access-granted', { role: 'OWNER', roomCode });
    } else {
      const commanderId = existing.ownerId;
      io.to(commanderId).emit('access-request', {
        targetId: socket.id, name: user.name, photo: user.photo, roomCode: roomCode
      });
      socket.emit('access-pending');
    }
  });

  socket.on('resolve-access', ({ targetId, roomCode, approved }) => {
    if (activeSquads[roomCode] && activeSquads[roomCode].ownerId === socket.id) {
      if (approved) {
        activeSquads[roomCode].members.push(targetId);
        const targetSocket = io.sockets.sockets.get(targetId);
        if (targetSocket) {
          targetSocket.join(roomCode);
          targetSocket.emit('access-granted', { role: 'MEMBER', roomCode });
          
          if (activeSquads[roomCode].activeWaypoint) {
            targetSocket.emit('new-waypoint', activeSquads[roomCode].activeWaypoint);
          }
        }
      } else {
        io.to(targetId).emit('access-denied');
      }
    }
  });

  socket.on('publish-custom-route', (payload) => {
    socket.broadcast.emit('new-custom-route', payload); 
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
    const { roomCode, lat, lng, speed, battery, status, name, photo, heading } = data;
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
    
    handleSquadSuccession(socket.id);
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