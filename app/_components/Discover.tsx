"use client";

import { useEffect, useState } from "react";
import type { CatalogItem } from "@/lib/catalog";
import { Card } from "./Card";

export function Discover({ params }: { params: Record<string, string> }) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState<string | null>(null);

  const type = params.type === "tv" ? "tv" : "movie";

  useEffect(() => {
    setLoading(true);
    const sp = new URLSearchParams(params).toString();
    fetch(`/api/tmdb/discover?${sp}`)
      .then((r) => r.json())
      .then((j) => { setItems(j.results || []); setName(j.name || null); })
      .finally(() => setLoading(false));
  }, [JSON.stringify(params)]);

  const heading = (() => {
    if (name) return name;
    if (params.year) return `${type === "tv" ? "TV" : "Movies"} from ${params.year}`;
    if (params.genre) return `${type === "tv" ? "TV" : "Movies"} · Genre`;
    if (params.keyword) return `${type === "tv" ? "TV" : "Movies"} · Keyword`;
    if (params.person) return `${type === "tv" ? "TV" : "Movies"} · Person`;
    return "Discover";
  })();

  return (
    <main>
      <h2>{heading}</h2>
      {loading && items.length === 0 ? (
        <div className="empty">Loading…</div>
      ) : items.length === 0 ? (
        <div className="empty">No results.</div>
      ) : (
        <div className="row">
          {items.map((it) => <Card key={it.type + it.id} item={it} />)}
        </div>
      )}
    </main>
  );
}
