"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CatalogItem } from "@/lib/catalog";

export function Header() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogItem[]>([]);
  const debounceRef = useRef<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); return; }
    debounceRef.current = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/tmdb/search?q=${encodeURIComponent(query)}`);
        const j = await r.json();
        setResults(j.results || []);
        setOpen(true);
      } catch { /* ignore */ }
    }, 300);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [query]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const isNumericId = /^\d+$/.test(query.trim());

  const go = (href: string) => {
    setQuery("");
    setResults([]);
    setOpen(false);
    router.push(href);
  };

  return (
    <header className={scrolled ? "scrolled" : ""}>
      <Link href="/" className="logo"><h1>Cine<span>mux</span></h1></Link>
      <nav className="header-nav">
        <Link href="/list/movies">Movies</Link>
        <Link href="/list/tv">Shows</Link>
      </nav>
      <div className="search dropdown" ref={wrapRef}>
        <input
          placeholder="Search movies & TV, or paste an ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
        />
        {open && (results.length > 0 || isNumericId) && (
          <div className="results">
            {isNumericId && (
              <>
                <div className="result" onClick={() => go(`/movie/${query.trim()}`)}>
                  <div className="id-badge">M</div>
                  <div>
                    <div style={{ fontWeight: 600 }}>Open as Movie</div>
                    <div className="sub">ID {query.trim()}</div>
                  </div>
                </div>
                <div className="result" onClick={() => go(`/tv/${query.trim()}`)}>
                  <div className="id-badge">T</div>
                  <div>
                    <div style={{ fontWeight: 600 }}>Open as TV</div>
                    <div className="sub">ID {query.trim()}</div>
                  </div>
                </div>
              </>
            )}
            {results.map((r) => (
              <div key={r.type + r.id} className="result" onClick={() => go(`/${r.type}/${r.id}`)}>
                {r.poster ? <img src={r.poster} alt="" /> : <div style={{ width: 36, height: 54, background: "var(--panel-2)" }} />}
                <div>
                  <div style={{ fontWeight: 600 }}>{r.title}</div>
                  <div className="sub">{r.type === "tv" ? "TV" : "Movie"} · {r.year || "—"}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
