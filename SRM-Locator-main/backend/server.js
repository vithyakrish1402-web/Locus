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

const GEOFENCE_RADIUS = 50; // Detection radius in meters
const TACTICAL_NODES = [
  { id: 'NODE_01', name: "Tech Park", lat: 12.825020, lng: 80.045323 },
  { id: 'NODE_02', name: "University Building (UB)", lat: 12.824353, lng: 80.042218 },
  { id: 'NODE_03', name: "Java Green", lat: 12.823348, lng: 80.044489 },
  { id: 'NODE_04', name: "T.P. Ganesan", lat: 12.824880, lng: 80.046685 }
];

// High-speed spatial distance calculator
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity;
  const R = 6371e3; // Earth radius in meters
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Returns distance in meters
}


io.on('connection', (socket) => {
  console.log(`🟢 Node Connected: ${socket.id}`);
  // --- ⚖️ THE MUTINY PROTOCOL (DEMOCRATIC KICK) ---
  socket.on('vote-to-kick', ({ targetId, roomCode }) => {
    const squad = activeSquads[roomCode];
    
    // 1. Validation: Ensure squad exists and both users are actually in it
    if (!squad || !squad.members.includes(socket.id) || !squad.members.includes(targetId)) return;

    // 2. Initialize the voting ledger for this squad if it's new
    if (!squad.kickVotes) squad.kickVotes = {};
    if (!squad.kickVotes[targetId]) squad.kickVotes[targetId] = new Set();

    // 3. Register the vote (Sets automatically prevent duplicate votes from the same user)
    squad.kickVotes[targetId].add(socket.id);

    // 4. Calculate the 50% threshold
    // Using Math.ceil ensures a squad of 3 requires 2 votes, a squad of 4 requires 2, etc.
    const requiredVotes = Math.max(2, Math.ceil(squad.members.length / 2)); 
    const currentVotes = squad.kickVotes[targetId].size;

    console.log(`⚖️ [MUTINY] Node ${socket.id} voted to exile ${targetId}. (${currentVotes}/${requiredVotes} votes)`);

    // 5. Broadcast the escalating tension to the room
    io.to(roomCode).emit('mutiny-status', {
      targetId: targetId,
      votes: currentVotes,
      required: requiredVotes
    });

    // 6. EXECUTE THE EXILE IF THRESHOLD MET
    if (currentVotes >= requiredVotes) {
      console.log(`💀 [MUTINY] Threshold met. Ejecting node ${targetId} from ${roomCode}.`);

      // A. Tell the target's app to self-destruct the connection
      io.to(targetId).emit('exiled');

      // B. Wipe their voting record to keep RAM clean
      delete squad.kickVotes[targetId];

      // C. Trigger the standard succession/cleanup logic we already built
      if (users[targetId]) {
        delete users[targetId];
        delete locationCache[targetId]; // If you added this cache earlier
      }
      handleSquadSuccession(targetId);

      // D. Update the map for the survivors
      const remaining = {};
      Object.keys(users).forEach(id => {
        if (users[id].roomCode === roomCode) remaining[id] = users[id];
      });
      io.to(roomCode).emit('users-update', remaining);
    }
  });
  
  // --- TACTICAL TELEMETRY SYNC (COMMANDERS ONLY) ---
  socket.on('request-telemetry', (roomCode) => {
    const squad = activeSquads[roomCode];
    
    // 1. SECURITY CHECK: Verify the requester is actually the Commander of this room
    if (squad && squad.ownerId === socket.id) {
      console.log(`📡 [SYS] Commander ${socket.id} requested telemetry for ${roomCode}`);
      
      // 2. DATA EXTRACTION: Pull only the cache data for this specific squad
      const squadTelemetry = {};
      squad.members.forEach(memberId => {
        if (locationCache[memberId]) {
          squadTelemetry[memberId] = locationCache[memberId];
        }
      });

      // 3. SECURE TRANSMISSION: Send the data specifically back to the Commander
      socket.emit('telemetry-sync-complete', squadTelemetry);
    } else {
      console.log(`⚠️ [SECURITY] Unauthorized telemetry request from ${socket.id}`);
    }
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
  // --- LOCATION & GEOFENCE ENGINE ---
  socket.on('update-location', (data) => {
    const newRoom = data.roomCode || 'GLOBAL';
    const oldRoom = users[socket.id]?.roomCode;

    if (oldRoom && oldRoom !== newRoom) {
      socket.leave(oldRoom);
    }
    socket.join(newRoom);

    // 1. SPATIAL GEOFENCE CHECK
    let currentZone = null;
    for (const node of TACTICAL_NODES) {
      if (calculateDistance(data.lat, data.lng, node.lat, node.lng) <= GEOFENCE_RADIUS) {
        currentZone = node.name;
        break; // Stop checking once we find the zone they are in
      }
    }

    // 2. DETECT PERIMETER BREACH (Entry or Exit)
    const previousZone = users[socket.id]?.currentZone;
    
    if (currentZone && previousZone !== currentZone) {
      // User entered a new zone
      io.to(newRoom).emit('geofence-alert', {
         userName: data.name || 'Unknown Unit',
         zoneName: currentZone,
         type: 'ENTER'
      });
      console.log(`🌐 [GEOFENCE] ${data.name} entered ${currentZone}`);
    } else if (!currentZone && previousZone) {
      // User left a zone and is back in the open map
      io.to(newRoom).emit('geofence-alert', {
         userName: data.name || 'Unknown Unit',
         zoneName: previousZone,
         type: 'EXIT'
      });
      console.log(`🌐 [GEOFENCE] ${data.name} departed ${previousZone}`);
    }

    // 3. Save new data including their current zone
    users[socket.id] = { ...data, roomCode: newRoom, currentZone };
    
    // 4. Broadcast updated users to the squad
    const roomUsers = {};
    Object.keys(users).forEach(id => {
      if (users[id].roomCode === newRoom) roomUsers[id] = users[id];
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

      // Inside server.js -> socket.on('disconnect')
    if (lastLocation && squad && squad.ownerId !== socket.id) {
      console.log(`🔥 [SUCCESS] Sending Ghost Data to Commander!`); // Add this
      io.to(squad.ownerId).emit('member-signal-lost', {
        targetId: socket.id,
        name: userData.name,
        photo: userData.photo,
        lastKnownLocation: lastLocation,
        disconnectTime: new Date().toISOString()
      });
    } else {
      // Add this to see WHY it's failing
      console.log(`❌ [ABORTED GHOST] HasLocation: ${!!lastLocation}, HasSquad: ${!!squad}, IsOwner: ${squad?.ownerId === socket.id}`); 
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