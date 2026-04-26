"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type ChatMsg,
  type ClientMsg,
  type Member,
  type ServerMsg,
  ROOM_NAME_KEY,
} from "@/lib/room";
import { ALPHA_PROVIDER } from "@/lib/providers";
import { Dialog } from "./Dialog";
import { Check, Copy, LogOut, Send, Image as ImageIcon } from "lucide-react";

const WS_URL = process.env.NEXT_PUBLIC_ROOM_WS_URL || "ws://localhost:3001";
// Watch-party sync uses the canonical (Alpha) provider's origin for postMessage.
// If Alpha isn't configured, watch-party features are inert.
const ALPHA_ORIGIN = ALPHA_PROVIDER?.origin || "";

type Props = {
  roomCode: string;
  mediaUrl: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onLeave: () => void;
};

export function Room({ roomCode, mediaUrl, iframeRef, onLeave }: Props) {
  const router = useRouter();
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [name, setName] = useState("");
  const [nameDialog, setNameDialog] = useState<{ kind: "initial" | "rename" } | null>(null);
  const [draftName, setDraftName] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [justCopied, setJustCopied] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const isHostRef = useRef(false);
  const lastBroadcastRef = useRef({ playing: false, time: 0, ts: 0 });
  const suppressUntilRef = useRef(0); // ignore PLAYER_EVENTs caused by remote actions
  const chatLogRef = useRef<HTMLDivElement | null>(null);

  // Pick / persist display name.
  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(ROOM_NAME_KEY) : "";
    if (stored) {
      setName(stored);
    } else {
      setDraftName("");
      setNameDialog({ kind: "initial" });
    }
  }, []);

  const submitName = (next: string) => {
    const trimmed = next.trim().slice(0, 32);
    if (!trimmed) return;
    setName(trimmed);
    try { window.localStorage.setItem(ROOM_NAME_KEY, trimmed); } catch { /* ignore */ }
    setNameDialog(null);
    if (nameDialog?.kind === "rename") wsRef.current?.close(); // reconnect with new name
  };

  // Connect.
  useEffect(() => {
    if (!name) return;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      const join: ClientMsg = { type: "join", room: roomCode, mediaUrl, name };
      ws.send(JSON.stringify(join));
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      handleServerMsg(msg);
    };

    return () => { ws.close(); };
  }, [name, roomCode]);

  // Re-emit join "change_media" if URL changes while we're host.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1 || !isHost) return;
    const m: ClientMsg = { type: "change_media", mediaUrl };
    ws.send(JSON.stringify(m));
  }, [mediaUrl, isHost]);

  function handleServerMsg(msg: ServerMsg) {
    if (msg.type === "joined") {
      setIsHost(msg.isHost);
      isHostRef.current = msg.isHost;
      setMembers(msg.members);
      setChat(msg.chat);
      // If room's current media differs from ours, navigate.
      if (msg.mediaUrl && msg.mediaUrl !== mediaUrl) {
        router.replace(addRoomToUrl(msg.mediaUrl, roomCode));
      }
    } else if (msg.type === "members") {
      setMembers(msg.members);
      if (msg.joined) appendSystemChat(`${msg.joined} joined`);
      if (msg.left) appendSystemChat(`${msg.left} left`);
    } else if (msg.type === "host_promoted") {
      setIsHost(true);
      isHostRef.current = true;
      appendSystemChat("You are now the host");
    } else if (msg.type === "host_demoted") {
      setIsHost(false);
      isHostRef.current = false;
      appendSystemChat("You are no longer the host");
    } else if (msg.type === "host_action") {
      applyRemoteAction(msg.action, msg.time, msg.ts);
    } else if (msg.type === "sync") {
      applyRemoteSync(msg.time, msg.paused, msg.ts);
    } else if (msg.type === "media_changed") {
      router.replace(addRoomToUrl(msg.mediaUrl, roomCode));
    } else if (msg.type === "chat") {
      setChat((c) => [...c, msg].slice(-200));
    }
  }

  function appendSystemChat(text: string) {
    setChat((c) => [...c, { from: "—", text, ts: Date.now() }].slice(-200));
  }

  function postToIframe(payload: any) {
    const iframe = iframeRef.current ?? document.querySelector("iframe");
    iframe?.contentWindow?.postMessage(payload, ALPHA_ORIGIN);
  }

  function applyRemoteAction(action: "play" | "pause" | "seek", time: number, ts: number) {
    suppressUntilRef.current = Date.now() + 1500;
    if (action === "play") {
      const compensated = time + (Date.now() - ts) / 1000;
      postToIframe({ command: "seek", time: compensated });
      postToIframe({ command: "play" });
    } else if (action === "pause") {
      postToIframe({ command: "pause" });
      postToIframe({ command: "seek", time });
    } else if (action === "seek") {
      postToIframe({ command: "seek", time });
    }
  }

  function applyRemoteSync(time: number, paused: boolean, ts: number) {
    if (isHostRef.current) return;
    const expected = paused ? time : time + (Date.now() - ts) / 1000;
    // Query our own iframe state, then correct if drift > 1.5s.
    const getStatusOnce = () => new Promise<{ currentTime: number; playing: boolean } | null>((resolve) => {
      const onMsg = (e: MessageEvent<any>) => {
        if (e.origin !== ALPHA_ORIGIN || e.data?.data?.event !== "playerstatus") return;
        window.removeEventListener("message", onMsg);
        resolve({ currentTime: e.data.data.currentTime, playing: e.data.data.playing });
      };
      window.addEventListener("message", onMsg);
      postToIframe({ command: "getStatus" });
      setTimeout(() => { window.removeEventListener("message", onMsg); resolve(null); }, 600);
    });

    getStatusOnce().then((s) => {
      if (!s) return;
      const drift = Math.abs(s.currentTime - expected);
      if (drift > 1.5) {
        suppressUntilRef.current = Date.now() + 1500;
        postToIframe({ command: "seek", time: expected });
      }
      if (paused && s.playing) postToIframe({ command: "pause" });
      if (!paused && !s.playing) postToIframe({ command: "play" });
    });
  }

  // Host: detect transitions from PLAYER_EVENT and broadcast.
  useEffect(() => {
    function onMessage(e: MessageEvent<any>) {
      if (e.origin !== ALPHA_ORIGIN) return;
      const d = e.data?.data;
      if (!d || e.data?.type !== "PLAYER_EVENT") return;
      if (!isHostRef.current) return;
      if (Date.now() < suppressUntilRef.current) return;

      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1) return;

      const prev = lastBroadcastRef.current;
      const playingChanged = prev.playing !== d.playing;
      const expectedTime = prev.playing ? prev.time + (Date.now() - prev.ts) / 1000 : prev.time;
      const seeked = Math.abs(d.currentTime - expectedTime) > 2;

      if (playingChanged) {
        const m: ClientMsg = { type: "host_action", action: d.playing ? "play" : "pause", time: d.currentTime, ts: Date.now() };
        ws.send(JSON.stringify(m));
        lastBroadcastRef.current = { playing: d.playing, time: d.currentTime, ts: Date.now() };
      } else if (seeked) {
        const m: ClientMsg = { type: "host_action", action: "seek", time: d.currentTime, ts: Date.now() };
        ws.send(JSON.stringify(m));
        lastBroadcastRef.current = { playing: d.playing, time: d.currentTime, ts: Date.now() };
      } else {
        // Quietly track current state for next diff.
        lastBroadcastRef.current = { playing: d.playing, time: d.currentTime, ts: Date.now() };
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Host: periodic drift sync every 4s while playing.
  useEffect(() => {
    const t = setInterval(() => {
      if (!isHostRef.current) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1) return;
      const last = lastBroadcastRef.current;
      const m: ClientMsg = { type: "sync", time: last.time, paused: !last.playing, ts: Date.now() };
      ws.send(JSON.stringify(m));
    }, 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const el = chatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  const sendChat = () => {
    const text = draft.trim();
    if (!text) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    const m: ClientMsg = { type: "chat", text };
    ws.send(JSON.stringify(m));
    setDraft("");
  };
  const sendGif = (url: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    const m: ClientMsg = { type: "chat", text: `[gif]${url}` };
    ws.send(JSON.stringify(m));
    setGifPickerOpen(false);
  };

  const inviteUrl = typeof window !== "undefined"
    ? `${window.location.origin}${addRoomToUrl(mediaUrl, roomCode)}`
    : "";

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 1500);
      appendSystemChat("Invite link copied");
    } catch { /* ignore */ }
  };

  const renameSelf = () => {
    setDraftName(name);
    setNameDialog({ kind: "rename" });
  };

  const promote = (targetId: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    const m: ClientMsg = { type: "promote", targetId };
    ws.send(JSON.stringify(m));
  };

  return (
    <aside className={`room-panel ${collapsed ? "collapsed" : ""}`}>
      <button className="room-toggle" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? "Expand" : "Collapse"}>
        {collapsed ? "◀" : "▶"}
      </button>
      <div className="room-body">
        <div className="room-head">
          <div className="room-head-main">
            <div className="room-title">Watch Room</div>
            <div className="room-code-row">
              <span className="room-code">{roomCode}</span>
              <button
                className="room-copy-btn"
                onClick={copyInvite}
                title={justCopied ? "Copied!" : "Copy invite link"}
                aria-label="Copy invite link"
              >
                {justCopied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
          {!connected && <div className="room-status">Connecting…</div>}
        </div>

        <div className="room-identity">
          <span className="room-identity-label">Joined as</span>
          <button className="room-name-pill" onClick={renameSelf} title="Change display name">
            {name}
          </button>
          <button className="ghost-sm danger room-leave" onClick={onLeave} title="Leave room">
            <LogOut size={13} />
            Leave
          </button>
        </div>

        <div className="room-role">
          {isHost ? "🎬 You are the host — your playback controls everyone." : "👥 Following the host."}
        </div>

        <div className="room-members">
          <div className="room-section-title">Members ({members.length})</div>
          {members.map((m) => (
            <div className="room-member" key={m.id}>
              <span className="room-member-name">{m.name}</span>
              <div className="room-member-actions">
                {m.isHost && <span className="badge-host">HOST</span>}
                {isHost && !m.isHost && (
                  <button
                    className="ghost-sm tiny"
                    onClick={() => promote(m.id)}
                    title={`Make ${m.name} the host`}
                  >
                    Make host
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="room-chat">
          <div className="room-section-title">Chat</div>
          <div className="room-chat-log" ref={chatLogRef}>
            {chat.map((c, i) => (
              <div key={i} className={`chat-msg ${c.from === "—" ? "system" : ""}`}>
                {c.from === "—"
                  ? <em>{c.text}</em>
                  : c.text.startsWith("[gif]")
                    ? <>
                        <strong style={{ color: nameColor(c.from) }}>{c.from}:</strong>
                        <div className="chat-gif-wrap"><img className="chat-gif" src={c.text.slice(5)} alt="gif" loading="lazy" /></div>
                      </>
                    : <><strong style={{ color: nameColor(c.from) }}>{c.from}:</strong> {c.text}</>}
              </div>
            ))}
          </div>
          {gifPickerOpen && <GifPicker onPick={sendGif} onClose={() => setGifPickerOpen(false)} />}
          <form className="room-chat-form" onSubmit={(e) => { e.preventDefault(); sendChat(); }}>
            <button
              type="button"
              className="chat-gif-btn"
              onClick={() => setGifPickerOpen((v) => !v)}
              aria-label="Send a GIF"
              title="Send a GIF"
            >
              <ImageIcon size={14} />
            </button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Say something…"
              maxLength={500}
            />
            <button type="submit" disabled={!draft.trim()} aria-label="Send message">
              <Send size={14} />
            </button>
          </form>
        </div>
      </div>

      <Dialog
        open={nameDialog !== null}
        title={nameDialog?.kind === "rename" ? "Change display name" : "Pick a display name"}
        description="How should other people see you in the watch room?"
        closable={nameDialog?.kind === "rename"}
        onClose={() => setNameDialog(null)}
      >
        <form onSubmit={(e) => { e.preventDefault(); submitName(draftName); }}>
          <input
            className="dialog-input"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="e.g. Alex"
            maxLength={32}
            autoFocus
          />
          <div className="dialog-actions">
            {nameDialog?.kind === "rename" && (
              <button type="button" className="ghost-sm" onClick={() => setNameDialog(null)}>
                Cancel
              </button>
            )}
            <button type="submit" className="btn-sm" disabled={!draftName.trim()}>
              {nameDialog?.kind === "rename" ? "Save" : "Continue"}
            </button>
          </div>
        </form>
      </Dialog>
    </aside>
  );
}

type GifResult = { id: string; title: string; preview: string; url: string };

function GifPicker({ onPick, onClose }: { onPick: (url: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    setLoading(true);
    setError(null);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/giphy/search?q=${encodeURIComponent(q)}`);
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setError(j.error === "GIPHY_API_KEY not configured" ? "GIPHY not configured on the server." : "Couldn't load GIFs.");
          setResults([]);
        } else {
          const j = await r.json();
          setResults(j.results || []);
        }
      } catch {
        setError("Couldn't load GIFs.");
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [q]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="gif-picker" ref={wrapRef}>
      <input
        className="gif-picker-input"
        autoFocus
        placeholder="Search GIPHY…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="gif-picker-grid">
        {error && <div className="gif-picker-state">{error}</div>}
        {!error && loading && results.length === 0 && <div className="gif-picker-state">Loading…</div>}
        {!error && !loading && results.length === 0 && <div className="gif-picker-state">No results</div>}
        {results.length > 0 && (
          <div className="gif-picker-grid-inner">
            {results.map((g) => (
              <button
                key={g.id}
                type="button"
                className="gif-picker-item"
                onClick={() => onPick(g.url)}
                title={g.title}
              >
                <img src={g.preview} alt={g.title} loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="gif-picker-attribution">Powered by GIPHY</div>
    </div>
  );
}

const NAME_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9",
  "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
  "#ec4899", "#f43f5e",
];
function nameColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return NAME_COLORS[Math.abs(h) % NAME_COLORS.length];
}

function addRoomToUrl(path: string, code: string) {
  const [base, query = ""] = path.split("?");
  const sp = new URLSearchParams(query);
  sp.delete("room");
  sp.set("room", code);
  return `${base}?${sp.toString()}`;
}
