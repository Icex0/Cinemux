"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CatalogItem } from "@/lib/catalog";

export function Spotlight({ items }: { items: CatalogItem[] }) {
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [loaded, setLoaded] = useState<Set<number>>(() => {
    const s = new Set<number>();
    for (let k = 0; k < Math.min(3, items.length); k++) s.add(k);
    return s;
  });
  const startX = useRef(0);
  const startY = useRef(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const horizontal = useRef<boolean | null>(null);
  const moved = useRef(false);
  const pressed = useRef(false);
  const activePointerId = useRef<number | null>(null);

  const total = items.length;
  const clamp = (i: number) => Math.max(0, Math.min(total - 1, i));

  const onPointerDown = (e: React.PointerEvent) => {
    if (total <= 1) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pressed.current = true;
    activePointerId.current = e.pointerId;
    startX.current = e.clientX;
    startY.current = e.clientY;
    horizontal.current = null;
    moved.current = false;
    // Don't setPointerCapture yet — that retargets clicks away from inner links.
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pressed.current || e.pointerId !== activePointerId.current) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    if (horizontal.current === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      horizontal.current = Math.abs(dx) > Math.abs(dy);
      if (horizontal.current) {
        // We're definitely dragging now — capture the pointer to keep getting
        // events even if the cursor leaves the wrapper.
        moved.current = true;
        setDragging(true);
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }
    }
    if (!horizontal.current) return;
    const w = wrapRef.current?.clientWidth ?? 1;
    const atStart = index === 0;
    const atEnd = index === total - 1;
    let constrained = dx;
    if ((atStart && dx > 0) || (atEnd && dx < 0)) {
      const sign = Math.sign(dx);
      const abs = Math.min(Math.abs(dx), w);
      constrained = sign * 0.35 * w * (1 - 1 / (abs / w + 1));
    }
    setDrag(constrained);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pressed.current = false;
    activePointerId.current = null;
    if (!dragging) {
      horizontal.current = null;
      return;
    }
    setDragging(false);
    const w = wrapRef.current?.clientWidth ?? 1;
    const threshold = w * 0.15;
    let next = index;
    if (drag < -threshold) next = clamp(index + 1);
    else if (drag > threshold) next = clamp(index - 1);
    setIndex(next);
    setDrag(0);
    horizontal.current = null;
  };

  // Suppress click bubbling to the inner Watch button if user dragged.
  const onClickCapture = (e: React.MouseEvent) => {
    if (moved.current) {
      e.preventDefault();
      e.stopPropagation();
      moved.current = false;
    }
  };

  useEffect(() => { if (index >= total) setIndex(0); }, [total, index]);

  useEffect(() => {
    if (total === 0) return;
    setLoaded((prev) => {
      const next = new Set(prev);
      for (let k = 0; k < 3; k++) next.add((index + k) % total);
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [index, total]);

  useEffect(() => {
    if (total <= 1 || dragging) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % total), 10000);
    return () => clearTimeout(t);
  }, [index, total, dragging]);

  if (total === 0) return null;

  const offsetPct = -index * 100;

  return (
    <div
      className="spotlight-wrap"
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={onClickCapture}
    >
      <div
        className={`spot-track ${dragging ? "dragging" : "animating"}`}
        style={{ transform: `translate3d(calc(${offsetPct}% + ${drag}px), 0, 0)` }}
      >
        {items.map((item, i) => (
          <Slide key={String(item.id)} item={item} active={i === index} load={loaded.has(i)} />
        ))}
      </div>
      {total > 1 && (
        <div className="spot-dots">
          {items.map((_, i) => (
            <button
              key={i}
              className={i === index ? "on" : ""}
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Slide({ item, active, load }: { item: CatalogItem; active: boolean; load: boolean }) {
  return (
    <div className="spotlight">
      {load && item.backdrop && (
        <img className={`spot-bg ${active ? "in" : ""}`} src={item.backdrop} alt="" aria-hidden draggable={false} />
      )}
      <div className="spot-shade" />
      <div className="spot-inner">
        <div className="spot-text">
          {load && item.logo ? (
            <img className="spot-logo" src={item.logo} alt={item.title} draggable={false} />
          ) : (
            <h1 className="spot-title">{item.title}</h1>
          )}
          <div className="chips">
            <span className="chip">{item.type === "tv" ? "TV" : "Movie"}</span>
            {item.year && <span className="chip">{item.year}</span>}
            {typeof item.rating === "number" && item.rating > 0 && (
              <span className="chip rating"><span className="star" />{item.rating.toFixed(1)}</span>
            )}
          </div>
          {item.overview && <p className="spot-overview">{item.overview}</p>}
          <div className="actions">
            <Link className="btn btn-lg" href={`/${item.type}/${item.id}`}>
              ▶ Watch Now
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
