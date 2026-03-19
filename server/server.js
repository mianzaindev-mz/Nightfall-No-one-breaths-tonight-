// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — WebSocket Relay Server
// Handles room management, message relay, and disconnection.
// No game logic lives here — the host client manages game state.
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // Bind to all interfaces for cloud hosting
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 }); // 64KB max message

// ── Security Headers ─────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Allow CORS for deployments behind CDN or separate domains
  const origin = process.env.CORS_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  next();
});

// Trust proxy for platforms like Railway, Render, Heroku
app.set('trust proxy', 1);

// Serve static frontend
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: '1h',
  etag: true,
}));

// Health check endpoint for monitoring / load balancers
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    rooms: rooms.size,
    connections: wss.clients.size,
  });
});

// ── Room Management ──────────────────────────────────────────
const rooms = new Map(); // code -> { players: Map<id, {ws, name, disconnectedAt}>, hostId, createdAt }
const RECONNECT_GRACE_MS = 15000;
const CODE_LENGTH = 6;
const MAX_ROOMS = 100;
const MAX_PLAYERS_PER_ROOM = 16;
const MAX_NAME_LENGTH = 20;
const RATE_LIMIT_WINDOW = 1000; // 1 second
const RATE_LIMIT_MAX = 30;      // max 30 messages per second

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? genCode() : code;
}

// Sanitize name: strip HTML, limit length, enforce non-empty
function sanitizeName(name) {
  if (typeof name !== 'string') return null;
  const cleaned = name.replace(/<[^>]*>/g, '').replace(/[^\w\s\-_.!@#$%^&*()+={}\[\]:;"'<>,?\/~`|\\]/g, '').trim().slice(0, MAX_NAME_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}

// Validate playerId format
function isValidPlayerId(id) {
  return typeof id === 'string' && /^P[a-z0-9]{5,10}$/.test(id);
}

function broadcast(room, msg, excludeId = null) {
  const data = JSON.stringify(msg);
  for (const [id, player] of room.players) {
    if (id !== excludeId && player.ws && player.ws.readyState === 1) {
      try { player.ws.send(data); } catch (e) { /* ignore */ }
    }
  }
}

function sendTo(ws, msg) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(msg)); } catch (e) { /* ignore */ }
  }
}

function cleanupRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  const allDisconnected = [...room.players.values()].every(p => !p.ws || p.ws.readyState !== 1);
  if (allDisconnected) {
    rooms.delete(code);
    console.log(`[Room ${code}] Cleaned up (all disconnected)`);
  }
}

