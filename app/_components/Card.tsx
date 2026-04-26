"use client";
import Link from "next/link";
import type { CatalogItem } from "@/lib/catalog";

export function Card({
  item,
  savedProgress,
  onDelete,
}: {
  item: CatalogItem;
  savedProgress?: any;
  onDelete?: (item: CatalogItem) => void;
}) {
  const pct = savedProgress?.progress?.duration
    ? Math.min(100, (savedProgress.progress.watched / savedProgress.progress.duration) * 100)
    : 0;
  return (
    <Link className="card" href={`/${item.type}/${item.id}`}>
      <div className="poster">
        {item.poster
          ? <img src={item.poster} alt={item.title} loading="lazy" />
          : <div className="placeholder">{item.title}</div>}
        {onDelete && (
          <button
            className="card-delete"
            aria-label={`Remove ${item.title} from Continue Watching`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(item); }}
          >
            ×
          </button>
        )}
        <div className="poster-foot">
          <span>{item.year || "—"}</span>
          {typeof item.rating === "number" && item.rating > 0 && (
            <span><span className="star">★</span>{item.rating.toFixed(1)}</span>
          )}
        </div>
        {pct > 0 && <div className="progress"><div style={{ width: `${pct}%` }} /></div>}
      </div>
      <div className="meta">
        <div className="title">{item.title}</div>
      </div>
    </Link>
  );
}
