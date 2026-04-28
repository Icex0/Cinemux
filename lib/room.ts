export type Member = { id: string; name: string; isHost: boolean };
export type ChatMsg = { from: string; text: string; ts: number };

export type ServerMsg =
  | { type: "joined"; memberId: string; isHost: boolean; mediaUrl: string; state: { time: number; paused: boolean; ts: number }; members: Member[]; chat: ChatMsg[] }
  | { type: "members"; members: Member[]; joined?: string; left?: string }
  | { type: "host_action"; action: "play" | "pause" | "seek"; time: number; ts: number }
  | { type: "sync"; time: number; paused: boolean; ts: number }
  | { type: "media_changed"; mediaUrl: string }
  | { type: "host_promoted" }
  | { type: "host_demoted" }
  | { type: "chat"; from: string; text: string; ts: number }
  | { type: "banned" }
  | {
      type: "request_pending";
      fromId: string;
      fromName: string;
      kind: RequestKind;
      payload: RequestPayload;
      expiresAt: number;
    }
  | { type: "request_clear"; fromId: string }
  | { type: "request_resolved"; approved: boolean; expired?: boolean };

export type RequestKind = "pause" | "episode" | "media";
export type RequestPayload =
  | { kind?: undefined } // pause
  | { delta: 1 | -1 } // episode
  | { mediaUrl: string; label: string }; // media

export type ClientMsg =
  | { type: "join"; room: string; mediaUrl: string; name: string; sessionId: string }
  | { type: "host_action"; action: "play" | "pause" | "seek"; time: number; ts: number }
  | { type: "sync"; time: number; paused: boolean; ts: number }
  | { type: "change_media"; mediaUrl: string }
  | { type: "chat"; text: string }
  | { type: "promote"; targetId: string }
  | { type: "ban"; targetId: string }
  | { type: "request_action"; kind: RequestKind; payload: RequestPayload }
  | { type: "respond_action"; targetId: string; approve: boolean };

export const ROOM_NAME_KEY = "room_display_name";
export const ROOM_SESSION_KEY = "room_session_id";

export function getRoomSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(ROOM_SESSION_KEY);
    if (existing) return existing;
    const fresh =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(ROOM_SESSION_KEY, fresh);
    return fresh;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function newRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
