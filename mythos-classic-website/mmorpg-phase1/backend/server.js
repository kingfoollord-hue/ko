require("dotenv").config();

const os = require("os");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const User = require("./models/User");
const { connectDatabase } = require("./config/db");
const { requireAuth, requireOwner, socketTokenMiddleware } = require("./middleware/auth");

const PORT = Number(process.env.PORT || 3000);
const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || "*")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
const JWT_SECRET = process.env.JWT_SECRET || "";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "2h";
const OWNER_EMAIL = (process.env.OWNER_EMAIL || "").trim().toLowerCase();
const OWNER_BOOTSTRAP_SECRET = process.env.OWNER_BOOTSTRAP_SECRET || "";
const BCRYPT_ROUNDS = Math.min(14, Math.max(10, Number(process.env.BCRYPT_ROUNDS || 12)));

if (JWT_SECRET.length < 32) {
  throw new Error("Set JWT_SECRET to a random value of at least 32 characters.");
}
if (!OWNER_EMAIL || OWNER_BOOTSTRAP_SECRET.length < 24) {
  throw new Error("Set OWNER_EMAIL and OWNER_BOOTSTRAP_SECRET (at least 24 characters).");
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: (origin, callback) => callback(null, !origin || FRONTEND_ORIGIN.includes("*") || FRONTEND_ORIGIN.includes(origin)), methods: ["GET", "POST"], credentials: false },
  transports: ["websocket", "polling"]
});

