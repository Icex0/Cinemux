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

      const sessionId = String(msg.sessionId || "").slice(0, 64);
      let room = rooms.get(roomId);
      if (!room) {
        room = {
          hostId: memberId,
          hostSessionId: sessionId,
          mediaUrl: String(msg.mediaUrl || "/"),
          state: { time: 0, paused: true, ts: Date.now() },
          members: new Map(),
          chat: [],
          bannedSessions: new Set(),
          pendingRequests: new Map(),
          deleteTimer: null,
          createdAt: Date.now(),
        };
        rooms.set(roomId, room);
      }
      // Cancel any pending empty-room deletion — someone is reconnecting.
      if (room.deleteTimer) {
        clearTimeout(room.deleteTimer);
        room.deleteTimer = null;
      }
      const name = String(msg.name || "Guest").slice(0, 32) || "Guest";
      // Reject if their session has been banned. Catches name changes, doesn't punish namesakes.
      if (sessionId && room.bannedSessions.has(sessionId)) {
        send(ws, { type: "banned" });
        try { ws.close(1008, "banned"); } catch { /* ignore */ }
        return;
      }
      room.members.set(memberId, { ws, name, sessionId });

      // Reclaim host on reconnect: if this session was previously the host, restore them.
      const reclaimedHost = sessionId && room.hostSessionId === sessionId;
      const previousHostId = reclaimedHost && room.hostId !== memberId ? room.hostId : null;
      // Adopt host if the slot is orphaned (current hostId isn't an actual member) and nobody reclaimed.
      // This happens when everyone left during the grace period and a non-original-host joins first.
      const adoptHost = !reclaimedHost && !room.members.has(room.hostId);
      if (reclaimedHost) {
        room.hostId = memberId;
      } else if (adoptHost) {
        room.hostId = memberId;
        room.hostSessionId = sessionId;
      }

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
      // If we just reclaimed host, demote the interim auto-promoted host (if still in the room).
      if (previousHostId) {
        const prev = room.members.get(previousHostId);
        if (prev) send(prev.ws, { type: "host_demoted" });
      }
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

    if (msg.type === "request_action") {
      if (isHost) return;
      // One outstanding request PER USER — but multiple users can have one each.
      if (room.pendingRequests.has(memberId)) return;
      const kind = String(msg.kind || "");
      if (!["pause", "episode", "media"].includes(kind)) return;
      const raw = msg.payload || {};
      let payload;
      if (kind === "pause") {
        payload = {};
      } else if (kind === "episode") {
        const delta = Number(raw.delta);
        if (delta !== 1 && delta !== -1) return;
        payload = { delta };
      } else {
        const mediaUrl = String(raw.mediaUrl || "").slice(0, 200);
        const label = String(raw.label || "").slice(0, 120);
        if (!mediaUrl.startsWith("/")) return;
        if (!/^\/(movie|tv)\/\d+/.test(mediaUrl)) return;
        if (!label) return;
        payload = { mediaUrl, label };
      }
      const me = room.members.get(memberId);
      if (!me) return;
      const host = room.members.get(room.hostId);
      if (!host) return;
      const expiresAt = Date.now() + 60_000;
      const timeoutId = setTimeout(() => {
        if (!room.pendingRequests.has(memberId)) return;
        room.pendingRequests.delete(memberId);
        const h = room.members.get(room.hostId);
        if (h) send(h.ws, { type: "request_clear", fromId: memberId });
        const r = room.members.get(memberId);
        if (r) send(r.ws, { type: "request_resolved", approved: false, expired: true });
      }, 60_000);
      room.pendingRequests.set(memberId, { fromId: memberId, fromName: me.name, kind, payload, expiresAt, timeoutId });
      send(host.ws, { type: "request_pending", fromId: memberId, fromName: me.name, kind, payload, expiresAt });
      return;
    }

    if (msg.type === "respond_action" && isHost) {
      const targetId = String(msg.targetId || "");
      const pending = room.pendingRequests.get(targetId);
      if (!pending) return;
      clearTimeout(pending.timeoutId);
      room.pendingRequests.delete(targetId);
      const requester = room.members.get(targetId);
      if (requester) send(requester.ws, { type: "request_resolved", approved: !!msg.approve });
      return;
    }

    if (msg.type === "ban" && isHost) {
      const targetId = String(msg.targetId || "");
      if (!room.members.has(targetId) || targetId === memberId) return;
      const target = room.members.get(targetId);
      // Ban by session id, not name — avoids namesake false positives.
      // Defeated by clearing localStorage / incognito; that's the documented tradeoff.
      if (target?.sessionId) room.bannedSessions.add(target.sessionId);
      try { send(target.ws, { type: "banned" }); } catch { /* ignore */ }
      try { target.ws.close(1008, "banned"); } catch { /* ignore */ }
      return;
    }

    if (msg.type === "promote" && isHost) {
      const targetId = String(msg.targetId || "");
      if (!room.members.has(targetId) || targetId === memberId) return;
      room.hostId = targetId;
      const newHost = room.members.get(targetId);
      room.hostSessionId = newHost.sessionId || "";
      send(newHost.ws, { type: "host_promoted" });
      send(ws, { type: "host_demoted" });
      // Forward all active requests to the new host so they don't disappear.
      for (const req of room.pendingRequests.values()) {
        send(newHost.ws, {
          type: "request_pending",
          fromId: req.fromId,
          fromName: req.fromName,
          kind: req.kind,
          payload: req.payload,
          expiresAt: req.expiresAt,
        });
      }
      broadcast(room, { type: "members", members: memberList(room) });
      return;
    }
  });

  ws.on("close", () => {
    const room = rooms.get(roomId);
    if (!room) return;
    const me = room.members.get(memberId);
    room.members.delete(memberId);

    // If the disconnecting user had an outstanding request, clear it (the host's notification too).
    const myRequest = room.pendingRequests.get(memberId);
    if (myRequest) {
      clearTimeout(myRequest.timeoutId);
      room.pendingRequests.delete(memberId);
      const host = room.members.get(room.hostId);
      if (host) send(host.ws, { type: "request_clear", fromId: memberId });
    }

    if (room.members.size === 0) {
      // Don't delete immediately — clients reconnecting after a cross-route navigation
      // (host approving a media suggestion, etc.) close their old WS before opening a new one.
      // A brief grace period lets them rejoin the SAME room and reclaim host via sessionId.
      if (room.deleteTimer) clearTimeout(room.deleteTimer);
      room.deleteTimer = setTimeout(() => {
        const r = rooms.get(roomId);
        if (r && r.members.size === 0) rooms.delete(roomId);
      }, 5 * 60_000);
      return;
    }
    if (room.hostId === memberId) {
      const newHostId = room.members.keys().next().value;
      room.hostId = newHostId;
      send(room.members.get(newHostId).ws, { type: "host_promoted" });
      // New host inherits all active request notifications.
      for (const req of room.pendingRequests.values()) {
        send(room.members.get(newHostId).ws, {
          type: "request_pending",
          fromId: req.fromId,
          fromName: req.fromName,
          kind: req.kind,
          payload: req.payload,
          expiresAt: req.expiresAt,
        });
      }
    }
    broadcast(room, { type: "members", members: memberList(room), left: me?.name || "Guest" });
  });
});

console.log(`[room] WebSocket relay listening on ws://localhost:${PORT}`);
