# Cinemux

A Next.js metadata-and-iframe-player frontend backed by TMDB. Includes search, discovery, watch progress, a multi-provider source switcher, and a synchronized watch-party mode for any movie or show.

> **Disclaimer.** Cinemux does not host, store, or transmit any media. It is a frontend that displays metadata from TMDB and embeds third-party iframes via URL templates the operator supplies via environment variables. The repository ships with no embed sources configured. Anyone running this app is responsible for the legality of the embed sources they configure and for compliance with applicable laws and the terms of service of those upstream providers.

## Stack
- **Next.js 16** — App Router; UI and API routes in one project. Both at their current stable majors.
- **TMDB v3 API** — search, trending, popular/top-rated lists, details, images, genres, discover. Proxied server-side; the key never reaches the client.
- **localStorage** — per-device watch progress (no database)
- **`ws`** — small Node WebSocket relay in `server/room-server.mjs` powering watch parties. In-memory rooms, no persistence.

## Setup

The fastest path is **Local development** below. Use **Docker** when you want a containerized one-command stack for your VPS. The optional **ngrok** subsection covers exposing it on the public internet for a quick watch-party with a friend.

### 1. Configure environment

```bash
cp .env.example .env.local      # for local dev
# cp .env.example .env     # for docker compose
```

Edit the file and set:

| Var | Required | Purpose |
|---|---|---|
| `TMDB_API_KEY` | yes | Free key from https://www.themoviedb.org/settings/api |
| `NEXT_PUBLIC_PROVIDER_ALPHA_*` | for any playback | URL templates for the canonical embed provider |
| `NEXT_PUBLIC_PROVIDER_{BETA,GAMMA,DELTA}_*` | optional | Additional fallback providers |
| `NEXT_PUBLIC_ROOM_WS_URL` | optional | WebSocket URL for watch parties; defaults to `ws://localhost:3001` |
| `ROOM_ALLOWED_ORIGINS` | optional | Origin allowlist for the room server (default `*`) |
| `GIPHY_API_KEY` | optional | Enables the chat GIF picker. Free key from https://developers.giphy.com |

The provider templates use placeholders that get substituted at runtime: `{id}`, `{season}`, `{episode}`, `{startAt}`, `{sub}`. See `.env.example` for the full schema. **Cinemux ships with no embed sources** — `.env.example` has empty slots. A community-maintained default set is available at:

> https://pastebin.com/pP95C0cA

Copy and paste them into your `.env.local` (or `.env`) or fill in your own. Clear any slot's `MOVIE` and `TV` vars to hide it from the source switcher.

### 2. Run it

#### Option A — Local development (npm)

```bash
npm install
npm run dev          # starts Next on :3000 and the room server on :3001
```

Open http://localhost:3000.

To run them separately:

```bash
npm run dev:web      # Next on :3000
npm run dev:room     # Room server on :3001
```

#### Option B — Docker Compose

```bash
docker compose up -d --build
```

Open http://localhost:3000. Stop with `docker compose down`.

| Var | Default | When it applies |
|---|---|---|
| `WEB_PORT` | 3000 | Host port for the web service |
| `ROOM_PORT` | 3001 | Host port for the room service |
| `NEXT_PUBLIC_*` (any) | — | **Build-time.** Changes require `docker compose up --build`. |
| `TMDB_API_KEY`, `GIPHY_API_KEY`, `ROOM_ALLOWED_ORIGINS` | — | **Runtime.** Change in `.env`, just `docker compose up -d`. |

The image runs as non-root `app`. Production deployments should put a reverse proxy with TLS in front, set `NEXT_PUBLIC_ROOM_WS_URL=wss://...`, and replace the `ROOM_ALLOWED_ORIGINS=*` default with explicit domains.

##### Optional: built-in Caddy reverse proxy

Compose ships a Caddy service that puts everything behind a single origin (web at `/`, room WS at `/ws`). Opt in with the `proxy` profile:

```bash
# Local — HTTP only on :80
docker compose --profile proxy up -d --build

# Production with auto Let's Encrypt cert
SITE_ADDRESS=cinemux.example.com docker compose --profile proxy up -d --build
```

| Var | Default | Effect |
|---|---|---|
| `SITE_ADDRESS` | `:80` | Caddy site key. `:80` = HTTP-only, any Host. A real domain → auto-HTTPS. |

When Caddy is in front, point the client at the proxied WebSocket path:

```
NEXT_PUBLIC_ROOM_WS_URL=ws://localhost/ws        # local
NEXT_PUBLIC_ROOM_WS_URL=wss://cinemux.example.com/ws   # prod
```

`NEXT_PUBLIC_*` is build-time, so re-run with `--build` after changing it.

### 3. (Optional) Sharing on the public internet via ngrok

<details>
<summary>Click to expand — quick way to invite someone to a watch party from your laptop</summary>

Both the web app (3000) and the WS relay (3001) need public reachability. There are two ways to do this — pick the one that matches your ngrok plan.

#### Option A — single domain through Caddy (free tier with static `.dev`, recommended)

Free ngrok now gives you **one** reserved `.ngrok-free.dev` domain. Multi-tunnel-on-different-hostnames isn't possible without paying, so route both web and WS through Caddy on port 80 — Caddy serves the app at `/` and proxies the WS at `/ws`, so one domain covers everything.

1. Authtoken once:
   ```
   ngrok config add-authtoken <token>
   ```
2. Set the WS URL to your reserved domain + `/ws` in `.env` (build-time var — must be set *before* the build):
   ```
   NEXT_PUBLIC_ROOM_WS_URL=wss://<your-name>.ngrok-free.dev/ws
   ```
3. Bring up the stack with the `proxy` profile so Caddy is in front:
   ```
   docker compose --profile proxy up -d --build
   ```
4. Tunnel port 80:
   ```
   ngrok http --url=<your-name>.ngrok-free.dev 80
   ```
5. **Open the ngrok URL in your browser** (not `localhost`) — invite links use `window.location.origin`, so the URL your friend gets matches what you opened.

If you change `NEXT_PUBLIC_ROOM_WS_URL` later (e.g. switch domains), re-run step 3 with `--build` so the new value gets baked in.

#### Option B — two tunnels on different hostnames (paid ngrok or random free `.app` URLs)

Use this only if you have a paid plan with multiple reserved domains, or you don't mind URLs changing every restart.

1. Authtoken + config:
   ```
   ngrok config add-authtoken <token>
   ```
2. Edit `%USERPROFILE%\AppData\Local\ngrok\ngrok.yml` (Windows) / `~/.config/ngrok/ngrok.yml` (mac/linux):
   ```yaml
   version: "2"
   tunnels:
     web:
       proto: http
       addr: 3000
     room:
       proto: http
       addr: 3001
   ```
3. `ngrok start --all` → two URLs, e.g. `https://abcd.ngrok-free.dev` (web) and `https://efgh.ngrok-free.dev` (room).
4. Set `NEXT_PUBLIC_ROOM_WS_URL=wss://efgh.ngrok-free.dev` in `.env.local`, restart `npm run dev` (or rebuild if Docker).
5. Open the **web** URL in your browser, not localhost.

For longer-lived tunnels with multiple ingress rules and no "Visit Site" interstitial, **Cloudflare Tunnel** (`cloudflared`) is free.

</details>

## Routes
- `/` — home (spotlight carousel + Popular Movies / Popular TV / Top Rated rows)
- `/movie/[id]` and `/tv/[id]` — detail pages with metadata, cast, similar, IMDb link, trailer modal, and the player
- `/list/[name]` — paginated full lists with genre / year / rating / sort filters (`popular_movies`, `popular_tv`, `top_rated_movies`, `top_rated_tv`)
- `/discover?type=...&genre=...&year=...&keyword=...&person=...&collection=...` — filter by clickable links from the detail page
- `/movie/[id]?room=ABC123` and `/tv/[id]?room=ABC123` — same detail page in watch-party mode

