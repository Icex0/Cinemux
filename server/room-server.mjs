import { WebSocketServer } from "ws";
import { randomUUID } from "crypto";

const PORT = Number(process.env.ROOM_PORT) || 3001;
// Comma-separated list of allowed Origin headers, e.g.
// "http://localhost:3000,https://cinemux.example.com"
// Set to "*" (or leave unset) to allow any origin — useful for ngrok dev.
const ALLOWED_ORIGINS = (process.env.ROOM_ALLOWED_ORIGINS || "*")
  .split(",").map((s) => s.trim()).filter(Boolean);

// Per-connection sliding-window rate limit.
const RATE_WINDOW_MS = 5_000;
const RATE_MAX = 30; // messages per window

const wss = new WebSocketServer({
  port: PORT,
  // Drop oversize frames. Our largest legitimate message is a chat (~600 bytes JSON).
  maxPayload: 8 * 1024,
  verifyClient: ({ origin }, cb) => {
    if (ALLOWED_ORIGINS.includes("*") || (origin && ALLOWED_ORIGINS.includes(origin))) {
      cb(true);
    } else {
      console.warn(`[room] rejected connection from origin: ${origin}`);
      cb(false, 403, "Forbidden origin");
    }
  },
});

// roomId -> {
//   hostId,
//   mediaUrl,
//   state: { time, paused, ts },
//   members: Map<memberId, { ws, name }>,
//   chat: ChatMsg[],
//   createdAt
// }
const rooms = new Map();

const send = (ws, msg) => {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
};

const broadcast = (room, msg, exceptId) => {
  for (const [id, m] of room.members) {
    if (id === exceptId) continue;
    send(m.ws, msg);
  }
};

const memberList = (room) =>
  Array.from(room.members.entries()).map(([id, m]) => ({
    id, name: m.name, isHost: id === room.hostId,
  }));

// Periodic cleanup of empty rooms (defensive — they're already deleted on last leave).
setInterval(() => {
  for (const [id, room] of rooms) {
    if (room.members.size === 0) rooms.delete(id);
  }
}, 60_000);

wss.on("connection", (ws) => {
  const memberId = randomUUID();
  let roomId = null;
  const rateBucket = []; // timestamps of recent messages (sliding window)

  ws.on("message", (raw) => {
    const now = Date.now();
    while (rateBucket.length && rateBucket[0] < now - RATE_WINDOW_MS) rateBucket.shift();
    if (rateBucket.length >= RATE_MAX) {
      // Too chatty — drop the message. If they keep flooding, close the connection.
      if (rateBucket.length >= RATE_MAX * 2) {
        try { ws.close(1008, "rate limited"); } catch { /* ignore */ }
      }
      return;
    }
    rateBucket.push(now);

    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "join") {
      const code = String(msg.room || "").slice(0, 24).replace(/[^a-zA-Z0-9-]/g, "");
      if (!code) return;
      roomId = code;

      let room = rooms.get(roomId);
      if (!room) {
        room = {
          hostId: memberId,
          mediaUrl: String(msg.mediaUrl || "/"),
          state: { time: 0, paused: true, ts: Date.now() },
          members: new Map(),
          chat: [],
          createdAt: Date.now(),
        };
        rooms.set(roomId, room);
      }
      const name = String(msg.name || "Guest").slice(0, 32) || "Guest";
      room.members.set(memberId, { ws, name });

      send(ws, {
        type: "joined",
        memberId,
        isHost: room.hostId === memberId,
        mediaUrl: room.mediaUrl,
        state: room.state,
        members: memberList(room),
        chat: room.chat.slice(-50),
      });
      broadcast(room, { type: "members", members: memberList(room), joined: name }, memberId);
      return;
    }

    const room = rooms.get(roomId);
    if (!room) return;
    const isHost = room.hostId === memberId;

    if (msg.type === "host_action" && isHost) {
      const action = msg.action;
      if (!["play", "pause", "seek"].includes(action)) return;
      const time = Number(msg.time) || 0;
      const ts = Date.now();
      if (action === "play") room.state = { time, paused: false, ts };
      else if (action === "pause") room.state = { time, paused: true, ts };
      else if (action === "seek") room.state = { ...room.state, time, ts };
      broadcast(room, { type: "host_action", action, time, ts }, memberId);
      return;
    }

    if (msg.type === "sync" && isHost) {
      const time = Number(msg.time) || 0;
      const paused = !!msg.paused;
      const ts = Date.now();
      room.state = { time, paused, ts };
      broadcast(room, { type: "sync", time, paused, ts }, memberId);
      return;
    }

    if (msg.type === "change_media" && isHost) {
      const mediaUrl = String(msg.mediaUrl || "").slice(0, 200);
      if (!mediaUrl.startsWith("/")) return;
      room.mediaUrl = mediaUrl;
      room.state = { time: 0, paused: true, ts: Date.now() };
      broadcast(room, { type: "media_changed", mediaUrl }, memberId);
      return;
    }

    if (msg.type === "chat") {
      const text = String(msg.text || "").slice(0, 500).trim();
      if (!text) return;
      // GIF messages: validate URL is from a known GIPHY CDN host before broadcasting.
      if (text.startsWith("[gif]")) {
        const url = text.slice(5);
        try {
          const u = new URL(url);
          const ok = u.protocol === "https:" && /(^|\.)giphy\.com$/.test(u.hostname);
          if (!ok) return;
        } catch {
          return;
        }
      }
      const me = room.members.get(memberId);
      const chatMsg = { from: me?.name || "Guest", text, ts: Date.now() };
      room.chat.push(chatMsg);
      if (room.chat.length > 200) room.chat.shift();
      // Send to everyone (including sender) once.
      for (const m of room.members.values()) send(m.ws, { type: "chat", ...chatMsg });
      return;
    }

    if (msg.type === "promote" && isHost) {
      const targetId = String(msg.targetId || "");
      if (!room.members.has(targetId) || targetId === memberId) return;
      room.hostId = targetId;
      const newHost = room.members.get(targetId);
      send(newHost.ws, { type: "host_promoted" });
      send(ws, { type: "host_demoted" });
      broadcast(room, { type: "members", members: memberList(room) });
      return;
    }
  });

  ws.on("close", () => {
    const room = rooms.get(roomId);
    if (!room) return;
    const me = room.members.get(memberId);
    room.members.delete(memberId);

    if (room.members.size === 0) {
      rooms.delete(roomId);
      return;
    }
    if (room.hostId === memberId) {
      const newHostId = room.members.keys().next().value;
      room.hostId = newHostId;
      send(room.members.get(newHostId).ws, { type: "host_promoted" });
    }
    broadcast(room, { type: "members", members: memberList(room), left: me?.name || "Guest" });
  });
});

console.log(`[room] WebSocket relay listening on ws://localhost:${PORT}`);