app.disable("x-powered-by");
app.use(cors({
  origin(origin, callback) {
    if (!origin || FRONTEND_ORIGIN.includes("*") || FRONTEND_ORIGIN.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed by CORS."));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "16kb" }));

const loginAttempts = new Map();
function authRateLimit(req, res, next) {
  const key = req.ip || "unknown";
  const now = Date.now();
  const entry = loginAttempts.get(key) || { count: 0, resetAt: now + 60_000 };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + 60_000;
  }
  entry.count += 1;
  loginAttempts.set(key, entry);
  if (entry.count > 30) return res.status(429).json({ error: "Too many authentication requests. Try again in a minute." });
  return next();
}
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of loginAttempts) if (now > entry.resetAt) loginAttempts.delete(key);
}, 60_000).unref();

function issueToken(user) {
  return jwt.sign(
    { role: user.role, username: user.username },
    JWT_SECRET,
    { subject: String(user._id), expiresIn: JWT_EXPIRES_IN, issuer: "mmorpg-api", algorithm: "HS256" }
  );
}

app.get("/api/health", (_req, res) => res.json({ status: "ok", uptimeSeconds: Math.floor(process.uptime()) }));

app.post("/api/auth/register", authRateLimit, async (req, res, next) => {
  try {
    const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const ownerSecret = typeof req.body.ownerBootstrapSecret === "string" ? req.body.ownerBootstrapSecret : "";

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      return res.status(400).json({ error: "Username must be 3–24 letters, numbers, or underscores." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    if (password.length < 12 || password.length > 128) {
      return res.status(400).json({ error: "Password must be between 12 and 128 characters." });
    }

    const existing = await User.findOne({ $or: [{ email }, { username }] }).select("_id");
    if (existing) return res.status(409).json({ error: "Username or email is already registered." });

    const claimsOwner = email === OWNER_EMAIL;
    if (claimsOwner && (!ownerSecret || !crypto.timingSafeEqual(
      Buffer.from(ownerSecret.padEnd(OWNER_BOOTSTRAP_SECRET.length, "\0").slice(0, OWNER_BOOTSTRAP_SECRET.length)),
      Buffer.from(OWNER_BOOTSTRAP_SECRET)
    ))) {
      return res.status(403).json({ error: "Owner enrollment requires the correct bootstrap secret." });
    }
    if (!claimsOwner && ownerSecret) {
      return res.status(400).json({ error: "Owner bootstrap secret is only accepted for the configured owner email." });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await User.create({
      username,
      email,
      passwordHash,
      role: claimsOwner ? "owner" : "player"
    });
    const token = issueToken(user);
    return res.status(201).json({
      token,
      user: { id: String(user._id), username: user.username, email: user.email, role: user.role }
    });
  } catch (error) {
    if (error && error.code === 11000) return res.status(409).json({ error: "Username or email is already registered." });
    return next(error);
  }
});

app.post("/api/auth/login", authRateLimit, async (req, res, next) => {
  try {
    const identity = typeof req.body.identity === "string" ? req.body.identity.trim() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (!identity || !password || identity.length > 254 || password.length > 128) {
      return res.status(400).json({ error: "Enter your username/email and password." });
    }
    const user = await User.findOne({
      $or: [{ email: identity.toLowerCase() }, { username: identity }]
    }).select("+passwordHash _id username email role banned");
    const valid = user && await bcrypt.compare(password, user.passwordHash);
    if (!valid || user.banned) return res.status(401).json({ error: "Invalid credentials." });

    return res.json({
      token: issueToken(user),
      user: { id: String(user._id), username: user.username, email: user.email, role: user.role }
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: req.user }));

app.get("/api/character", requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select("character");
    if (!user) return res.status(404).json({ error: "Character not found." });
    return res.json({ character: user.character });
  } catch (error) { return next(error); }
});

app.put("/api/character", requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    const number = (key, fallback, min, max) => {
      const value = Number(body[key]);
      return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
    };
    const inventory = Array.isArray(body.inventory) ? body.inventory.slice(0, 24).map((item) => ({
      name: String(item?.name || "Item").slice(0, 40), icon: String(item?.icon || "•").slice(0, 8), count: Math.round(numberFrom(item?.count, 1, 1, 999))
    })) : [];
    function numberFrom(value, fallback, min, max) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
    const character = {
      x: number("x", 45, 2, 88), y: number("y", 45, 2, 88),
      hp: number("hp", 30, 0, 100), maxHp: number("maxHp", 30, 1, 100),
      coins: Math.round(number("coins", 25, 0, 10000000)), xp: Math.round(number("xp", 0, 0, 1000000000)),
      level: Math.round(number("level", 1, 1, 99)), questDone: body.questDone === true, inventory
    };
    character.hp = Math.min(character.hp, character.maxHp);
    await User.findByIdAndUpdate(req.user.id, { $set: { character } }, { runValidators: true });
    return res.json({ ok: true, character });
  } catch (error) { return next(error); }
});


const admin = io.of("/admin");
const game = io.of("/game");
const activePlayers = new Map();
const mutedUsers = new Set();
const bannedSocketUsers = new Set();
const worldState = { event: null, lastAlert: null, entities: [] };

admin.use(socketTokenMiddleware("owner"));
game.use(socketTokenMiddleware());

function emitPlayerRoster() {
  const players = [...activePlayers.values()].map((entry) => ({
    socketId: entry.socketId,
    userId: entry.userId,
    username: entry.username,
    connectedAt: entry.connectedAt,
    position: entry.position
  }));
  admin.emit("admin:players", players);
}

function disconnectUserSockets(userId, reason) {
  for (const namespace of [game, admin]) {
    for (const socket of namespace.sockets.values()) {
      if (socket.user && socket.user.id === userId) socket.disconnect(true);
    }
  }
  admin.emit("admin:actionResult", { ok: true, message: reason });
}

admin.on("connection", (socket) => {
  socket.emit("admin:worldState", worldState);
  emitPlayerRoster();

  socket.on("admin:action", async (payload = {}, ack = () => {}) => {
    try {
      const action = String(payload.action || "");
      const targetSocketId = String(payload.targetSocketId || "");
      if (["kick", "ban", "mute"].includes(action)) {
        const target = activePlayers.get(targetSocketId);
        if (!target) return ack({ ok: false, message: "That player is no longer connected." });
        if (target.userId === socket.user.id) return ack({ ok: false, message: "You cannot moderate your own owner session." });
        if (action === "mute") {
          mutedUsers.add(target.userId);
          game.to(targetSocketId).emit("game:moderation", { action: "mute", message: "Chat has been muted by an owner." });
          admin.emit("admin:actionResult", { ok: true, message: `${target.username} muted.` });
          return ack({ ok: true, message: `${target.username} muted.` });
        }
        if (action === "ban") {
          bannedSocketUsers.add(target.userId);
          await User.findByIdAndUpdate(target.userId, { banned: true });
          disconnectUserSockets(target.userId, `${target.username} banned and disconnected.`);
          return ack({ ok: true, message: `${target.username} banned.` });
        }
        disconnectUserSockets(target.userId, `${target.username} kicked.`);
        return ack({ ok: true, message: `${target.username} kicked.` });
      }

      if (action === "alert") {
        const message = String(payload.message || "").trim().slice(0, 240);
        if (!message) return ack({ ok: false, message: "Enter an alert message." });
        worldState.lastAlert = { message, at: new Date().toISOString(), by: socket.user.username };
        game.emit("world:alert", worldState.lastAlert);
        admin.emit("admin:worldState", worldState);
        return ack({ ok: true, message: "Alert broadcast to connected players." });
      }
      if (action === "event") {
        const eventName = String(payload.eventName || "World event").trim().slice(0, 80) || "World event";
        worldState.event = { name: eventName, startedAt: new Date().toISOString(), by: socket.user.username };
        game.emit("world:event", worldState.event);
        admin.emit("admin:worldState", worldState);
        return ack({ ok: true, message: `World event "${eventName}" triggered.` });
      }
      if (action === "spawn") {
        const kind = String(payload.kind || "training_dummy");
        if (!["training_dummy", "treasure_chest", "healing_orb"].includes(kind)) {
          return ack({ ok: false, message: "Unsupported entity type." });
        }
        const entity = {
          id: crypto.randomUUID(),
          kind,
          x: 48,
          y: 0,
          z: 45,
          spawnedAt: new Date().toISOString()
        };
        worldState.entities.push(entity);
        worldState.entities = worldState.entities.slice(-100);
        game.emit("world:entitySpawned", entity);
        admin.emit("admin:worldState", worldState);
        return ack({ ok: true, message: `${kind} spawned for connected players.` });
      }
      return ack({ ok: false, message: "Unknown admin action." });
    } catch (error) {
      console.error("Admin action failed:", error.message);
      return ack({ ok: false, message: "Admin action failed." });
    }
  });
});

game.on("connection", (socket) => {
  const player = {
    socketId: socket.id,
    userId: socket.user.id,
    username: socket.user.username,
    connectedAt: new Date().toISOString(),
    position: { x: 45, y: 0, z: 45 }
  };
  activePlayers.set(socket.id, player);
  socket.emit("game:welcome", {
    socketId: socket.id,
    username: socket.user.username,
    position: player.position,
    players: [...activePlayers.values()].filter((entry) => entry.socketId !== socket.id).map((entry) => ({ socketId: entry.socketId, username: entry.username, position: entry.position })),
    worldState
  });
  socket.broadcast.emit("game:playerJoined", player);
  emitPlayerRoster();

  let lastPositionUpdate = 0;
  let lastChatAt = 0;
  socket.on("chat:send", (payload = {}, ack = () => {}) => {
    const now = Date.now();
    if (mutedUsers.has(socket.user.id)) return ack({ ok: false, message: "You are muted and cannot chat." });
    if (now - lastChatAt < 700) return ack({ ok: false, message: "Please wait a moment before sending another message." });
    const text = typeof payload.text === "string" ? payload.text.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 240) : "";
    if (!text) return ack({ ok: false, message: "Enter a message first." });
    lastChatAt = now;
    const message = { username: socket.user.username, text, at: now };
    game.emit("chat:message", message);
    return ack({ ok: true });
  });

  socket.on("game:position", (position, ack = () => {}) => {
    const now = Date.now();
    if (now - lastPositionUpdate < 40) return ack({ ok: false, reason: "rate_limited" });
    lastPositionUpdate = now;
    if (!position || !["x", "y", "z"].every((key) => Number.isFinite(position[key]))) {
      return ack({ ok: false, reason: "invalid_position" });
    }
    const { x, y, z } = position;
    if (Math.abs(x) > 10000 || Math.abs(z) > 10000 || y < -100 || y > 1000) {
      return ack({ ok: false, reason: "out_of_bounds" });
    }
    // Keep browser movement inside the generated world and throttle update frequency.
    if (x < 1 || x > 89 || z < 1 || z > 89) return ack({ ok: false, reason: "out_of_bounds" });
    player.position = { x, y, z };
    socket.broadcast.emit("game:playerMoved", {
      socketId: socket.id,
      username: player.username,
      position: player.position
    });
    ack({ ok: true, position: player.position });
  });

  socket.on("disconnect", () => {
    activePlayers.delete(socket.id);
    socket.broadcast.emit("game:playerLeft", { socketId: socket.id });
    emitPlayerRoster();
  });
});

let previousCpu = os.cpus().map((cpu) => ({ ...cpu.times }));
function cpuSnapshot() {
  const current = os.cpus().map((cpu) => cpu.times);
  let idleDelta = 0;
  let totalDelta = 0;
  for (let i = 0; i < current.length; i += 1) {
    const before = previousCpu[i] || current[i];
    const totalBefore = Object.values(before).reduce((sum, value) => sum + value, 0);
    const totalNow = Object.values(current[i]).reduce((sum, value) => sum + value, 0);
    idleDelta += current[i].idle - before.idle;
    totalDelta += totalNow - totalBefore;
  }
  previousCpu = current.map((times) => ({ ...times }));
  return totalDelta > 0 ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) : 0;
}
setInterval(() => {
  const memory = process.memoryUsage();
  const metrics = {
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    processMemory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal
    },
    system: {
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
      cpuUsagePercent: Number(cpuSnapshot().toFixed(1)),
      cpuCores: os.cpus().length,
      loadAverage: os.loadavg()
    },
    connectedSockets: io.engine.clientsCount,
    activePlayers: activePlayers.size
  };
  admin.emit("admin:metrics", metrics);
}, 2000).unref();

// In production, serve the browser game from this same service. Players only
// need a browser; Node.js is required only on the hosted server, never on their PC.
const path = require("path");
const frontendDist = path.join(__dirname, "..", "frontend", "dist");
if (require("fs").existsSync(frontendDist)) {
  app.use(express.static(frontendDist, { index: false, maxAge: "1h" }));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/socket.io/")) return next();
    return res.sendFile(path.join(frontendDist, "index.html"));
  });
}

app.use((error, _req, res, _next) => {
  if (error.message === "Origin not allowed by CORS.") {
    return res.status(403).json({ error: "Origin not allowed." });
  }
  console.error("Request failed:", error.message);
  return res.status(500).json({ error: "Internal server error." });
});

async function start() {
  await connectDatabase();
  server.listen(PORT, () => console.log(`MMORPG API and Socket.io listening on http://localhost:${PORT}`));
}
start().catch((error) => {
  console.error("Startup failed:", error);
  process.exit(1);
});

process.on("unhandledRejection", (error) => console.error("Unhandled rejection:", error));
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});