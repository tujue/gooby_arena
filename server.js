
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

// Serve static files from dist folder (production build)
if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    console.log(`📁 Serving static files from: ${distPath}`);
}

const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for dev simplicity
        methods: ["GET", "POST"]
    }
});

// Health check endpoints
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), rooms: rooms.size });
});

// API info endpoint
app.get('/api', (req, res) => {
    res.json({
        message: 'Gooby Arena Signalling Server',
        status: 'running',
        rooms: rooms.size,
        endpoints: ['/health', '/api', '/socket.io']
    });
});

// SPA fallback - serve index.html for all other routes (production only)
if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
        // Only serve index.html for non-API routes
        if (!req.path.startsWith('/api') && !req.path.startsWith('/health') && !req.path.startsWith('/socket.io')) {
            res.sendFile(path.join(__dirname, 'dist', 'index.html'));
        } else {
            next();
        }
    });
}

// STATE: Room Management (In-Memory)
const rooms = new Map(); // roomId -> { id, hostId, players: [], maxPlayers, lastActivity: Map }
const playerActivity = new Map(); // socketId -> timestamp

// Auto-cleanup inactive players (30s timeout)
setInterval(() => {
    const now = Date.now();
    const TIMEOUT = 30000; // 30 seconds

    rooms.forEach((room, roomId) => {
        const inactivePlayers = room.players.filter(playerId => {
            const lastSeen = playerActivity.get(playerId) || 0;
            return (now - lastSeen) > TIMEOUT;
        });

        if (inactivePlayers.length > 0) {
            console.log(`[AUTO-CLEANUP] Removing ${inactivePlayers.length} inactive players from room ${roomId}`);
            room.players = room.players.filter(id => !inactivePlayers.includes(id));

            // Notify other players
            io.to(roomId).emit('playerLeft', {
                playerId: inactivePlayers[0],
                reason: 'timeout',
                count: room.players.length
            });

            // Clean up activity tracking
            inactivePlayers.forEach(id => playerActivity.delete(id));
        }

        // Remove empty rooms
        if (room.players.length === 0) {
            console.log(`[AUTO-CLEANUP] Removing empty room ${roomId}`);
            rooms.delete(roomId);
        }
    });
}, 10000); // Check every 10 seconds

// HELPER: Get Public Room List
const getPublicRooms = () => {
    // Clean up empty rooms first
    rooms.forEach((room, id) => {
        if (!room.players || room.players.length === 0) {
            console.log(`[SERVER] Auto-cleanup: Removing empty room ${id}`);
            rooms.delete(id);
        }
    });

    const list = [];
    rooms.forEach((room, id) => {
        list.push({
            id: id,
            players: room.players.length,
            max: room.maxPlayers,
            hasPassword: !!room.password
        });
    });

    // Sort: Most populated first
    list.sort((a, b) => b.players - a.players);

    // Limit: Show max 20 rooms
    return list.slice(0, 20);
};

