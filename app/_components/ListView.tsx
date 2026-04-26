"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CatalogItem } from "@/lib/catalog";
import { Card } from "./Card";
import { RowSkeleton } from "./Skeletons";

type Defaults = {
  type: "movie" | "tv";
  defaultSort: string;
  voteCountGte?: string;
};

const PRESETS: Record<string, Defaults> = {
  movies: { type: "movie", defaultSort: "popularity.desc" },
  tv: { type: "tv", defaultSort: "popularity.desc" },
  popular_movies: { type: "movie", defaultSort: "popularity.desc" },
  popular_tv: { type: "tv", defaultSort: "popularity.desc" },
  top_rated_movies: { type: "movie", defaultSort: "vote_average.desc", voteCountGte: "300" },
  top_rated_tv: { type: "tv", defaultSort: "vote_average.desc", voteCountGte: "300" },
};

const SORT_OPTIONS_MOVIE = [
  { value: "popularity.desc", label: "Popularity" },
  { value: "vote_average.desc", label: "Highest Rated" },
  { value: "primary_release_date.desc", label: "Newest" },
  { value: "primary_release_date.asc", label: "Oldest" },
];
const SORT_OPTIONS_TV = [
  { value: "popularity.desc", label: "Popularity" },
  { value: "vote_average.desc", label: "Highest Rated" },
  { value: "first_air_date.desc", label: "Newest" },
  { value: "first_air_date.asc", label: "Oldest" },
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 1949 }, (_, i) => CURRENT_YEAR - i);

export function ListView({ name, title }: { name: string; title: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const preset = PRESETS[name] ?? PRESETS.popular_movies;

  const genre = searchParams.get("genre") || "";
  const year = searchParams.get("year") || "";
  const sort = searchParams.get("sort") || preset.defaultSort;
  const minRating = searchParams.get("min_rating") || "";

  const [items, setItems] = useState<CatalogItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [genres, setGenres] = useState<{ id: number; name: string }[]>([]);
  const sentinel = useRef<HTMLDivElement | null>(null);

  // Reset items when filters change.
  const filterKey = `${name}|${genre}|${year}|${sort}|${minRating}`;
  useEffect(() => {
    setItems([]);
    setPage(1);
    setTotalPages(1);
  }, [filterKey]);

  useEffect(() => {
    fetch(`/api/tmdb/genres?type=${preset.type}`)
      .then((r) => r.json())
      .then((j) => setGenres(j.genres || []))
      .catch(() => setGenres([]));
  }, [preset.type]);

  useEffect(() => {
    setLoading(true);
    const url = new URL("/api/tmdb/discover", window.location.origin);
    url.searchParams.set("type", preset.type);
    url.searchParams.set("sort", sort);
    if (minRating) {
      url.searchParams.set("vote_average_gte", minRating);
      url.searchParams.set("vote_count_gte", "100");
    } else if (preset.voteCountGte) {
      url.searchParams.set("vote_count_gte", preset.voteCountGte);
    }
    if (genre) url.searchParams.set("genre", genre);
    if (year) url.searchParams.set("year", year);
    url.searchParams.set("page", String(page));

    fetch(url.toString())
      .then((r) => r.json())
      .then((j) => {
        const incoming: CatalogItem[] = j.results || [];
        setItems((prev) => {
          if (page === 1) return incoming;
          const seen = new Set(prev.map((it) => `${it.type}:${it.id}`));
          return [...prev, ...incoming.filter((it) => !seen.has(`${it.type}:${it.id}`))];
        });
        setTotalPages(j.total_pages ?? 1);
      })
      .finally(() => setLoading(false));
  }, [filterKey, page]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loading && page < totalPages) {
        setPage((p) => p + 1);
      }
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loading, page, totalPages]);

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "sort" && next.get("sort") === preset.defaultSort) next.delete("sort");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const sortOptions = preset.type === "tv" ? SORT_OPTIONS_TV : SORT_OPTIONS_MOVIE;
  const activeFilters = !!(genre || year || minRating || sort !== preset.defaultSort);

  return (
    <main>
      <h2>{title}</h2>

      <div className="filters">
        <div className="filter">
          <label>Genre</label>
          <select value={genre} onChange={(e) => updateFilter("genre", e.target.value)}>
            <option value="">All</option>
            {genres.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>

        <div className="filter">
          <label>Year</label>
          <select value={year} onChange={(e) => updateFilter("year", e.target.value)}>
            <option value="">Any</option>
            {YEARS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div className="filter">
          <label>Min Rating</label>
          <select value={minRating} onChange={(e) => updateFilter("min_rating", e.target.value)}>
            <option value="">Any</option>
            {[9, 8, 7, 6, 5].map((r) => (
              <option key={r} value={r}>★ {r}+</option>
            ))}
          </select>
        </div>

        <div className="filter">
          <label>Sort</label>
          <select value={sort} onChange={(e) => updateFilter("sort", e.target.value)}>
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {activeFilters && (
          <button className="filter-reset" onClick={() => router.replace(pathname, { scroll: false })}>
            Clear
          </button>
        )}
      </div>

      {items.length === 0 && loading ? (
        <RowSkeleton count={18} />
      ) : items.length === 0 ? (
        <div className="empty">No results.</div>
      ) : (
        <div className="row">
          {items.map((it) => <Card key={it.type + it.id} item={it} />)}
        </div>
      )}
      <div ref={sentinel} style={{ height: 1 }} />
      {loading && items.length > 0 && <div className="empty">Loading more…</div>}
    </main>
  );
}
