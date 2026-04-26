"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { progressKey, type CatalogItem } from "@/lib/catalog";
import { PROVIDERS, DEFAULT_PROVIDER, PROVIDER_STORAGE_KEY, ALPHA_PROVIDER, getProvider } from "@/lib/providers";
import { newRoomCode } from "@/lib/room";
import { Card } from "./Card";
import { readProgress, writeProgressEntries } from "./progress";
import { Room } from "./Room";

type IdName = { id: number; name: string };

type Details = {
  id: number | string;
  type: "movie" | "tv";
  title: string;
  tagline: string | null;
  overview: string | null;
  backdrop: string | null;
  poster: string | null;
  year?: string;
  rating?: number;
  runtime: number | null;
  certificate: string | null;
  genres: IdName[];
  countries: string[];
  languages: string[];
  keywords: IdName[];
  collection: { id: number; name: string } | null;
  cast: { id: number; name: string; character: string; profile: string | null }[];
  credits: { directors: IdName[]; creators: IdName[] };
  similar: CatalogItem[];
  trailer: { key: string; name: string } | null;
  imdbId: string | null;
  seasons: number | null;
  seasonList: { season_number: number; episode_count: number; name: string }[];
};

export function Detail({ type, id }: { type: "movie" | "tv"; id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const roomCode = searchParams.get("room");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const [details, setDetails] = useState<Details | null>(null);
  const [showTrailer, setShowTrailer] = useState(false);
  // Display state — what the dropdown shows, kept in sync with whatever the player is playing.
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  // What the iframe was loaded with. Only updated when the user picks via dropdown,
  // so player-emitted episode changes don't reload the iframe.
  const [loaded, setLoaded] = useState<{ s: number; e: number; startAt: number; sub: string } | null>(null);
  const [providerId, setProviderId] = useState<string>(DEFAULT_PROVIDER);
  // Used to skip the URL→state effect when WE were the ones who just wrote to the URL,
  // so a host's in-iframe "Next Episode" doesn't trigger a self-reload.
  const localUrlUpdate = useRef(false);
  // Tracks whether the iframe is on its first load (don't autoplay) vs a subsequent reload (do autoplay).
  const loadedCountRef = useRef(0);
  const sParam = searchParams.get("s");
  const eParam = searchParams.get("e");

  useEffect(() => {
    if (roomCode && ALPHA_PROVIDER) { setProviderId(ALPHA_PROVIDER.id); return; }
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(PROVIDER_STORAGE_KEY) : null;
    if (stored && PROVIDERS.some((p) => p.id === stored)) setProviderId(stored);
  }, [roomCode]);

  const pickProvider = (id: string) => {
    setProviderId(id);
    try { window.localStorage.setItem(PROVIDER_STORAGE_KEY, id); } catch { /* ignore */ }
  };

  useEffect(() => {
    const saved = readProgress()[(type === "tv" ? "t" : "m") + id];
    const startAt = saved?.progress?.watched ? Math.floor(saved.progress.watched) : 0;
    let s = 1, e = 1;
    let fromUrl = false;
    if (type === "tv") {
      const urlS = Number(sParam);
      const urlE = Number(eParam);
      if (urlS && urlE) {
        s = urlS; e = urlE; fromUrl = true;
      } else if (saved?.last_season_watched) {
        s = saved.last_season_watched;
        e = saved.last_episode_watched || 1;
      }
    }
    setSeason(s);
    setEpisode(e);
    setLoaded({ s, e, startAt: fromUrl ? 0 : startAt, sub: "en" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, type]);

  // URL → state. Drives guests when host changes episode (router.replace from Room).
  useEffect(() => {
    if (type !== "tv") return;
    if (localUrlUpdate.current) { localUrlUpdate.current = false; return; }
    const s = Number(sParam);
    const e = Number(eParam);
    if (!s || !e) return;
    setSeason(s);
    setEpisode(e);
    setLoaded((prev) => prev && prev.s === s && prev.e === e ? prev : { s, e, startAt: 0, sub: prev?.sub ?? "en" });
  }, [sParam, eParam, type]);

  // state → URL. Keeps URL in sync with whatever's playing so deep links + watch-party joiners land on the right episode.
  useEffect(() => {
    if (type !== "tv" || !loaded) return;
    if (sParam === String(season) && eParam === String(episode)) return;
    localUrlUpdate.current = true;
    const sp = new URLSearchParams(searchParams.toString());
    const room = sp.get("room");
    sp.delete("room");
    sp.set("s", String(season));
    sp.set("e", String(episode));
    if (room) sp.set("room", room);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, episode, type]);

  useEffect(() => {
    setDetails(null);
    let cancel = false;
    fetch(`/api/tmdb/details?type=${type}&id=${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancel && j && !j.error) setDetails(j); })
      .catch(() => {});
    return () => { cancel = true; };
  }, [id, type]);

  const provider = useMemo(() => getProvider(providerId), [providerId]);
  const src = useMemo(() => {
    if (!loaded || !provider) return "";
    const opts = { startAt: loaded.startAt, sub: loaded.sub };
    const base = type === "tv" ? provider.tvUrl(id, loaded.s, loaded.e, opts) : provider.movieUrl(id, opts);
    // Append autoPlay=true on subsequent loads (user picked a new episode/provider, or guest got a remote change)
    // and always when in a watch party. The very first load on a fresh detail page is left alone.
    const wantAutoplay = (loadedCountRef.current > 0 || !!roomCode) && providerId === ALPHA_PROVIDER?.id;
    if (!wantAutoplay) return base;
    return base + (base.includes("?") ? "&" : "?") + "autoPlay=true";
  }, [type, id, loaded, provider, providerId, roomCode]);

  // The Alpha provider is the only one expected to emit MEDIA_DATA.
  const alphaOrigin = ALPHA_PROVIDER?.origin || "";
  useEffect(() => {
    function onMsg({ origin, data }: MessageEvent<any>) {
      if (!alphaOrigin || origin !== alphaOrigin || !data) return;
      if (data.type === "MEDIA_DATA") {
        writeProgressEntries(data.data);
        // Sync dropdown with whatever the player is now showing (e.g. user clicked Next Episode in the iframe).
        const entry = data.data?.[(type === "tv" ? "t" : "m") + id];
        if (entry && type === "tv") {
          const newS = entry.last_season_watched;
          const newE = entry.last_episode_watched;
          // If the iframe internally advanced to a different episode, vidup doesn't autoplay — kick it off.
          if (newS && newE && (newS !== season || newE !== episode)) {
            iframeRef.current?.contentWindow?.postMessage({ command: "play" }, alphaOrigin);
          }
          if (newS) setSeason(newS);
          if (newE) setEpisode(newE);
        }
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [id, type, season, episode, alphaOrigin]);

  const onSeasonPicked = (s: number) => {
    setSeason(s);
    setEpisode(1);
    setLoaded({ s, e: 1, startAt: 0, sub: loaded?.sub ?? "en" });
  };
  const onEpisodePicked = (e: number) => {
    setEpisode(e);
    setLoaded((prev) => prev ? { ...prev, s: season, e, startAt: 0 } : prev);
  };
  const goToEpisode = (s: number, e: number) => {
    setSeason(s);
    setEpisode(e);
    setLoaded((prev) => prev ? { ...prev, s, e, startAt: 0 } : { s, e, startAt: 0, sub: "en" });
  };
  const stepEpisode = (delta: 1 | -1) => {
    if (!details?.seasonList?.length) return;
    const list = details.seasonList;
    const idx = list.findIndex((sn) => sn.season_number === season);
    const cur = idx === -1 ? list[0] : list[idx];
    const epCount = cur?.episode_count ?? 1;
    if (delta === 1) {
      if (episode < epCount) goToEpisode(season, episode + 1);
      else if (idx >= 0 && idx < list.length - 1) goToEpisode(list[idx + 1].season_number, 1);
    } else {
      if (episode > 1) goToEpisode(season, episode - 1);
      else if (idx > 0) {
        const prev = list[idx - 1];
        goToEpisode(prev.season_number, prev.episode_count || 1);
      }
    }
  };
  const canPrev = (() => {
    if (type !== "tv" || !details?.seasonList?.length) return false;
    const list = details.seasonList;
    const idx = list.findIndex((sn) => sn.season_number === season);
    return episode > 1 || idx > 0;
  })();
  const canNext = (() => {
    if (type !== "tv" || !details?.seasonList?.length) return false;
    const list = details.seasonList;
    const idx = list.findIndex((sn) => sn.season_number === season);
    if (idx === -1) return false;
    const epCount = list[idx]?.episode_count ?? 1;
    return episode < epCount || idx < list.length - 1;
  })();

  const title = details?.title || `${type === "tv" ? "TV" : "Movie"} · ${id}`;
  const year = details?.year;
  const rating = details?.rating;
  const runtimeText = details?.runtime ? `${Math.floor(details.runtime / 60)}h ${details.runtime % 60}m` : null;

  const dlink = (params: Record<string, string | number>) => {
    const sp = new URLSearchParams({ type, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
    return `/discover?${sp.toString()}`;
  };

  if (!details) {
    return <DetailSkeleton type={type} />;
  }

  return (
    <div className="detail">
      <div className="hero" style={details.backdrop ? { backgroundImage: `url(${details.backdrop})` } : undefined}>
        <div className="hero-shade" />
        <div className="hero-inner">
          <div className="hero-grid">
            <div className="hero-poster">
              {details.poster
                ? <img src={details.poster} alt={title} />
                : <div className="placeholder">{title}</div>}
            </div>

            <div className="hero-text">
              <h1>{title}</h1>
              {details.tagline && <div className="tagline">{details.tagline}</div>}

              <div className="chips">
                {details.certificate && <span className="chip">{details.certificate}</span>}
                {year && <span className="chip">{year}</span>}
                {runtimeText && <span className="chip">{runtimeText}</span>}
                {type === "tv" && details.seasons && <span className="chip">{details.seasons} season{details.seasons === 1 ? "" : "s"}</span>}
                {typeof rating === "number" && rating > 0 && (
                  <span className="chip rating"><span className="star">★</span>{rating.toFixed(1)}</span>
                )}
              </div>

              {details.overview && <p className="overview">{details.overview}</p>}

              <div className="actions">
                {details.trailer && (
                  <button className="ghost btn-lg" onClick={() => setShowTrailer(true)}>
                    ▶ Trailer
                  </button>
                )}
                {!roomCode && (
                  <button
                    className="ghost btn-lg"
                    onClick={() => {
                      const code = newRoomCode();
                      const sp = new URLSearchParams(searchParams.toString());
                      sp.set("room", code);
                      router.push(`${pathname}?${sp.toString()}`);
                    }}
                  >
                    🎬 Start Watch Party
                  </button>
                )}
                {details.imdbId && (
                  <a className="imdb-link" href={`https://www.imdb.com/title/${details.imdbId}`} target="_blank" rel="noopener noreferrer">
                    <span className="imdb-badge">IMDb</span>
                  </a>
                )}
              </div>

              {type === "tv" && details.seasonList.length > 0 && (
                <SeasonPicker
                  seasonList={details.seasonList}
                  season={season}
                  episode={episode}
                  onSeason={onSeasonPicked}
                  onEpisode={onEpisodePicked}
                  onPrev={() => stepEpisode(-1)}
                  onNext={() => stepEpisode(1)}
                  canPrev={canPrev}
                  canNext={canNext}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {!src && PROVIDERS.length === 0 && (
        <div className="player-section">
          <div className="empty" style={{ textAlign: "center", padding: 40 }}>
            No embed providers configured. Set <code>NEXT_PUBLIC_PROVIDER_*</code> env vars and restart. See README.
          </div>
        </div>
      )}
      {src && (
        <div className="player-section">
          {!roomCode && (
            <div className="provider-bar">
              <span className="provider-label">Source</span>
              <div className="provider-pills">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    className={`provider-pill ${p.id === providerId ? "on" : ""}`}
                    onClick={() => pickProvider(p.id)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className={`player-wrap ${roomCode ? "in-room" : ""}`}>
            <iframe
              ref={iframeRef}
              key={providerId + ":" + src}
              src={src}
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen
              referrerPolicy="no-referrer"
              onLoad={() => { loadedCountRef.current += 1; }}
            />
            {roomCode && (
              <Room
                roomCode={roomCode}
                mediaUrl={(() => {
                  const sp = new URLSearchParams();
                  if (type === "tv") {
                    sp.set("s", String(season));
                    sp.set("e", String(episode));
                  }
                  sp.set("room", roomCode);
                  return `${pathname}?${sp.toString()}`;
                })()}
                iframeRef={iframeRef}
                onLeave={() => {
                  const sp = new URLSearchParams(searchParams.toString());
                  sp.delete("room");
                  router.replace(sp.toString() ? `${pathname}?${sp.toString()}` : pathname);
                }}
              />
            )}
          </div>
        </div>
      )}

      {showTrailer && details?.trailer && (
        <div className="modal" onClick={() => setShowTrailer(false)}>
          <div className="modal-frame" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowTrailer(false)} aria-label="Close">×</button>
            <iframe
              src={`https://www.youtube.com/embed/${details.trailer.key}?autoplay=1`}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
          </div>
        </div>
      )}

      <div className="detail-body">
        {(
          <>
            <section className="info-grid">
              {year && (
                <Info label="Year" value={<Link className="lk" href={dlink({ year })}>{year}</Link>} />
              )}
              {details.certificate && <Info label="Certificate" value={details.certificate} />}
              {details.countries.length > 0 && <Info label="Country" value={details.countries.join(", ")} />}
              {details.languages.length > 0 && <Info label="Language" value={details.languages.join(", ")} />}
              {details.genres.length > 0 && (
                <Info label="Genre" value={
                  <span className="lk-list">
                    {details.genres.map((g, i) => (
                      <span key={g.id}>
                        <Link className="lk" href={dlink({ genre: g.id })}>{g.name}</Link>
                        {i < details.genres.length - 1 && <span className="sep"> | </span>}
                      </span>
                    ))}
                  </span>
                } />
              )}
              {details.keywords.length > 0 && (
                <Info label="Keywords" value={
                  <span className="kw">
                    {details.keywords.slice(0, 12).map((k) => (
                      <Link key={k.id} className="kw-tag" href={dlink({ keyword: k.id })}>#{k.name}</Link>
                    ))}
                  </span>
                } />
              )}
              {details.collection && (
                <Info label="Collection" value={
                  <Link className="lk" href={`/discover?type=movie&collection=${details.collection.id}`}>{details.collection.name}</Link>
                } />
              )}
              {(details.credits.directors.length > 0 || details.credits.creators.length > 0) && (
                <Info
                  label={details.credits.directors.length ? "Director" : "Created by"}
                  value={
                    <span className="lk-list">
                      {(details.credits.directors.length ? details.credits.directors : details.credits.creators).map((p, i, arr) => (
                        <span key={p.id}>
                          <Link className="lk" href={dlink({ person: p.id })}>{p.name}</Link>
                          {i < arr.length - 1 && <span className="sep">, </span>}
                        </span>
                      ))}
                    </span>
                  }
                />
              )}
            </section>

            {details.cast.length > 0 && (
              <section>
                <h2>Cast</h2>
                <div className="cast-row">
                  {details.cast.map((c) => (
                    <Link className="cast" key={c.id} href={dlink({ person: c.id })}>
                      <div className="cast-img">
                        {c.profile ? <img src={c.profile} alt={c.name} /> : <div className="placeholder">{c.name}</div>}
                      </div>
                      <div className="cast-name">{c.name}</div>
                      <div className="cast-role">{c.character}</div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {details.similar.length > 0 && (
              <section>
                <h2>Similar {type === "tv" ? "Shows" : "Movies"}</h2>
                <div className="row">
                  {details.similar.map((it) => (
                    <Card key={it.type + it.id} item={it} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DetailSkeleton({ type }: { type: "movie" | "tv" }) {
  return (
    <div className="detail">
      <div className="hero hero-skel">
        <div className="hero-shade" />
        <div className="hero-inner">
          <div className="hero-grid">
            <div className="hero-poster"><div className="sk sk-fill" /></div>
            <div className="hero-text">
              <div className="sk sk-title" />
              <div className="sk sk-tagline" />
              <div className="chips">
                <div className="sk sk-chip" />
                <div className="sk sk-chip" style={{ width: 56 }} />
                <div className="sk sk-chip" style={{ width: 72 }} />
                <div className="sk sk-chip" style={{ width: 60 }} />
              </div>
              <div className="sk sk-line" />
              <div className="sk sk-line" />
              <div className="sk sk-line" style={{ width: "60%" }} />
              <div className="actions" style={{ marginTop: 20 }}>
                <div className="sk sk-btn" />
                <div className="sk sk-btn sk-btn-ghost" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="detail-body">
        <section className="info-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div className="info" key={i}>
              <div className="sk sk-label" />
              <div className="sk sk-line" style={{ width: "70%" }} />
            </div>
          ))}
        </section>
        <section>
          <div className="sk sk-h2" />
          <div className="cast-row">
            {Array.from({ length: 8 }).map((_, i) => (
              <div className="cast" key={i}>
                <div className="cast-img"><div className="sk sk-fill" /></div>
                <div className="sk sk-line" style={{ width: "80%", height: 12 }} />
                <div className="sk sk-line" style={{ width: "55%", height: 11, marginTop: 4 }} />
              </div>
            ))}
          </div>
        </section>
        <section>
          <div className="sk sk-h2" />
          <div className="row">
            {Array.from({ length: 7 }).map((_, i) => (
              <div className="card" key={i}>
                <div className="poster"><div className="sk sk-fill" /></div>
                <div className="meta"><div className="sk sk-line" style={{ width: "75%" }} /></div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function SeasonPicker({
  seasonList, season, episode, onSeason, onEpisode, onPrev, onNext, canPrev, canNext,
}: {
  seasonList: { season_number: number; episode_count: number; name: string }[];
  season: number;
  episode: number;
  onSeason: (s: number) => void;
  onEpisode: (e: number) => void;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
}) {
  const current = seasonList.find((s) => s.season_number === season) ?? seasonList[0];
  const epCount = current?.episode_count ?? 1;
  return (
    <div className="se-picker">
      <div className="se-field">
        <label>Season</label>
        <select value={season} onChange={(e) => onSeason(Number(e.target.value))}>
          {seasonList.map((s) => (
            <option key={s.season_number} value={s.season_number}>
              {s.name || `Season ${s.season_number}`}
            </option>
          ))}
        </select>
      </div>
      <div className="se-field">
        <label>Episode</label>
        <select value={episode} onChange={(e) => onEpisode(Number(e.target.value))}>
          {Array.from({ length: epCount }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>Episode {n}</option>
          ))}
        </select>
      </div>
      <div className="se-step">
        <button type="button" className="ghost-sm" onClick={onPrev} disabled={!canPrev} aria-label="Previous episode" title="Previous episode">‹ Prev</button>
        <button type="button" className="ghost-sm" onClick={onNext} disabled={!canNext} aria-label="Next episode" title="Next episode">Next ›</button>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="info">
      <div className="info-label">{label}</div>
      <div className="info-value">{value}</div>
    </div>
  );
}