io.on('connection', (socket) => {
    console.log(`User Connected: ${socket.id}`);

    // Broadcast updated online count to everyone
    const onlineCount = io.engine.clientsCount;
    io.emit('onlineCount', onlineCount);
    console.log(`[SERVER] Online Players: ${onlineCount}`);

    // 1. CREATE ROOM
    socket.on('createRoom', ({ roomId, maxPlayers = 10, password = null }) => {
        console.log(`[SERVER] createRoom request: ${roomId} from ${socket.id}`);

        // If room exists, delete it first (cleanup stale rooms)
        if (rooms.has(roomId)) {
            console.log(`[SERVER] Room ${roomId} already exists. Deleting old room.`);
            rooms.delete(roomId);
        }

        // Create Room Object
        const newRoom = {
            id: roomId,
            hostId: socket.id,
            maxPlayers: maxPlayers,
            password: password,
            players: [socket.id],
            createdAt: Date.now() // Track creation time
        };

        rooms.set(roomId, newRoom);
        socket.join(roomId);

        console.log(`[SERVER] Room Created: ${roomId} by ${socket.id}. Total Rooms: ${rooms.size}`);

        // Ack to Host
        socket.emit('roomCreated', { roomId });

        // Broadcast updated list to everyone (lobby browser)
        io.emit('roomList', getPublicRooms());
    });

    // 2. JOIN ROOM
    socket.on('joinRoom', ({ roomId, password }) => {
        console.log(`[SERVER] joinRoom request: ${roomId} from ${socket.id}`);
        const room = rooms.get(roomId);

        if (!room) {
            socket.emit('error', { message: 'Room not found!' });
            return;
        }

        if (room.players.length >= room.maxPlayers) {
            socket.emit('error', { message: 'Room is full!' });
            return;
        }

        // PASSWORD CHECK
        if (room.password && room.password !== password) {
            socket.emit('error', { message: 'Incorrect Password!' });
            return;
        }

        // Join Logic
        room.players.push(socket.id);
        socket.join(roomId);

        // Track activity
        playerActivity.set(socket.id, Date.now());

        console.log(`[SERVER] User ${socket.id} joined room ${roomId}`);

        // Notify User
        socket.emit('joinedRoom', { roomId, hostId: room.hostId });

        // Notify Room (Player Joined) - Just ID update, no game state
        io.to(roomId).emit('playerJoined', { playerId: socket.id, count: room.players.length });

        // Update Lobby List globally
        io.emit('roomList', getPublicRooms());
    });

    // 3. LEAVE ROOM (Explicit)
    socket.on('leaveRoom', ({ roomId }) => {
        console.log(`[DEBUG] leaveRoom event received. RoomId: ${roomId}, Type: ${typeof roomId}, Socket: ${socket.id}`);
        console.log(`[DEBUG] Current rooms in memory:`, Array.from(rooms.keys()));
        handleLeave(socket, roomId);
    });

    // 4. GET ROOM LIST
    socket.on('getRoomList', () => {
        const list = getPublicRooms();
        console.log(`[SERVER] getRoomList request from ${socket.id}. Sending ${list.length} rooms.`);
        socket.emit('roomList', list);
    });

    // 5. GLOBAL CHAT
    socket.on('globalChat', (msg) => {
        io.emit('globalChat', msg);
    });

    // DISCONNECT
    socket.on('disconnect', () => {
        console.log(`User Disconnected: ${socket.id}`);

        // Find rooms user was in and remove them
        rooms.forEach((room, roomId) => {
            if (room.players.includes(socket.id)) {
                handleLeave(socket, roomId);
            }
        });

        // Broadcast updated online count
        setTimeout(() => {
            const onlineCount = io.engine.clientsCount;
            io.emit('onlineCount', onlineCount);
            console.log(`[SERVER] Online Players: ${onlineCount}`);
        }, 100);
    });
});

// COMMON LEAVE LOGIC
const handleLeave = (socket, roomId) => {
    console.log(`[DEBUG] handleLeave called. RoomId: ${roomId}, Type: ${typeof roomId}`);
    const room = rooms.get(roomId);
    if (!room) {
        console.log(`[DEBUG] Room ${roomId} NOT FOUND in memory. Available rooms:`, Array.from(rooms.keys()));
        return;
    }

    console.log(`[DEBUG] Room ${roomId} found. Host: ${room.hostId}, Players: ${room.players}`);

    // Remove player
    room.players = room.players.filter(id => id !== socket.id);
    socket.leave(roomId);
    console.log(`User ${socket.id} left room ${roomId}`);

    // If Host left, destroy room
    if (socket.id === room.hostId) {
        console.log(`Host left room ${roomId}. Closing room.`);
        io.to(roomId).emit('roomClosed', { reason: 'Host disconnected' });

        // Remove room from memory
        rooms.delete(roomId);

        // Force disconnect logic is handled by clients receiving roomClosed
    } else {
        // Just a player left
        io.to(roomId).emit('playerLeft', { playerId: socket.id, count: room.players.length });
    }

    // Update List
    io.emit('roomList', getPublicRooms());
};

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Gooby Arena Signalling Server running on port ${PORT}`);
    console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
});
