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
const users = {}; // Unified user tracking
const locationCache = {}; // For potential future use (e.g., last known locations)

io.on('connection', (socket) => {
  console.log(`🟢 Node Connected: ${socket.id}`);
  // --- SAFETY PING ENGINE (LAST KNOWN LOCATION) ---
  socket.on('safety-ping', (data) => {
    const { latitude, longitude, timestamp, batteryLevel } = data;
    
    // Silently update the cache. We only keep the most recent ping to save RAM.
    locationCache[socket.id] = {
      latitude,
      longitude,
      timestamp,
      batteryLevel: batteryLevel || 'Unknown'
    };
  });

  // --- GATEKEEPER ENTRY PROTOCOL ---
  socket.on('request-join', (data) => {
    const { roomCode, user } = data;

    if (!activeSquads[roomCode] || activeSquads[roomCode].members.length === 0) {
      activeSquads[roomCode] = { ownerId: socket.id, members: [socket.id] };
      socket.join(roomCode);
      socket.emit('access-granted', { role: 'OWNER', roomCode });
      console.log(`👑 [SYS_NODE] ${user.name} established new squad: ${roomCode}`);
    } else {
      console.log(`🛡️ [SYS_NODE] ${user.name} requesting access to ${roomCode}`);
      const commanderId = activeSquads[roomCode].ownerId;
      io.to(commanderId).emit('access-request', {
        targetId: socket.id, name: user.name, photo: user.photo, roomCode: roomCode
      });
      socket.emit('access-pending'); 
    }
  });

  // --- COMMANDER RESOLUTION PROTOCOL ---
  socket.on('resolve-access', ({ targetId, roomCode, approved }) => {
    if (activeSquads[roomCode] && activeSquads[roomCode].ownerId === socket.id) {
      if (approved) {
        activeSquads[roomCode].members.push(targetId);
        const targetSocket = io.sockets.sockets.get(targetId);
        if (targetSocket) {
          targetSocket.join(roomCode);
          targetSocket.emit('access-granted', { role: 'MEMBER', roomCode });
          console.log(`✅ [SYS_NODE] Access granted to node: ${targetId}`);
        }
      } else {
        io.to(targetId).emit('access-denied');
        console.log(`❌ [SYS_NODE] Access denied for node: ${targetId}`);
      }
    }
  });

  // --- CUSTOM ADMIN ROUTE BROADCASTER ---
  socket.on('publish-custom-route', (payload) => {
    console.log(`[SYS] Admin published new map route: ${payload.key}`);
    socket.broadcast.emit('new-custom-route', payload); 
  });

  // --- LOCATION & ROOM ENGINE ---
  socket.on('update-location', (data) => {
    const newRoom = data.roomCode || 'GLOBAL';
    const oldRoom = users[socket.id]?.roomCode;

    if (oldRoom && oldRoom !== newRoom) {
      socket.leave(oldRoom);
    }

    socket.join(newRoom);
    users[socket.id] = { ...data, roomCode: newRoom };
    
    const roomUsers = {};
    Object.keys(users).forEach(id => {
      if (users[id].roomCode === newRoom) {
        roomUsers[id] = users[id];
      }
    });

    io.to(newRoom).emit('users-update', roomUsers);
  });

  // --- RADAR PING ENGINE ---
  socket.on('ping-user', ({ targetId, senderName }) => {
    io.to(targetId).emit('receive-ping', { senderName });
  });

  // --- MANUAL LEAVE SQUAD ---
  socket.on('leave-squad', () => {
    if (users[socket.id]) {
      console.log(`[SYS] Node ${socket.id} wiped from server RAM (Manual)`);
      const room = users[socket.id].roomCode;
      delete users[socket.id]; 
      
      // Update remaining users in that room
      const remaining = {};
      Object.keys(users).forEach(id => {
        if (users[id].roomCode === room) remaining[id] = users[id];
      });
      io.to(room).emit('users-update', remaining);
      
      // Trigger succession logic (reused from disconnect)
      handleSquadSuccession(socket.id);
    }
  });

  // --- UNIFIED DISCONNECT HANDLER & DEAD MAN'S SWITCH ---
  socket.on('disconnect', () => {
    console.log(`🔴 Node Disconnected: ${socket.id}`);
    
    if (users[socket.id]) {
      const room = users[socket.id].roomCode;
      const userName = users[socket.id].name || 'Unknown Unit';
      
      // 1. TRIGGER DEAD MAN'S SWITCH 
      const lastLocation = locationCache[socket.id];
      const squad = activeSquads[room];

      if (lastLocation && squad && squad.ownerId !== socket.id) {
        console.log(`🚨 [EMERGENCY] Signal lost for ${userName}. Dispatching LKL to Commander.`);
        
        // Fire a high-priority alert directly to the Commander
        io.to(squad.ownerId).emit('member-signal-lost', {
          targetId: socket.id,
          name: userName,
          lastKnownLocation: lastLocation,
          disconnectTime: new Date().toISOString()
        });
      }

      // 2. Wipe memory
      delete users[socket.id];
      delete locationCache[socket.id]; // Prevent memory leaks
      
      // 3. Update map for remaining users
      if (room) {
        const remaining = {};
        Object.keys(users).forEach(id => {
          if (users[id].roomCode === room) remaining[id] = users[id];
        });
        io.to(room).emit('users-update', remaining);
      }
    }

    // 4. Handle Squad Succession
    handleSquadSuccession(socket.id);
  });

  // Helper function to keep disconnect logic clean
  function handleSquadSuccession(disconnectedId) {
    for (const roomCode in activeSquads) {
      const squad = activeSquads[roomCode];
      
      // Remove the user from the squad's member array
      squad.members = squad.members.filter(id => id !== disconnectedId);

      if (squad.members.length === 0) {
        // Room is empty, delete it
        delete activeSquads[roomCode];
        console.log(`[SYS] Squad ${roomCode} disbanded (Empty)`);
      } else if (squad.ownerId === disconnectedId) {
        // Captain left, promote the next person in line
        squad.ownerId = squad.members[0];
        io.to(squad.ownerId).emit('promoted-to-owner', { roomCode });
        console.log(`👑 [SYS_NODE] Command of ${roomCode} transferred to ${squad.ownerId}`);
      }
    }
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 LOCUS Server running on port ${PORT}`);
});