import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 3600;

export async function GET(req: Request) {
  const key = process.env.TMDB_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "TMDB_API_KEY not set", results: [] }, { status: 501 });
  }
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ results: [] });

  const url = new URL("https://api.themoviedb.org/3/search/multi");
  url.searchParams.set("api_key", key);
  url.searchParams.set("query", q);
  url.searchParams.set("include_adult", "false");

  const r = await fetch(url, { next: { revalidate: 3600 } });
  if (!r.ok) return NextResponse.json({ error: "tmdb failed", results: [] }, { status: 502 });
  const json = (await r.json()) as { results: Array<Record<string, unknown>> };

  const results = (json.results ?? [])
    .filter((m) => m.media_type === "movie" || m.media_type === "tv")
    .slice(0, 20)
    .map((m: any) => ({
      id: m.id as number,
      type: m.media_type as "movie" | "tv",
      title: (m.title || m.name) as string,
      year: ((m.release_date || m.first_air_date) as string | undefined)?.slice(0, 4),
      poster: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
      rating: typeof m.vote_average === "number" ? Math.round(m.vote_average * 10) / 10 : undefined,
    }));

  return NextResponse.json({ results });
}
