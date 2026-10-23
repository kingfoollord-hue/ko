const jwt = require("jsonwebtoken");
const User = require("../models/User");

function verifyToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be configured with at least 32 characters.");
  }
  return jwt.verify(token, secret, { algorithms: ["HS256"], issuer: "mmorpg-api" });
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({ error: "Authentication required." });
    }
    const payload = verifyToken(token);
    const user = await User.findById(payload.sub).select("_id username email role banned");
    if (!user || user.banned || user.role !== payload.role) {
      return res.status(401).json({ error: "Session is invalid or revoked." });
    }
    req.user = { id: String(user._id), username: user.username, email: user.email, role: user.role };
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired session." });
  }
}

function requireOwner(req, res, next) {
  if (!req.user || req.user.role !== "owner") {
    return res.status(403).json({ error: "Owner access required." });
  }
  return next();
}

function socketTokenMiddleware(requiredRole) {
  return async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error("Authentication required."));
      const payload = verifyToken(token);
      const user = await User.findById(payload.sub).select("_id username email role banned");
      if (!user || user.banned || user.role !== payload.role) {
        return next(new Error("Session is invalid or revoked."));
      }
      if (requiredRole && user.role !== requiredRole) {
        return next(new Error("Forbidden."));
      }
      socket.user = {
        id: String(user._id),
        username: user.username,
        email: user.email,
        role: user.role
      };
      return next();
    } catch (error) {
      return next(new Error("Invalid or expired session."));
    }
  };
}

module.exports = { requireAuth, requireOwner, socketTokenMiddleware, verifyToken };