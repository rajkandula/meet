import crypto from "node:crypto";
import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import fs from "node:fs";
import path from "node:path";

try {
  const envPath = path.resolve(".env.local");
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, "utf8");
    for (const line of envFile.split("\n")) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
      }
    }
  }
} catch {}

// REALTIME_PORT for local development (next to the app); PORT when a host runs
// the signaling server as its own service and assigns the port.
const port = Number(process.env.REALTIME_PORT || process.env.PORT || 3005);
const secret = process.env.REALTIME_SECRET || "local-development-realtime-secret";
const rooms = new Map();
const clients = new Map();

// Same JSON-line shape as lib/logger.ts, so app and signaling logs read as one stream.
function log(level, message, context = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, scope: "realtime", message, ...context });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

// A room that empties out is given a grace period to be rejoined before the meeting is closed.
const autoEndMs = Number(process.env.AUTO_END_MINUTES || 5) * 60 * 1000;
const appUrl = (process.env.APP_URL || "http://localhost:3001").replace(/\/$/, "");
const endTimers = new Map();

function cancelAutoEnd(roomId) {
  const timer = endTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    endTimers.delete(roomId);
  }
}

function scheduleAutoEnd(roomId) {
  cancelAutoEnd(roomId);
  const timer = setTimeout(async () => {
    endTimers.delete(roomId);
    if (rooms.get(roomId)?.size) return; // somebody came back
    try {
      const response = await fetch(`${appUrl}/api/meetings/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-realtime-secret": secret },
        body: JSON.stringify({ meetingId: roomId, reason: "empty" }),
      });
      if (response.ok) log("info", "auto-ended empty room", { roomId });
      else log("warn", "app rejected the auto-end request", { roomId, status: response.status });
    } catch (error) {
      log("warn", "could not auto-end room", { roomId, error: error.message });
    }
  }, autoEndMs);
  timer.unref?.();
  endTimers.set(roomId, timer);
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
    // Compare on byte-length Buffers, not string length: an attacker-supplied
    // signature of equal character length but different byte length would make
    // timingSafeEqual throw, and an uncaught throw here would crash the whole
    // signaling process and drop every live call. Fail closed instead.
    const signatureBytes = Buffer.from(signature, "utf8");
    const expectedBytes = Buffer.from(expected, "utf8");
    if (signatureBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(signatureBytes, expectedBytes)) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!claims.roomId || !claims.userId || !claims.name || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function broadcast(roomId, message, exceptId) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const [id, client] of room) if (id !== exceptId) send(client.ws, message);
}

function removeClient(client) {
  if (!client || !client.joined) return;
  const room = rooms.get(client.claims.roomId);
  room?.delete(client.id);
  log("info", "peer left room", { roomId: client.claims.roomId, peerId: client.id, userId: client.claims.userId, remaining: room?.size ?? 0 });
  if (room?.size === 0) {
    rooms.delete(client.claims.roomId);
    scheduleAutoEnd(client.claims.roomId);
    log("info", "room emptied — auto-end scheduled", { roomId: client.claims.roomId, inMs: autoEndMs });
  } else {
    broadcast(client.claims.roomId, { type: "peer-left", peerId: client.id });
  }
  client.joined = false;
}

/** Constant-time check of the shared secret the app sends with server-to-server calls. */
function hasRealtimeSecret(request) {
  const provided = Buffer.from(String(request.headers["x-realtime-secret"] || ""), "utf8");
  const expected = Buffer.from(secret, "utf8");
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

// Plain HTTP alongside the socket so the app can ask which rooms are live right now.
// Room ids are the invite links, so the list is only given to the app itself.
const httpServer = http.createServer((request, response) => {
  if (request.method === "GET" && (request.url || "").startsWith("/rooms")) {
    if (!hasRealtimeSecret(request)) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    const live = {};
    for (const [roomId, room] of rooms) if (room.size > 0) live[roomId] = room.size;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ rooms: live }));
    return;
  }
  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: "Not found" }));
});

const server = new WebSocketServer({ server: httpServer });
server.on("connection", (ws, request) => {
  const query = new URL(request.url || "/", `ws://${request.headers.host || "localhost"}`).searchParams;
  const claims = verifyToken(query.get("token"));
  if (!claims) {
    log("warn", "connection rejected: invalid or expired token");
    ws.close(1008, "Invalid or expired realtime token");
    return;
  }

  const client = { id: crypto.randomUUID(), ws, claims, joined: false };
  clients.set(client.id, client);

  ws.on("message", (raw) => {
    // Signaling payloads (SDP offers, ICE candidates) are a few KB at most;
    // anything bigger is not a legitimate message and is not worth relaying.
    if (raw.length > 64 * 1024) return;
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }

    if (message.type === "join") {
      if (client.joined) return;
      cancelAutoEnd(claims.roomId);
      const room = rooms.get(claims.roomId) || new Map();
      const participants = [...room.values()].map((other) => ({ peerId: other.id, userId: other.claims.userId, name: other.claims.name }));
      room.set(client.id, client);
      rooms.set(claims.roomId, room);
      client.joined = true;
      log("info", "peer joined room", { roomId: claims.roomId, peerId: client.id, userId: claims.userId, participants: room.size });
      send(ws, { type: "room-state", selfId: client.id, participants });
      broadcast(claims.roomId, { type: "peer-joined", peerId: client.id, userId: claims.userId, name: claims.name }, client.id);
      return;
    }

    if (!client.joined) return;
    if (["offer", "answer", "ice-candidate"].includes(message.type)) {
      const target = clients.get(message.to);
      if (target && target.claims.roomId === claims.roomId) send(target.ws, { type: message.type, from: client.id, payload: message.payload });
      return;
    }
    if (message.type === "chat" && typeof message.text === "string" && message.text.trim()) {
      const payload = { type: "chat", messageId: crypto.randomUUID(), from: client.id, name: claims.name, text: message.text.trim().slice(0, 1000), sentAt: new Date().toISOString() };
      if (message.to) {
        const target = clients.get(message.to);
        if (!target || target.claims.roomId !== claims.roomId) return;
        const direct = { ...payload, to: message.to, isPrivate: true };
        send(target.ws, direct);
        send(ws, direct);
        return;
      }
      broadcast(claims.roomId, payload);
    }
    if (message.type === "screen-share") {
      broadcast(claims.roomId, { type: "screen-share", from: client.id, active: Boolean(message.active) }, client.id);
    }
    if (message.type === "av-state") {
      broadcast(claims.roomId, { type: "av-state", from: client.id, camera: Boolean(message.camera), mic: Boolean(message.mic) }, client.id);
    }
    // A room member re-keyed the room: everyone else's media is now undecodable
    // and they must rejoin with the new link.
    if (message.type === "encrypted-restart") {
      broadcast(claims.roomId, { type: "encrypted-restart", from: client.id }, client.id);
    }
    // SFU announcement: which SFU session and track names are this
    // peer's, so everyone else can pull their media. Shapes are re-built here
    // so a client can never smuggle arbitrary fields to the room.
    if (message.type === "sfu-state" && typeof message.sessionId === "string" && Array.isArray(message.tracks)) {
      const tracks = message.tracks.slice(0, 8).map((track) => ({
        trackName: String(track?.trackName || "").slice(0, 64),
        kind: track?.kind === "video" ? "video" : "audio",
      })).filter((track) => track.trackName);
      broadcast(claims.roomId, { type: "sfu-state", from: client.id, sessionId: message.sessionId.slice(0, 64), tracks }, client.id);
    }
    if (message.type === "leave") removeClient(client);
  });

  ws.on("close", () => { removeClient(client); clients.delete(client.id); });
  ws.on("error", (error) => {
    log("warn", "websocket error", { roomId: claims.roomId, peerId: client.id, error: error.message });
    removeClient(client);
    clients.delete(client.id);
  });
});

// Last-resort guard: one bad connection must never take down every live room.
process.on("uncaughtException", (error) => log("error", "uncaught exception", { error: error.message }));
process.on("unhandledRejection", (reason) => log("error", "unhandled rejection", { error: String(reason) }));

if (!process.env.REALTIME_SECRET) log("warn", "REALTIME_SECRET is not set — using the development secret; set it (same value as the app) in production");
httpServer.listen(port, "0.0.0.0", () => log("info", "realtime signaling server listening", { url: `ws://0.0.0.0:${port}` }));
