"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type ChatMsg,
  type ClientMsg,
  type Member,
  type ServerMsg,
  type RequestKind,
  type RequestPayload,
  ROOM_NAME_KEY,
  getRoomSessionId,
} from "@/lib/room";
import { ALPHA_PROVIDER } from "@/lib/providers";
import { Dialog } from "./Dialog";
import { Ban, Check, ChevronRight, Copy, Crown, Hand, LogOut, Maximize2, Minimize2, Pin, PinOff, Search, Send, Volume2, VolumeX, X, Image as ImageIcon } from "lucide-react";

const WS_URL = process.env.NEXT_PUBLIC_ROOM_WS_URL || "ws://localhost:3001";
// Watch-party sync uses the canonical (Alpha) provider's origin for postMessage.
// If Alpha isn't configured, watch-party features are inert.
const ALPHA_ORIGIN = ALPHA_PROVIDER?.origin || "";

type Props = {
  roomCode: string;
  mediaUrl: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  wrapRef: React.RefObject<HTMLDivElement | null>;
  titleType: "movie" | "tv";
  onStepEpisode: (delta: 1 | -1) => void;
  canPrevEpisode: boolean;
  canNextEpisode: boolean;
  onLeave: () => void;
};

export function Room({
  roomCode, mediaUrl, iframeRef, wrapRef,
  titleType, onStepEpisode, canPrevEpisode, canNextEpisode,
  onLeave,
}: Props) {
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
  const [actionsOpen, setActionsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chatHidden, setChatHidden] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [mutedNames, setMutedNames] = useState<Set<string>>(new Set());
  const [bannedNotice, setBannedNotice] = useState(false);
  // Generic pending-request state. For host: incoming. For requester: tracks own pending.
  const [confirmDialog, setConfirmDialog] = useState<
    | { kind: "promote" | "ban"; targetId: string; targetName: string }
    | null
  >(null);
  type PendingReq = { fromId: string; fromName: string; kind: RequestKind; payload: RequestPayload; expiresAt: number };
  const [pendingReqs, setPendingReqs] = useState<PendingReq[]>([]);
  const [myPendingReq, setMyPendingReq] = useState<{ kind: RequestKind; expiresAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [wrapRef]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (wrapRef.current) {
      wrapRef.current.requestFullscreen().catch(() => {});
    }
  };

  // Auto-hide logic: only when fullscreen + not pinned. Reveal on activity, hide after 15s idle.
  const showChatNow = () => {
    setChatHidden(false);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    if (!isFullscreen || pinned) return;
    hideTimerRef.current = window.setTimeout(() => setChatHidden(true), 15000);
  };

  // Reset/start idle timer whenever fullscreen or pin state changes.
  useEffect(() => {
    if (!isFullscreen || pinned) {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      setChatHidden(false);
      return;
    }
    showChatNow();
    return () => { if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullscreen, pinned]);

  // Visible chat (filters out muted users); used both for rendering and for fullscreen unhide.
  const visibleChat = chat.filter((c) => c.from === "—" || !mutedNames.has(c.from));

  // New visible chat message → reveal + restart timer.
  useEffect(() => {
    if (!isFullscreen || pinned) return;
    showChatNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleChat.length]);

  // Hover near right edge while fullscreened → reveal.
  useEffect(() => {
    if (!isFullscreen || pinned) return;
    const el = wrapRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      if (e.clientX > rect.right - 32) showChatNow();
    };
    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullscreen, pinned]);
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
      const join: ClientMsg = { type: "join", room: roomCode, mediaUrl, name, sessionId: getRoomSessionId() };
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
    } else if (msg.type === "banned") {
      setBannedNotice(true);
      setTimeout(() => onLeave(), 2000);
    } else if (msg.type === "request_pending") {
      const incoming: PendingReq = {
        fromId: msg.fromId, fromName: msg.fromName,
        kind: msg.kind, payload: msg.payload, expiresAt: msg.expiresAt,
      };
      setPendingReqs((prev) => {
        const filtered = prev.filter((r) => r.fromId !== incoming.fromId);
        return [...filtered, incoming];
      });
    } else if (msg.type === "request_clear") {
      setPendingReqs((prev) => prev.filter((r) => r.fromId !== msg.fromId));
    } else if (msg.type === "request_resolved") {
      const k = myPendingReq?.kind;
      setMyPendingReq(null);
      const noun = k === "media" ? "suggestion" : k === "episode" ? "episode change" : "pause request";
      const text = msg.expired
        ? `Your ${noun} expired (no response).`
        : msg.approved
          ? `Your ${noun} was approved.`
          : `Your ${noun} was denied.`;
      appendSystemChat(text);
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

  const askPromote = (targetId: string, targetName: string) =>
    setConfirmDialog({ kind: "promote", targetId, targetName });
  const askBan = (targetId: string, targetName: string) =>
    setConfirmDialog({ kind: "ban", targetId, targetName });
  const confirmAction = () => {
    if (!confirmDialog) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      const m: ClientMsg = confirmDialog.kind === "promote"
        ? { type: "promote", targetId: confirmDialog.targetId }
        : { type: "ban", targetId: confirmDialog.targetId };
      ws.send(JSON.stringify(m));
    }
    setConfirmDialog(null);
  };
  const toggleMute = (memberName: string) => {
    setMutedNames((prev) => {
      const next = new Set(prev);
      if (next.has(memberName)) next.delete(memberName);
      else next.add(memberName);
      return next;
    });
  };

  const sendRequest = (kind: RequestKind, payload: RequestPayload) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    const m: ClientMsg = { type: "request_action", kind, payload };
    ws.send(JSON.stringify(m));
    setMyPendingReq({ kind, expiresAt: Date.now() + 60_000 });
  };
  const respondAction = (req: PendingReq, approve: boolean) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    if (approve) {
      if (req.kind === "pause") {
        iframeRef.current?.contentWindow?.postMessage({ command: "pause" }, ALPHA_ORIGIN);
      } else if (req.kind === "episode") {
        const delta = (req.payload as { delta: 1 | -1 }).delta;
        onStepEpisode(delta);
      } else if (req.kind === "media") {
        const target = (req.payload as { mediaUrl: string }).mediaUrl;
        ws.send(JSON.stringify({ type: "change_media", mediaUrl: target } as ClientMsg));
        const sep = target.includes("?") ? "&" : "?";
        router.replace(`${target}${sep}room=${roomCode}`);
      }
    }
    const m: ClientMsg = { type: "respond_action", targetId: req.fromId, approve };
    ws.send(JSON.stringify(m));
    setPendingReqs((prev) => prev.filter((r) => r.fromId !== req.fromId));
  };

  useEffect(() => {
    if (pendingReqs.length === 0 && !myPendingReq) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [pendingReqs.length, myPendingReq]);

  useEffect(() => {
    if (!isHost && pendingReqs.length > 0) setPendingReqs([]);
  }, [isHost, pendingReqs.length]);

  useEffect(() => {
    if (!myPendingReq) return;
    const remaining = myPendingReq.expiresAt - Date.now();
    if (remaining <= 0) { setMyPendingReq(null); return; }
    const t = window.setTimeout(() => setMyPendingReq(null), remaining + 200);
    return () => window.clearTimeout(t);
  }, [myPendingReq]);

  return (
    <aside
      className={`room-panel ${collapsed ? "collapsed" : ""} ${chatHidden ? "auto-hidden" : ""}`}
      onMouseMove={() => { if (isFullscreen && !pinned) showChatNow(); }}
      onMouseEnter={() => { if (isFullscreen && !pinned) showChatNow(); }}
      onKeyDown={() => { if (isFullscreen && !pinned) showChatNow(); }}
      onFocus={() => { if (isFullscreen && !pinned) showChatNow(); }}
      onClick={() => { if (isFullscreen && !pinned) showChatNow(); }}
    >
      <button className="room-toggle" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? "Expand" : "Collapse"}>
        {collapsed ? "◀" : "▶"}
      </button>
      {isFullscreen && !pinned && (
        <button
          type="button"
          className="room-hide-tab"
          tabIndex={chatHidden ? -1 : 0}
          aria-hidden={chatHidden}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
            setChatHidden(true);
          }}
          aria-label="Hide chat"
          title="Hide chat"
        >
          <ChevronRight size={16} />
        </button>
      )}
      <div className="room-body">
        <div className="room-head">
          <div className="room-title">Watch Room</div>
          <div className="room-head-right">
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
            {!connected && <div className="room-status">Connecting…</div>}
            {isFullscreen && (
              <>
                <button
                  type="button"
                  className={`room-fs-btn ${pinned ? "on" : ""}`}
                  onClick={() => setPinned((p) => !p)}
                  title={pinned ? "Unpin chat (auto-hide)" : "Pin chat (always visible)"}
                  aria-label={pinned ? "Unpin chat" : "Pin chat"}
                >
                  {pinned ? <Pin size={14} /> : <PinOff size={14} />}
                </button>
              </>
            )}
            <button
              type="button"
              className="room-fs-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen with chat"}
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
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

        <div className={`room-role ${isHost ? "host" : ""}`}>
          <span className="room-role-text">
            {isHost ? "You are the host — your playback controls everyone." : "Following the host"}
          </span>
        </div>

        <div className="room-members">
          <div className="room-section-title">Members ({members.length})</div>
          {members.map((m) => {
            const isSelf = m.name === name;
            const isMuted = mutedNames.has(m.name);
            return (
              <div className="room-member" key={m.id}>
                <span className="room-member-name">{m.name}{isSelf && <span className="room-self-tag"> (you)</span>}</span>
                <div className="room-member-actions">
                  {m.isHost && <span className="badge-host">HOST</span>}
                  {!isSelf && (
                    <button
                      className={`room-member-icon ${isMuted ? "on" : ""}`}
                      onClick={() => toggleMute(m.name)}
                      title={isMuted ? `Unmute ${m.name}` : `Mute ${m.name} (just for you)`}
                      aria-label={isMuted ? "Unmute" : "Mute"}
                    >
                      {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                    </button>
                  )}
                  {isHost && !m.isHost && (
                    <button
                      className="room-member-icon danger"
                      onClick={() => askBan(m.id, m.name)}
                      title={`Ban ${m.name}`}
                      aria-label="Ban"
                    >
                      <Ban size={13} />
                    </button>
                  )}
                  {isHost && !m.isHost && (
                    <button
                      className="room-member-icon"
                      onClick={() => askPromote(m.id, m.name)}
                      title={`Make ${m.name} the host`}
                      aria-label="Make host"
                    >
                      <Crown size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="room-chat">
          <div className="room-section-title">Chat</div>
          <div className="room-chat-log" ref={chatLogRef}>
            {isHost && pendingReqs.filter((r) => !mutedNames.has(r.fromName)).map((req) => {
              const total = 60_000;
              const remaining = Math.max(0, req.expiresAt - now);
              const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
              const verb = describeRequestForHost(req.kind, req.payload);
              return (
                <div key={req.fromId} className="chat-card pause-req-card">
                  <div className="pause-req-head">
                    <Hand size={14} className="pause-req-ico" />
                    <span><strong>{req.fromName}</strong> {verb}</span>
                    <span className="pause-req-timer">{Math.ceil(remaining / 1000)}s</span>
                  </div>
                  <div className="pause-req-bar"><span style={{ width: `${pct}%` }} /></div>
                  <div className="pause-req-actions">
                    <button type="button" className="btn-sm" onClick={() => respondAction(req, true)}>Approve</button>
                    <button type="button" className="ghost-sm" onClick={() => respondAction(req, false)}>Deny</button>
                  </div>
                </div>
              );
            })}
            {!isHost && myPendingReq && (
              <div className="chat-card pause-req-card pending">
                <div className="pause-req-head">
                  <Hand size={14} className="pause-req-ico" />
                  <span>Waiting for host to respond…</span>
                  <span className="pause-req-timer">{Math.max(0, Math.ceil((myPendingReq.expiresAt - now) / 1000))}s</span>
                </div>
                <div className="pause-req-bar">
                  <span style={{ width: `${Math.max(0, Math.min(100, ((myPendingReq.expiresAt - now) / 60_000) * 100))}%` }} />
                </div>
              </div>
            )}
            {visibleChat.map((c, i) => (
              <div key={i} className={`chat-msg ${c.from === "—" ? "system" : ""}`}>
                {c.from === "—"
                  ? <em>{c.text}</em>
                  : c.text.startsWith("[gif]")
                    ? <>
                        <strong style={{ color: nameColor(c.from) }}>{c.from}:</strong>
                        <div className="chat-gif-wrap"><img
                          className="chat-gif"
                          src={c.text.slice(5)}
                          alt="gif"
                          loading="lazy"
                          onLoad={() => { const el = chatLogRef.current; if (el) el.scrollTop = el.scrollHeight; }}
                        /></div>
                      </>
                    : <><strong style={{ color: nameColor(c.from) }}>{c.from}:</strong> {c.text}</>}
              </div>
            ))}
          </div>
          {gifPickerOpen && <GifPicker onPick={sendGif} onClose={() => setGifPickerOpen(false)} />}
          {actionsOpen && (
            <ActionsMenu
              onClose={() => setActionsOpen(false)}
              isHost={isHost}
              hasPending={!!myPendingReq}
              isTv={titleType === "tv"}
              canPrev={canPrevEpisode}
              canNext={canNextEpisode}
              onRequestPause={() => { sendRequest("pause", {}); setActionsOpen(false); }}
              onRequestEpisode={(delta) => { sendRequest("episode", { delta }); setActionsOpen(false); }}
              onSuggestMedia={(mediaUrl, label) => { sendRequest("media", { mediaUrl, label }); setActionsOpen(false); }}
            />
          )}
          <form className="room-chat-form" onSubmit={(e) => { e.preventDefault(); sendChat(); }}>
            <button
              type="button"
              data-actions-trigger
              className="chat-gif-btn"
              onClick={() => { setActionsOpen((v) => !v); setGifPickerOpen(false); }}
              aria-label="Open actions"
              title="Actions"
            >
              <Hand size={14} />
            </button>
            <button
              type="button"
              className="chat-gif-btn"
              onClick={() => { setGifPickerOpen((v) => !v); setActionsOpen(false); }}
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
        open={confirmDialog !== null}
        title={
          confirmDialog?.kind === "promote"
            ? `Make ${confirmDialog.targetName} the host?`
            : confirmDialog?.kind === "ban"
              ? `Ban ${confirmDialog.targetName}?`
              : ""
        }
        description={
          confirmDialog?.kind === "promote"
            ? "They'll control playback for everyone. You'll become a guest."
            : confirmDialog?.kind === "ban"
              ? "They'll be removed from the room and won't be able to rejoin."
              : undefined
        }
        onClose={() => setConfirmDialog(null)}
      >
        <div className="dialog-actions">
          <button type="button" className="ghost-sm" onClick={() => setConfirmDialog(null)}>
            Cancel
          </button>
          <button
            type="button"
            className={confirmDialog?.kind === "ban" ? "btn-sm danger" : "btn-sm"}
            onClick={confirmAction}
          >
            {confirmDialog?.kind === "ban" ? "Ban" : "Make host"}
          </button>
        </div>
      </Dialog>

      <Dialog
        open={bannedNotice}
        title="You've been removed"
        description="The host has banned you from this watch room."
        closable={false}
        onClose={() => setBannedNotice(false)}
      >
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Returning to the page…</div>
      </Dialog>

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

function describeRequestForHost(kind: RequestKind, payload: RequestPayload) {
  if (kind === "episode") {
    const d = (payload as { delta: number }).delta;
    return d > 0 ? "is requesting the next episode" : "is requesting the previous episode";
  }
  if (kind === "media") {
    const label = (payload as { label: string }).label;
    return <>suggests watching <strong>{label}</strong></>;
  }
  return "is requesting a pause";
}

function ActionsMenu({
  onClose, isHost, hasPending, isTv, canPrev, canNext,
  onRequestPause, onRequestEpisode, onSuggestMedia,
}: {
  onClose: () => void;
  isHost: boolean;
  hasPending: boolean;
  isTv: boolean;
  canPrev: boolean;
  canNext: boolean;
  onRequestPause: () => void;
  onRequestEpisode: (delta: 1 | -1) => void;
  onSuggestMedia: (mediaUrl: string, label: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<"root" | "search">("root");
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("[data-actions-trigger]")) return;
      if (wrapRef.current && !wrapRef.current.contains(target)) onClose();
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

  const canRequest = !isHost && !hasPending;
  const hint = isHost ? "You're host" : hasPending ? "Pending" : "";

  if (view === "search") {
    return (
      <div className="actions-menu" ref={wrapRef}>
        <MediaSearch
          onPick={onSuggestMedia}
          onBack={() => setView("root")}
        />
      </div>
    );
  }

  return (
    <div className="actions-menu" ref={wrapRef}>
      <button
        type="button"
        className="actions-menu-item"
        onClick={onRequestPause}
        disabled={!canRequest}
        title={isHost ? "You are the host — you can pause directly" : hasPending ? "Already requested" : "Ask the host to pause"}
      >
        <Hand size={14} />
        <span className="actions-menu-label">Request pause</span>
        <span className="actions-menu-hint">{hint}</span>
      </button>
      {isTv && (
        <>
          <button
            type="button"
            className="actions-menu-item"
            onClick={() => onRequestEpisode(1)}
            disabled={!canRequest || !canNext}
            title={!canNext ? "Already on the last episode" : "Ask the host to go to the next episode"}
          >
            <ChevronRight size={14} />
            <span className="actions-menu-label">Request next episode</span>
            <span className="actions-menu-hint">{!canNext ? "Last ep" : hint}</span>
          </button>
          <button
            type="button"
            className="actions-menu-item"
            onClick={() => onRequestEpisode(-1)}
            disabled={!canRequest || !canPrev}
            title={!canPrev ? "Already on the first episode" : "Ask the host to go to the previous episode"}
          >
            <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
            <span className="actions-menu-label">Request previous episode</span>
            <span className="actions-menu-hint">{!canPrev ? "First ep" : hint}</span>
          </button>
        </>
      )}
      <button
        type="button"
        className="actions-menu-item"
        onClick={() => setView("search")}
        disabled={!canRequest}
        title={isHost ? "You are the host — open it directly" : hasPending ? "Already requested" : "Suggest something else"}
      >
        <Search size={14} />
        <span className="actions-menu-label">Suggest something to watch</span>
        <span className="actions-menu-hint">{hint}</span>
      </button>
    </div>
  );
}

type SearchResult = {
  id: number;
  type: "movie" | "tv";
  title: string;
  year?: string;
  poster: string | null;
};

function MediaSearch({
  onPick, onBack,
}: {
  onPick: (mediaUrl: string, label: string) => void;
  onBack: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<number | null>(null);

  // Initial: load trending so the popover isn't empty.
  useEffect(() => {
    let cancel = false;
    fetch(`/api/tmdb/list?name=trending`)
      .then((r) => r.json())
      .then((j) => { if (!cancel) setResults((j.results || []).slice(0, 12)); })
      .catch(() => {})
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!q.trim()) return; // keep showing trending when query is cleared
    setLoading(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/tmdb/search?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        setResults((j.results || []).slice(0, 12));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [q]);
  return (
    <div className="media-search">
      <div className="media-search-head">
        <button type="button" className="media-search-back" onClick={onBack} aria-label="Back">‹</button>
        <input
          autoFocus
          className="gif-picker-input"
          placeholder="Search movies & TV…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="media-search-results">
        {loading && results.length === 0 && <div className="gif-picker-state">Loading…</div>}
        {!loading && q.trim() && results.length === 0 && <div className="gif-picker-state">No results</div>}
        {results.map((r) => (
          <button
            key={`${r.type}-${r.id}`}
            type="button"
            className="media-search-item"
            onClick={() => {
              const label = r.year ? `${r.title} (${r.year})` : r.title;
              onPick(`/${r.type}/${r.id}`, label);
            }}
          >
            {r.poster
              ? <img src={r.poster} alt="" />
              : <div className="media-search-noposter" />}
            <div className="media-search-meta">
              <div className="media-search-title">{r.title}</div>
              <div className="media-search-sub">{r.type === "tv" ? "TV" : "Movie"}{r.year ? ` · ${r.year}` : ""}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
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
