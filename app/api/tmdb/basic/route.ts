import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 3600;

// Lightweight per-id lookup: returns just year + rating for a list of items.
// Used by the home page to fill in Continue-Watching cards (which are seeded
// from vidup MEDIA_DATA in localStorage and don't have those fields).
// Query: ?items=movie:27205,tv:1399
export async function GET(req: Request) {
  const key = process.env.TMDB_API_KEY;
  if (!key) return NextResponse.json({ items: {} }, { status: 501 });

  const { searchParams } = new URL(req.url);
  const requested = (searchParams.get("items") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^(movie|tv):\d+$/.test(s))
    .slice(0, 30);

  const entries = await Promise.all(requested.map(async (entry) => {
    const [type, id] = entry.split(":");
    const url = new URL(`https://api.themoviedb.org/3/${type}/${id}`);
    url.searchParams.set("api_key", key);
    try {
      const r = await fetch(url, { next: { revalidate: 86400 } });
      if (!r.ok) return [entry, null] as const;
      const j: any = await r.json();
      return [entry, {
        year: ((j.release_date || j.first_air_date) as string | undefined)?.slice(0, 4),
        rating: typeof j.vote_average === "number" ? Math.round(j.vote_average * 10) / 10 : undefined,
      }] as const;
    } catch {
      return [entry, null] as const;
    }
  }));

  const items: Record<string, { year?: string; rating?: number }> = {};
  for (const [k, v] of entries) if (v) items[k] = v;
  return NextResponse.json({ items });
}