// ── WebSocket Connection ─────────────────────────────────────
wss.on('connection', (ws, req) => {
  let playerId = null;
  let roomCode = null;

  // Rate limiting per connection
  let msgCount = 0;
  let lastReset = Date.now();

  ws.on('message', (raw) => {
    // Rate limiting
    const now = Date.now();
    if (now - lastReset > RATE_LIMIT_WINDOW) {
      msgCount = 0;
      lastReset = now;
    }
    msgCount++;
    if (msgCount > RATE_LIMIT_MAX) {
      sendTo(ws, { t: 'RATE_LIMITED', reason: 'Too many messages, slow down' });
      return;
    }

    // Size check (defense in depth — maxPayload already handles this)
    if (raw.length > 65536) return;

    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    // Basic type validation
    if (!msg || typeof msg.t !== 'string') return;

    switch (msg.t) {
      // ── Create Room ──
      case 'CREATE': {
        if (rooms.size >= MAX_ROOMS) { sendTo(ws, { t: 'JOIN_FAIL', reason: 'Server is full, try again later' }); return; }
        const name = sanitizeName(msg.name);
        if (!name) { sendTo(ws, { t: 'JOIN_FAIL', reason: 'Invalid name' }); return; }
        if (!isValidPlayerId(msg.playerId)) { sendTo(ws, { t: 'JOIN_FAIL', reason: 'Invalid player ID' }); return; }

        const code = genCode();
        playerId = msg.playerId;
        roomCode = code;
        const room = { players: new Map(), hostId: playerId, createdAt: Date.now() };
        room.players.set(playerId, { ws, name, disconnectedAt: null });
        rooms.set(code, room);
        sendTo(ws, { t: 'CREATED', code, playerId });
        console.log(`[Room ${code}] Created by ${name} (${playerId})`);
        break;
      }

      // ── Join Room ──
      case 'JOIN': {
        const code = typeof msg.code === 'string' ? msg.code.toUpperCase().slice(0, 10) : '';
        const room = rooms.get(code);
        if (!room) { sendTo(ws, { t: 'JOIN_FAIL', reason: 'Room not found' }); return; }
        if (room.players.size >= MAX_PLAYERS_PER_ROOM) { sendTo(ws, { t: 'JOIN_FAIL', reason: 'Room is full' }); return; }

        const name = sanitizeName(msg.name);
        if (!name) { sendTo(ws, { t: 'JOIN_FAIL', reason: 'Invalid name (1-20 chars, no HTML)' }); return; }
        if (!isValidPlayerId(msg.playerId)) { sendTo(ws, { t: 'JOIN_FAIL', reason: 'Invalid player ID' }); return; }

        // Check for reconnection
        const existing = room.players.get(msg.playerId);
        if (existing && existing.disconnectedAt) {
          // Reconnecting
          existing.ws = ws;
          existing.disconnectedAt = null;
          playerId = msg.playerId;
          roomCode = code;
          sendTo(ws, { t: 'RECONNECTED', code, playerId, hostId: room.hostId });
          broadcast(room, { t: 'PLAYER_RECONNECTED', playerId, name: existing.name });
          console.log(`[Room ${code}] ${existing.name} reconnected`);
          return;
        }

        // Check name collision
        for (const [, p] of room.players) {
          if (p.name.toLowerCase() === name.toLowerCase()) { sendTo(ws, { t: 'JOIN_FAIL', reason: 'Name already taken' }); return; }
        }

        playerId = msg.playerId;
        roomCode = code;
        room.players.set(playerId, { ws, name, disconnectedAt: null });
        sendTo(ws, { t: 'JOINED', code, playerId, hostId: room.hostId });
        broadcast(room, { t: 'PLAYER_JOINED', playerId, name }, playerId);
        console.log(`[Room ${code}] ${name} joined (${room.players.size} players)`);
        break;
      }

      // ── Relay — forward to all others in room ──
      case 'RELAY': {
        if (!roomCode) return;
        const room = rooms.get(roomCode);
        if (!room) return;
        if (!msg.data || typeof msg.data !== 'object') return; // Validate relay payload
        const relayMsg = { ...msg.data, _from: playerId };
        if (msg.to) {
          // Targeted relay to specific player — validate target exists
          if (!isValidPlayerId(msg.to)) return;
          const target = room.players.get(msg.to);
          if (target && target.ws) sendTo(target.ws, relayMsg);
        } else {
          // Broadcast to all others
          broadcast(room, relayMsg, playerId);
        }
        break;
      }

      // ── Get room player list ──
      case 'GET_PLAYERS': {
        if (!roomCode) return;
        const room = rooms.get(roomCode);
        if (!room) return;
        const list = [];
        for (const [id, p] of room.players) {
          list.push({ id, name: p.name, connected: !p.disconnectedAt });
        }
        sendTo(ws, { t: 'PLAYER_LIST', players: list, hostId: room.hostId });
        break;
      }

      // ── Leave ──
      case 'LEAVE': {
        handleDisconnect();
        break;
      }
    }
  });

  ws.on('close', handleDisconnect);
  ws.on('error', () => handleDisconnect());

  function handleDisconnect() {
    if (!roomCode || !playerId) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = room.players.get(playerId);
    if (!player) return;

    player.disconnectedAt = Date.now();
    player.ws = null;
    broadcast(room, { t: 'PLAYER_DISCONNECTED', playerId, name: player.name });
    console.log(`[Room ${roomCode}] ${player.name} disconnected (grace period ${RECONNECT_GRACE_MS / 1000}s)`);

    // Host migration if host disconnected
    if (playerId === room.hostId) {
      setTimeout(() => {
        const p = room.players.get(playerId);
        if (p && p.disconnectedAt) {
          // Host didn't reconnect — pick a new host
          for (const [id, pl] of room.players) {
            if (!pl.disconnectedAt && pl.ws && pl.ws.readyState === 1) {
              room.hostId = id;
              broadcast(room, { t: 'HOST_CHANGED', newHostId: id, name: pl.name });
              console.log(`[Room ${roomCode}] Host migrated to ${pl.name}`);
              break;
            }
          }
        }
      }, RECONNECT_GRACE_MS);
    }

    // Cleanup after grace period
    setTimeout(() => {
      const p = room.players.get(playerId);
      if (p && p.disconnectedAt) {
        room.players.delete(playerId);
        broadcast(room, { t: 'PLAYER_LEFT', playerId, name: player.name });
        cleanupRoom(roomCode);
      }
    }, RECONNECT_GRACE_MS);

    // Reset local state so duplicate disconnects don't fire
    const savedRoom = roomCode;
    const savedId = playerId;
    roomCode = null;
    playerId = null;
  }
});

// ── Periodic Stale Room Cleanup ──────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    // Rooms older than 6 hours with no active players
    if (now - room.createdAt > 6 * 60 * 60 * 1000) {
      const hasActive = [...room.players.values()].some(p => p.ws && p.ws.readyState === 1);
      if (!hasActive) {
        rooms.delete(code);
        console.log(`[Room ${code}] Cleaned up (stale, >6h)`);
      }
    }
  }
}, 60000); // Every minute

// ── Graceful Shutdown ────────────────────────────────────────
function handleShutdown(signal) {
  console.log(`\n  Received ${signal}. Shutting down gracefully...`);
  // Close all WebSocket connections
  wss.clients.forEach(client => {
    try { client.close(1001, 'Server shutting down'); } catch {}
  });
  server.close(() => {
    console.log('  Server closed.');
    process.exit(0);
  });
  // Force exit if graceful shutdown takes too long
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

// ── Start ────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log(`\n  🗡  NIGHTFALL Server running on http://${HOST}:${PORT}`);
  console.log(`  📡 WebSocket relay active (max ${MAX_PLAYERS_PER_ROOM} players/room, ${MAX_ROOMS} rooms)`);
  console.log(`  🔒 Rate limit: ${RATE_LIMIT_MAX} msgs/sec per connection`);
  console.log(`  📦 Max message size: 64KB\n`);
});
