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
// --- NEW: SQUAD REGISTRY ---
const activeSquads = {}; 


let users = {};



  io.on('connection', (socket) => {
    console.log(`🟢 Node Connected: ${socket.id}`);

    // --- UPGRADED: GATEKEEPER ENTRY PROTOCOL ---
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

    // --- NEW: COMMANDER RESOLUTION PROTOCOL ---
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

    // ... CUSTOM ADMIN ROUTE BROADCASTER (Line 22) stays below this ...
  // --- CUSTOM ADMIN ROUTE BROADCASTER ---
  socket.on('publish-custom-route', (payload) => {
    console.log(`[SYS] Admin published new map route: ${payload.key}`);
    // Bounces the custom route data to EVERYONE connected
    socket.broadcast.emit('new-custom-route', payload); 
  });

  // --- LOCATION & ROOM ENGINE ---
  socket.on('update-location', (data) => {
    const newRoom = data.roomCode || 'GLOBAL';
    const oldRoom = users[socket.id]?.roomCode;

    // 1. Leave old room if switching to a new squad
    if (oldRoom && oldRoom !== newRoom) {
      socket.leave(oldRoom);
    }
    // --- 🚨 MEMORY LEAK PLUG 🚨 ---
  
  // 1. Triggered when the user explicitly clicks "Disconnect" or "Logout"
  socket.on('leave-squad', () => {
    if (activeUsers[socket.id]) {
      console.log(`[SYS] Node ${socket.id} wiped from server RAM (Manual)`);
      delete activeUsers[socket.id]; // Completely deletes the user object
      io.emit('users-update', activeUsers); // Update everyone else's map
    }
  });

  // 2. Triggered when the user closes the browser tab or their phone goes to sleep
  socket.on('disconnect', () => {
    if (activeUsers[socket.id]) {
      console.log(`[SYS] Node ${socket.id} wiped from server RAM (Connection Lost)`);
      delete activeUsers[socket.id]; 
      io.emit('users-update', activeUsers);
      // --- NEW: SQUAD SUCCESSION ---
    for (const roomCode in activeSquads) {
      const squad = activeSquads[roomCode];
      squad.members = squad.members.filter(id => id !== socket.id);

      if (squad.members.length === 0) {
        delete activeSquads[roomCode];
      } else if (squad.ownerId === socket.id) {
        squad.ownerId = squad.members[0];
        io.to(squad.ownerId).emit('promoted-to-owner', { roomCode });
        console.log(`👑 [SYS_NODE] Command of ${roomCode} transferred to ${squad.ownerId}`);
      }
    }
    }
  });

    // 2. Join the new room
    socket.join(newRoom);
    users[socket.id] = { ...data, roomCode: newRoom };
    
    // 3. Get ONLY users in this specific room
    const roomUsers = {};
    Object.keys(users).forEach(id => {
      if (users[id].roomCode === newRoom) {
        roomUsers[id] = users[id];
      }
    });

    // 4. Broadcast ONLY to the specific room
    io.to(newRoom).emit('users-update', roomUsers);
  });

  // --- RADAR PING ENGINE ---
  socket.on('ping-user', ({ targetId, senderName }) => {
    // Forward the ping specifically to the target user
    io.to(targetId).emit('receive-ping', { senderName });
  });

  // --- DISCONNECT HANDLER ---
  socket.on('disconnect', () => {
    console.log(`🔴 Node Disconnected: ${socket.id}`);
    const room = users[socket.id]?.roomCode;
    delete users[socket.id];
    
    if (room) {
      const remaining = {};
      Object.keys(users).forEach(id => {
        if (users[id].roomCode === room) remaining[id] = users[id];
      });
      io.to(room).emit('users-update', remaining);
    }
  });
});

// --- RENDER PORT ASSIGNMENT ---
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 LOCUS Server running on port ${PORT}`);
});