import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- STATE MANAGERS ---
const activeSquads = {}; 
const users = {}; 
const locationCache = {}; 

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
    locationCache[socket.id] = { latitude, longitude, timestamp, batteryLevel: batteryLevel || 'Unknown' };
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

    if (!activeSquads[roomCode] || activeSquads[roomCode].members.length === 0) {
      activeSquads[roomCode] = { ownerId: socket.id, members: [socket.id], activeWaypoint: null };
      socket.join(roomCode);
      socket.emit('access-granted', { role: 'OWNER', roomCode });
    } else {
      const commanderId = activeSquads[roomCode].ownerId;
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
      const lastLocation = locationCache[socket.id]; // ⚠️ Ensure 'heading' and 'lastSeen' are saved here!
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