const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allows your Vercel frontend to connect
    methods: ["GET", "POST"]
  }
});

// Object to track all users globally
const users = {};

io.on('connection', (socket) => {
  console.log(`🟢 Node Connected: ${socket.id}`);

  // 1. Handle Location & Squad Rooms
  socket.on('update-location', (data) => {
    const room = data.roomCode || 'GLOBAL'; 
    
    // Join the specific room (this keeps the connection private)
    socket.join(room);

    // Save user data to the global object
    users[socket.id] = { ...data, roomCode: room };

    // --- THE FILTER ---
    // Get all users, but only keep the ones who are in THIS room
    const squadUsers = {};
    Object.keys(users).forEach((id) => {
      if (users[id].roomCode === room) {
        squadUsers[id] = users[id];
      }
    });

    // --- THE BROADCAST ---
    // Use io.to(room) so ONLY people with the same code receive this update
    io.to(room).emit('users-update', squadUsers);
  });

  // 2. Handle the "Friend Ping" / Radar feature
  socket.on('ping-user', ({ targetId, senderName }) => {
    io.to(targetId).emit('receive-ping', { senderName });
  });

  // 3. Handle Disconnects (When someone closes the app)
  socket.on('disconnect', () => {
    console.log(`🔴 Node Disconnected: ${socket.id}`);
    
    const room = users[socket.id]?.roomCode;
    delete users[socket.id]; // Remove them from the server
    
    // Update the squad so the marker disappears for everyone else
    if (room) {
      const squadUsers = {};
      for (const [id, user] of Object.entries(users)) {
         if (user.roomCode === room) {
             squadUsers[id] = user;
         }
      }
      io.to(room).emit('users-update', squadUsers);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Locus Core Server running on port ${PORT}`);
});