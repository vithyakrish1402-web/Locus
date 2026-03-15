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

let users = {};

io.on('connection', (socket) => {
  console.log(`🟢 Node Connected: ${socket.id}`);

  // --- LOCATION & ROOM ENGINE ---
  socket.on('update-location', (data) => {
    const newRoom = data.roomCode || 'GLOBAL';
    const oldRoom = users[socket.id]?.roomCode;

    // 1. Leave old room if switching to a new squad
    if (oldRoom && oldRoom !== newRoom) {
      socket.leave(oldRoom);
    }

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