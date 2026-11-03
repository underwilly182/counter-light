'use strict';

const path = require('node:path');
const express = require('express');
const http = require('node:http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e5,
  pingTimeout: 20000,
  pingInterval: 25000,
  connectTimeout: 10000,
});
const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 20;
const MAX_USERNAME_LENGTH = 20;
const MAX_SIGNALING_ROOM_LENGTH = 64;
const SHOT_COOLDOWN_MS = 150;
const RELOAD_MS = 1280;
const MAX_LP = 8;
const MAX_AM = 6;
const MAX_FRAMES_HURT = 10;
const MAP = { width: 800, height: 400 };
const MAP_DIAGONAL = Math.hypot(MAP.width, MAP.height);
const DEBUG = process.env.NODE_ENV !== 'production';

const obstacles = {
  0: { x: 25, y: 25, w: 25, h: 100 }, 1: { x: 50, y: 25, w: 100, h: 25 },
  2: { x: 290, y: 300, w: 25, h: 100 }, 3: { x: 290, y: 0, w: 25, h: 100 },
  4: { x: 165, y: 25, w: 50, h: 25 }, 5: { x: 550, y: 275, w: 25, h: 100 },
  6: { x: 250, y: 150, w: 100, h: 100 }, 7: { x: 450, y: 350, w: 100, h: 25 },
  8: { x: 25, y: 175, w: 25, h: 100 }, 9: { x: 50, y: 215, w: 75, h: 20 },
  10: { x: 0, y: 0, w: 800, h: 1 }, 11: { x: 0, y: 0, w: 1, h: 400 },
  12: { x: 0, y: 399, w: 800, h: 1 }, 13: { x: 799, y: 0, w: 1, h: 400 },
  14: { x: 134, y: 103, w: 43, h: 66 }, 15: { x: 445, y: 141, w: 20, h: 109 },
  16: { x: 379, y: 46, w: 147, h: 19 }, 17: { x: 557, y: 115, w: 55, h: 57 },
  18: { x: 667, y: 38, w: 22, h: 84 }, 19: { x: 716, y: 142, w: 44, h: 23 },
  20: { x: 577, y: 0, w: 34, h: 51 }, 21: { x: 626, y: 356, w: 28, h: 44 },
  22: { x: 131, y: 347, w: 49, h: 54 }, 23: { x: 686, y: 241, w: 114, h: 13 },
  24: { x: 616, y: 239, w: 59, h: 10 }, 25: { x: 379, y: 291, w: 37, h: 29 },
  26: { x: 505, y: 287, w: 49, h: 4 }, 27: { x: 346, y: 158, w: 39, h: 6 },
  28: { x: 346, y: 237, w: 33, h: 5 },
};

// Serve only the intended client directory. Do not expose project files or editor backups.
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  next();
});
app.use((req, res, next) => {
  if (/\.(?:bak|psd)$/i.test(req.path)) return res.sendStatus(404);
  next();
});
app.use(express.static(path.join(__dirname, '..', 'client'), {
  dotfiles: 'deny',
  index: 'index.html',
  fallthrough: true,
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
}));