## API
- `/api/tmdb/search` — multi-search
- `/api/tmdb/list?name=...&page=...` — homepage rows; supports `trending`, `popular_movies`, `popular_tv`, `top_rated_movies`, `top_rated_tv`, `upcoming`, `airing_today`, `on_the_air`
- `/api/tmdb/details?type=&id=` — full metadata: cast, crew, keywords, genres, similar, videos, external IDs, season list
- `/api/tmdb/discover` — server-side filtered discovery (`type`, `genre`, `keyword`, `year`, `person`, `collection`, `sort`, `vote_average_gte`, `vote_count_gte`)
- `/api/tmdb/genres?type=` — genre list (cached 24h)
- `/api/tmdb/spotlight` — top trending items enriched with title-treatment logos
- `/api/tmdb/basic?items=movie:123,tv:456` — lightweight per-id `{ year, rating }` lookup, used to fill in Continue-Watching cards

## Source providers (Alpha / Beta / Gamma / Delta)

Each detail page has a **Source** pill row above the player. The four slots — Alpha, Beta, Gamma, Delta — are configured entirely via `NEXT_PUBLIC_PROVIDER_{SLOT}_*` env vars; a slot without `MOVIE` and `TV` templates is hidden. The Alpha slot is treated as the canonical "controllable" provider and is the only one expected to support the watch-party feature and "Continue Watching" — it must be an embed that emits the documented `MEDIA_DATA` / `playerstatus` events and accepts inbound `postMessage({ command: 'play' | 'pause' | 'seek', time })` commands. The other slots are play-only fallbacks.

Selection persists in `localStorage` under `preferred_provider`.

## How playback works

- The iframe URL for a title is built by substituting `{id}`, `{season}`, `{episode}`, `{startAt}`, `{sub}` into the provider template.
- A `window.message` listener filtered to the Alpha provider's origin catches `MEDIA_DATA` events and writes them to `localStorage` under `vidup:progress` (the storage key is historical and does not need to match any specific upstream).
- The home page reads that key to populate "Continue Watching"; the detail page reads it to resume position and (for TV) auto-select the last watched season + episode.
- When the user clicks "Next Episode" inside the embed, the resulting `MEDIA_DATA` updates our Season/Episode dropdowns without reloading the iframe.

## Watch parties

Click **🎬 Start Watch Party** on any detail page. URL becomes `/movie/27205?room=ABC123` and a sidebar opens.

```
host browser  ── WebSocket ──►  room-server.mjs (in-memory)  ◄── WebSocket ── guest browser
       │                                                                          │
       └─ postMessage(play/pause/seek) ◄─ iframe                                   └─ postMessage to iframe
```

- The first joiner becomes host. Host's `PLAYER_EVENT` transitions are detected and broadcast as `play` / `pause` / `seek` actions; every 4s a `sync` event corrects drift.
- Guests apply incoming actions to their iframe via `postMessage({ command: 'play'|'pause'|'seek', time })`.
- Drift tolerance is ±1.5s; below that we don't seek (avoids jitter).
- Watch-party mode forces the provider to **Alpha** because that's the only slot expected to accept inbound commands.
- Host can **Make host** any other member from the sidebar; if the host disconnects, the next-joined member is auto-promoted.
- Chat history (last 50 messages) is replayed to joiners. Display name persists in `localStorage` (`room_display_name`). Rooms evaporate when the last person leaves.

## Notes
- No database. Watch progress is per-browser; rooms are in-memory and evaporate when empty or when the room server restarts.
- Streaming embeds occasionally inject pop-under redirects on click; that behavior originates from the embed, not from this app. Use uBlock Origin.
- Watch-party invite links are semi-secret. Anyone with the code can join. For private viewings, treat them like a meeting link.
