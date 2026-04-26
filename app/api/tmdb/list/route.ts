import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 3600;

const IMG = (p: string | null | undefined, size = "w342") =>
  p ? `https://image.tmdb.org/t/p/${size}${p}` : null;

const ENDPOINTS: Record<string, { path: string; defaultType: "movie" | "tv" | "mixed" }> = {
  trending: { path: "/trending/all/week", defaultType: "mixed" },
  popular_movies: { path: "/movie/popular", defaultType: "movie" },
  popular_tv: { path: "/tv/popular", defaultType: "tv" },
  top_rated_movies: { path: "/movie/top_rated", defaultType: "movie" },
  top_rated_tv: { path: "/tv/top_rated", defaultType: "tv" },
  now_playing: { path: "/movie/now_playing", defaultType: "movie" },
  upcoming: { path: "/movie/upcoming", defaultType: "movie" },
  airing_today: { path: "/tv/airing_today", defaultType: "tv" },
  on_the_air: { path: "/tv/on_the_air", defaultType: "tv" },
};

export async function GET(req: Request) {
  const key = process.env.TMDB_API_KEY;
  if (!key) return NextResponse.json({ error: "TMDB_API_KEY not set", results: [] }, { status: 501 });

  const { searchParams } = new URL(req.url);
  const name = searchParams.get("name") ?? "trending";
  const ep = ENDPOINTS[name];
  if (!ep) return NextResponse.json({ error: "unknown list", results: [] }, { status: 400 });

  const page = searchParams.get("page") || "1";
  const url = new URL(`https://api.themoviedb.org/3${ep.path}`);
  url.searchParams.set("api_key", key);
  url.searchParams.set("page", page);

  const r = await fetch(url, { next: { revalidate: 3600 } });
  if (!r.ok) return NextResponse.json({ error: "tmdb failed", results: [] }, { status: 502 });
  const j: any = await r.json();

  const results = (j.results ?? [])
    .filter((m: any) => {
      if (ep.defaultType === "mixed") return m.media_type === "movie" || m.media_type === "tv";
      return true;
    })
    .map((m: any) => ({
      id: m.id,
      type: (ep.defaultType === "mixed" ? m.media_type : ep.defaultType) as "movie" | "tv",
      title: m.title || m.name,
      year: ((m.release_date || m.first_air_date) as string | undefined)?.slice(0, 4),
      poster: IMG(m.poster_path),
      backdrop: IMG(m.backdrop_path, "w1280"),
      overview: m.overview || null,
      rating: typeof m.vote_average === "number" ? Math.round(m.vote_average * 10) / 10 : undefined,
    }));

  return NextResponse.json({ results, total_pages: j.total_pages ?? 1, page: Number(page) });
}
