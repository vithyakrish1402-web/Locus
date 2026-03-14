import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const server = createServer(app);

// Origin "*" is fine for hackathons, allows any frontend to connect
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

let users = {};

io.on("connection", (socket) => {
  console.log("Node linked to Matrix:", socket.id);

  // Handle incoming pings
  socket.on("ping-user", ({ targetId, senderName }) => {
    console.log(`⚡ [SYS_PING] Routing signal from ${senderName} to Node: ${targetId}`);
    
    // Sends the event ONLY to the specific target user
    io.to(targetId).emit("receive-ping", { 
      senderName: senderName, 
      senderId: socket.id 
    });
  });

  // Handle location updates
  socket.on("update-location", (data) => {
    users[socket.id] = data;
    // Broadcast updated list to everyone
    io.emit("users-update", users);
  });

  // Handle cleanup on disconnect
  socket.on("disconnect", () => {
    console.log("Node delinked:", socket.id);
    delete users[socket.id];
    io.emit("users-update", users);
  });
});

// CLOUD DEPLOYMENT PORT LOGIC
// process.env.PORT tells the server to use whatever port the host (Render/Railway) provides.
const PORT = process.env.PORT || 5000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 LOCUS Engine Online: Active on Port ${PORT}`);
});