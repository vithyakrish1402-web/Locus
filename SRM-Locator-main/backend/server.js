const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

let users = {};

io.on('connection', (socket) => {
  console.log(`Node Connected: ${socket.id}`);

  socket.on('update-location', (data) => {
    const newRoom = data.roomCode || 'GLOBAL';
    const oldRoom = users[socket.id]?.roomCode;

    // Leave old room if switching
    if (oldRoom && oldRoom !== newRoom) {
      socket.leave(oldRoom);
    }

    socket.join(newRoom);
    users[socket.id] = { ...data, roomCode: newRoom };

    // Get ONLY users in this specific room
    const roomUsers = {};
    Object.keys(users).forEach(id => {
      if (users[id].roomCode === newRoom) {
        roomUsers[id] = users[id];
      }
    });

    // Broadcast ONLY to the room
    io.to(newRoom).emit('users-update', roomUsers);
  });

  socket.on('disconnect', () => {
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

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));