const players = Object.create(null);
const waiters = Object.create(null);
let gameInProgress = false;
let launcherId = null;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// Permit ordinary Unicode names while excluding markup and control characters.
function cleanUsername(value) {
  if (typeof value !== 'string') return null;
  const name = value.normalize('NFKC').replace(/[<>"'&`\\/\u0000-\u001f\u007f]/g, '').trim();
  if (!name || name.length > MAX_USERNAME_LENGTH) return null;
  return name;
}

function alivePlayerCount() {
  return Object.values(players).filter((player) => player.alive).length;
}

function sendTeams() {
  io.emit('updateTeams', Object.values(waiters).map(({ username, team }) => ({ username, team })));
}

function checkRemainingTeams() {
  if (!gameInProgress) return;
  const activeTeams = new Set(Object.values(players).filter((player) => player.alive).map((player) => player.team));
  if (activeTeams.size <= 1) endGame(activeTeams.size === 1 ? [...activeTeams][0] : null);
}

function endGame(winningTeam) {
  if (!gameInProgress) return;
  gameInProgress = false;
  io.emit('gameEnded', { players, launcherId, winningTeam });
}

function startGame(socket) {
  if (gameInProgress || socket.id !== launcherId || Object.keys(waiters).length === 0) return;
  for (const id of Object.keys(players)) delete players[id];
  for (const waiter of Object.values(waiters)) {
    players[waiter.id] = {
      id: waiter.id,
      alive: true,
      lifepoints: MAX_LP,
      ammo: MAX_AM,
      size: 20,
      scores: { hit: 0, kill: 0, ff: 0, fk: 0 },
      username: waiter.username,
      team: waiter.team,
      framesHurt: 0,
      movement: { up: false, down: false, left: false, right: false },
      angle: 0,
      lastShotAt: 0,
      lastReloadAt: 0,
    };
    if (waiter.team === 'A') {
      players[waiter.id].x = 2;
      players[waiter.id].y = 2;
    } else {
      players[waiter.id].x = MAP.width - 22;
      players[waiter.id].y = MAP.height - 22;
    }
  }
  gameInProgress = true;
  io.emit('obstacles', obstacles);
  io.emit('players', players);
  io.emit('gameStarted', players);
}

function lineLine(x1, y1, x2, y2, x3, y3, x4, y4) {
  const denominator = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (denominator === 0) return { test: false };
  const uA = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denominator;
  const uB = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denominator;
  if (uA < 0 || uA > 1 || uB < 0 || uB > 1) return { test: false };
  const x = x1 + uA * (x2 - x1);
  const y = y1 + uA * (y2 - y1);
  return { test: true, x, y, dist: Math.hypot(x - x2, y - y2) };
}

function lineRect(x1, y1, x2, y2, rect) {
  const intersections = [
    lineLine(x1, y1, x2, y2, rect.x, rect.y, rect.x, rect.y + rect.h),
    lineLine(x1, y1, x2, y2, rect.x + rect.w, rect.y, rect.x + rect.w, rect.y + rect.h),
    lineLine(x1, y1, x2, y2, rect.x, rect.y, rect.x + rect.w, rect.y),
    lineLine(x1, y1, x2, y2, rect.x, rect.y + rect.h, rect.x + rect.w, rect.y + rect.h),
  ].filter((hit) => hit.test).sort((a, b) => a.dist - b.dist);
  return intersections.length ? { ...intersections[0], intX: intersections[0].x, intY: intersections[0].y } : { test: false };
}

function fireBullet(shooterId, mouseX, mouseY) {
  const shooter = players[shooterId];
  if (!gameInProgress || !shooter || !shooter.alive || !isFiniteNumber(mouseX) || !isFiniteNumber(mouseY) || shooter.ammo <= 0) return;
  const now = Date.now();
  if (now - shooter.lastShotAt < SHOT_COOLDOWN_MS) return;
  if (shooter.ammo === 0 && now - shooter.lastReloadAt >= RELOAD_MS) shooter.ammo = MAX_AM;
  if (shooter.ammo <= 0) return;
  shooter.lastShotAt = now;
  shooter.ammo -= 1;
  if (shooter.ammo === 0) shooter.lastReloadAt = now;

  const px = shooter.x + 10;
  const py = shooter.y + 10;
  const distance = Math.hypot(mouseX - px, mouseY - py);
  if (!Number.isFinite(distance) || distance === 0) return;
  const endX = px + (MAP_DIAGONAL / distance) * (mouseX - px);
  const endY = py + (MAP_DIAGONAL / distance) * (mouseY - py);
  let nearestObstacle = null;
  let nearestPlayer = null;
  for (const obstacle of Object.values(obstacles)) {
    const hit = lineRect(endX, endY, px, py, obstacle);
    if (hit.test && (!nearestObstacle || hit.dist < nearestObstacle.dist)) nearestObstacle = hit;
  }
  for (const [id, target] of Object.entries(players)) {
    if (id === shooterId || !target.alive) continue;
    const hit = lineRect(endX, endY, px, py, { x: target.x, y: target.y, w: target.size, h: target.size });
    if (hit.test && (!nearestPlayer || hit.dist < nearestPlayer.dist)) nearestPlayer = { ...hit, id };
  }
  if (nearestObstacle && (!nearestPlayer || nearestObstacle.dist <= nearestPlayer.dist)) {
    io.emit('obstTouched', { x: nearestObstacle.intX, y: nearestObstacle.intY });
    io.emit('drawShoot', { px, py, hitX: nearestObstacle.intX, hitY: nearestObstacle.intY });
    return;
  }
  if (!nearestPlayer) return;
  const target = players[nearestPlayer.id];
  target.lifepoints -= 1;
  target.framesHurt = MAX_FRAMES_HURT;
  if (target.team === shooter.team) shooter.scores.ff += 1;
  else shooter.scores.hit += 1;
  io.emit('updateHealth', { playerId: target.id, health: target.lifepoints });
  io.emit('drawShoot', { px, py, hitX: nearestPlayer.intX, hitY: nearestPlayer.intY });
  if (target.lifepoints <= 0) {
    target.alive = false;
    if (target.team === shooter.team) shooter.scores.fk += 1;
    else shooter.scores.kill += 1;
    checkRemainingTeams();
  }
}

io.on('connection', (socket) => {
  if (DEBUG) console.log('Client connected');
  socket.join('next-game');
  sendTeams();

  socket.on('playerJoin', (payload) => {
    if (gameInProgress || !isPlainObject(payload)) return;
    const username = cleanUsername(payload.username);
    const team = payload.team;
    if (!username || (team !== 'A' && team !== 'B')) return;
    if (!waiters[socket.id] && Object.keys(waiters).length >= MAX_PLAYERS) return;
    waiters[socket.id] = { id: socket.id, username, team };
    if (Object.keys(waiters).length === 1) {
      launcherId = socket.id;
      socket.emit('enableStartButton');
    }
    sendTeams();
  });

  socket.on('startGame', () => startGame(socket));
  socket.on('start-move', (direction) => {
    const player = players[socket.id];
    if (gameInProgress && player?.alive && ['up', 'down', 'left', 'right'].includes(direction)) player.movement[direction] = true;
  });
  socket.on('stop-move', (direction) => {
    const player = players[socket.id];
    if (player && ['up', 'down', 'left', 'right'].includes(direction)) player.movement[direction] = false;
  });
  socket.on('rotate', (x, y) => {
    const player = players[socket.id];
    if (!gameInProgress || !player?.alive || !isFiniteNumber(x) || !isFiniteNumber(y) || Math.abs(x) > 5000 || Math.abs(y) > 5000) return;
    player.angle = Math.atan2(y - player.y - 10, x - player.x - 10);
  });
  socket.on('shoot', (payload) => {
    if (!isPlainObject(payload)) return;
    fireBullet(socket.id, payload.mouseX, payload.mouseY);
  });
  socket.on('urgentObstacles', () => socket.emit('obstacles', obstacles));
  socket.on('relaunchGame', () => {
    if (socket.id !== launcherId || gameInProgress) return;
    io.emit('relaunchForAll');
  });

  // Bound signaling to an explicit, small room; never relay to arbitrary room names.
  socket.on('join room', (roomId) => {
    if (typeof roomId !== 'string' || roomId.length < 1 || roomId.length > MAX_SIGNALING_ROOM_LENGTH || !/^[\w-]+$/.test(roomId)) return;
    const room = io.sockets.adapter.rooms.get(`signal:${roomId}`);
    if (room && room.size >= 2 && !room.has(socket.id)) return;
    if (socket.data.signalingRoom) socket.leave(socket.data.signalingRoom);
    socket.data.signalingRoom = `signal:${roomId}`;
    socket.join(socket.data.signalingRoom);
  });
  for (const eventName of ['offer', 'answer', 'ice candidate']) {
    socket.on(eventName, (payload) => {
      const room = socket.data.signalingRoom;
      if (!room || !isPlainObject(payload) || Buffer.byteLength(JSON.stringify(payload)) > 16000) return;
      socket.to(room).emit(eventName, payload);
    });
  }

  socket.on('disconnect', () => {
    delete waiters[socket.id];
    const wasPlayer = Boolean(players[socket.id]);
    delete players[socket.id];
    if (launcherId === socket.id) launcherId = Object.keys(waiters)[0] || null;
    sendTeams();
    if (gameInProgress && wasPlayer) checkRemainingTeams();
  });
});

function updatePosition(player) {
  const speed = 1;
  const nextX = player.x + (player.movement.right ? speed : 0) - (player.movement.left ? speed : 0);
  const nextY = player.y + (player.movement.down ? speed : 0) - (player.movement.up ? speed : 0);
  const candidate = { x: nextX, y: nextY, w: player.size, h: player.size };
  if (nextX >= 1 && nextX + player.size < MAP.width - 1 && !Object.values(obstacles).some((o) => candidate.x < o.x + o.w && candidate.x + candidate.w > o.x && candidate.y < o.y + o.h && candidate.y + candidate.h > o.y)) player.x = nextX;
  candidate.x = player.x;
  if (nextY >= 1 && nextY + player.size < MAP.height - 1 && !Object.values(obstacles).some((o) => candidate.x < o.x + o.w && candidate.x + candidate.w > o.x && candidate.y < o.y + o.h && candidate.y + candidate.h > o.y)) player.y = nextY;
}

setInterval(() => {
  if (!gameInProgress) return;
  for (const player of Object.values(players)) {
    if (!player.alive) continue;
    if (player.framesHurt > 0) player.framesHurt -= 1;
    updatePosition(player);
  }
  io.emit('updateAnglesAndPositions', players);
}, 1000 / 60).unref();

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
