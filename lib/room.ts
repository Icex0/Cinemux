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
  | { type: "chat"; from: string; text: string; ts: number };

export type ClientMsg =
  | { type: "join"; room: string; mediaUrl: string; name: string }
  | { type: "host_action"; action: "play" | "pause" | "seek"; time: number; ts: number }
  | { type: "sync"; time: number; paused: boolean; ts: number }
  | { type: "change_media"; mediaUrl: string }
  | { type: "chat"; text: string }
  | { type: "promote"; targetId: string };

export const ROOM_NAME_KEY = "room_display_name";

export function newRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
