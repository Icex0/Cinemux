"use client";

import { useEffect, useMemo, useState } from "react";
import { CATALOG, type CatalogItem, progressKey } from "@/lib/catalog";
import { Card } from "./Card";
import Link from "next/link";
import { Spotlight } from "./Spotlight";
import { RowSkeleton, SpotlightSkeleton } from "./Skeletons";
import { deleteProgressEntry, readProgress, type ProgressMap } from "./progress";

const ROWS: { name: string; title: string; seeAll?: boolean }[] = [
  { name: "popular_movies", title: "Popular Movies", seeAll: true },
  { name: "popular_tv", title: "Popular TV", seeAll: true },
  { name: "top_rated_movies", title: "Top Rated Movies", seeAll: true },
  { name: "top_rated_tv", title: "Top Rated TV", seeAll: true },
];

export function Home() {
  const [progress, setProgress] = useState<ProgressMap>({});
  const [lists, setLists] = useState<Record<string, CatalogItem[]>>({});
  const [spotlightItems, setSpotlightItems] = useState<CatalogItem[] | null>(null);
  const [basicById, setBasicById] = useState<Record<string, { year?: string; rating?: number }>>({});

  useEffect(() => { setProgress(readProgress()); }, []);

  useEffect(() => {
    fetch("/api/tmdb/spotlight")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setSpotlightItems(j?.results ?? []))
      .catch(() => setSpotlightItems([]));
  }, []);

  useEffect(() => {
    for (const row of ROWS) {
      fetch(`/api/tmdb/list?name=${row.name}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((j) => setLists((prev) => ({ ...prev, [row.name]: (j.results || []) as CatalogItem[] })))
        .catch(() => setLists((prev) => ({ ...prev, [row.name]: [] })));
    }
  }, []);

  const continueWatching = useMemo(() => {
    return Object.values(progress)
      .filter((p: any) => p?.progress?.watched > 5)
      .sort((a: any, b: any) => (b.last_updated || 0) - (a.last_updated || 0))
      .map((p: any): CatalogItem => {
        const key = `${p.type}:${p.id}`;
        const enriched = basicById[key];
        const inCatalog = CATALOG.find((c) => String(c.id) === String(p.id) && c.type === p.type);
        const base = inCatalog || {
          id: p.id, type: p.type, title: p.title || String(p.id),
          poster: p.poster_path ? `https://image.tmdb.org/t/p/w342${p.poster_path}` : null,
        };
        return { ...base, ...(enriched || {}) };
      });
  }, [progress, basicById]);

  // Fetch year + rating for Continue-Watching items (MEDIA_DATA doesn't carry them).
  useEffect(() => {
    const keys = Object.values(progress)
      .filter((p: any) => p?.progress?.watched > 5)
      .map((p: any) => `${p.type}:${p.id}`);
    const missing = keys.filter((k) => !(k in basicById));
    if (missing.length === 0) return;
    fetch(`/api/tmdb/basic?items=${encodeURIComponent(missing.join(","))}`)
      .then((r) => (r.ok ? r.json() : { items: {} }))
      .then((j) => setBasicById((prev) => ({ ...prev, ...(j.items || {}) })))
      .catch(() => {});
  }, [progress]);

  return (
    <>
      {spotlightItems === null
        ? <SpotlightSkeleton />
        : spotlightItems.length > 0 && <Spotlight items={spotlightItems} />}
      <main>
        {continueWatching.length > 0 && (
          <section>
            <h2>Continue Watching</h2>
            <div className="row">
              {continueWatching.map((it) => (
                <Card
                  key={it.type + it.id}
                  item={it}
                  savedProgress={progress[progressKey(it)]}
                  onDelete={(target) => {
                    deleteProgressEntry(progressKey(target));
                    setProgress(readProgress());
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {ROWS.map((row) => {
          const loaded = row.name in lists;
          if (!loaded) {
            return (
              <section key={row.name}>
                <RowHead title={row.title} seeAllHref={row.seeAll ? `/list/${row.name}` : undefined} />
                <RowSkeleton />
              </section>
            );
          }
          const items = lists[row.name] ?? [];
          if (items.length === 0) return null;
          return (
            <section key={row.name}>
              <RowHead title={row.title} seeAllHref={row.seeAll ? `/list/${row.name}` : undefined} />
              <div className="row">
                {items.slice(0, 18).map((it) => (
                  <Card key={it.type + it.id} item={it} savedProgress={progress[progressKey(it)]} />
                ))}
              </div>
            </section>
          );
        })}
      </main>
    </>
  );
}

function RowHead({ title, seeAllHref }: { title: string; seeAllHref?: string }) {
  if (!seeAllHref) return <h2>{title}</h2>;
  return (
    <div className="row-head">
      <h2>{title}</h2>
      <Link className="see-all" href={seeAllHref}>See all →</Link>
    </div>
  );
}
