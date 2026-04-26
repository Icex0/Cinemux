import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 3600;

const IMG = (path: string | null | undefined, size = "w342") =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;

export async function GET(req: Request) {
  const key = process.env.TMDB_API_KEY;
  if (!key) return NextResponse.json({ error: "TMDB_API_KEY not set", results: [] }, { status: 501 });

  const { searchParams } = new URL(req.url);
  const type = (searchParams.get("type") === "tv" ? "tv" : "movie") as "movie" | "tv";
  const genre = searchParams.get("genre");
  const keyword = searchParams.get("keyword");
  const year = searchParams.get("year");
  const person = searchParams.get("person");
  const collection = searchParams.get("collection");
  const sort = searchParams.get("sort") || "popularity.desc";
  const voteCountGte = searchParams.get("vote_count_gte");
  const voteAverageGte = searchParams.get("vote_average_gte");
  const page = searchParams.get("page") || "1";

  const url = new URL(`https://api.themoviedb.org/3/discover/${type}`);
  url.searchParams.set("api_key", key);
  url.searchParams.set("include_adult", "false");
  url.searchParams.set("sort_by", sort);
  url.searchParams.set("page", page);
  if (voteCountGte) url.searchParams.set("vote_count.gte", voteCountGte);
  if (voteAverageGte) url.searchParams.set("vote_average.gte", voteAverageGte);
  if (genre) url.searchParams.set("with_genres", genre);
  if (keyword) url.searchParams.set("with_keywords", keyword);
  if (person) url.searchParams.set("with_people", person);
  if (year) {
    if (type === "movie") url.searchParams.set("primary_release_year", year);
    else url.searchParams.set("first_air_date_year", year);
  }

  // Collections aren't a discover filter — fetch the collection directly.
  if (collection) {
    const cu = new URL(`https://api.themoviedb.org/3/collection/${collection}`);
    cu.searchParams.set("api_key", key);
    const cr = await fetch(cu, { next: { revalidate: 3600 } });
    if (!cr.ok) return NextResponse.json({ results: [] }, { status: 502 });
    const cj: any = await cr.json();
    const results = (cj.parts ?? [])
      .filter((m: any) => m.poster_path)
      .map((m: any) => ({
        id: m.id, type: "movie",
        title: m.title || m.name,
        year: ((m.release_date || m.first_air_date) as string | undefined)?.slice(0, 4),
        poster: IMG(m.poster_path),
        rating: typeof m.vote_average === "number" ? Math.round(m.vote_average * 10) / 10 : undefined,
      }));
    return NextResponse.json({ results, name: cj.name });
  }

  const r = await fetch(url, { next: { revalidate: 3600 } });
  if (!r.ok) return NextResponse.json({ results: [] }, { status: 502 });
  const j: any = await r.json();

  const results = (j.results ?? [])
    .filter((m: any) => m.poster_path)
    .map((m: any) => ({
      id: m.id, type,
      title: m.title || m.name,
      year: ((m.release_date || m.first_air_date) as string | undefined)?.slice(0, 4),
      poster: IMG(m.poster_path),
      rating: typeof m.vote_average === "number" ? Math.round(m.vote_average * 10) / 10 : undefined,
    }));

  return NextResponse.json({ results, total_pages: j.total_pages ?? 1, page: Number(page) });
}
