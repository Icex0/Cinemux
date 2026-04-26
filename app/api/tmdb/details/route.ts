import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 3600;

const IMG = (path: string | null | undefined, size = "w342") =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;

export async function GET(req: Request) {
  const key = process.env.TMDB_API_KEY;
  if (!key) return NextResponse.json({ error: "TMDB_API_KEY not set" }, { status: 501 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const id = searchParams.get("id");
  if (!id || (type !== "movie" && type !== "tv")) {
    return NextResponse.json({ error: "type=movie|tv and id required" }, { status: 400 });
  }

  const append = type === "movie"
    ? "credits,keywords,similar,release_dates,videos,external_ids"
    : "credits,keywords,similar,content_ratings,videos,external_ids";

  const url = new URL(`https://api.themoviedb.org/3/${type}/${id}`);
  url.searchParams.set("api_key", key);
  url.searchParams.set("append_to_response", append);

  const r = await fetch(url, { next: { revalidate: 3600 } });
  if (!r.ok) return NextResponse.json({ error: "tmdb failed" }, { status: r.status });
  const j: any = await r.json();

  const certificate = type === "movie"
    ? (j.release_dates?.results?.find((c: any) => c.iso_3166_1 === "US")
        ?.release_dates?.find((d: any) => d.certification)?.certification ?? null)
    : (j.content_ratings?.results?.find((c: any) => c.iso_3166_1 === "US")?.rating ?? null);

  const keywords = (type === "movie" ? j.keywords?.keywords : j.keywords?.results) ?? [];

  const similar = (j.similar?.results ?? [])
    .filter((m: any) => m.poster_path)
    .slice(0, 14)
    .map((m: any) => ({
      id: m.id,
      type,
      title: m.title || m.name,
      year: ((m.release_date || m.first_air_date) as string | undefined)?.slice(0, 4),
      poster: IMG(m.poster_path),
      rating: typeof m.vote_average === "number" ? Math.round(m.vote_average * 10) / 10 : undefined,
    }));

  const cast = (j.credits?.cast ?? []).slice(0, 12).map((c: any) => ({
    id: c.id, name: c.name, character: c.character, profile: IMG(c.profile_path, "w185"),
  }));

  const videos = (j.videos?.results ?? []) as any[];
  const trailer =
    videos.find((v) => v.site === "YouTube" && v.type === "Trailer" && v.official) ??
    videos.find((v) => v.site === "YouTube" && v.type === "Trailer") ??
    videos.find((v) => v.site === "YouTube" && v.type === "Teaser") ??
    null;
  const imdbId: string | null = j.imdb_id || j.external_ids?.imdb_id || null;

  return NextResponse.json({
    id: j.id,
    type,
    title: j.title || j.name,
    tagline: j.tagline || null,
    overview: j.overview || null,
    backdrop: IMG(j.backdrop_path, "w1280"),
    poster: IMG(j.poster_path, "w500"),
    year: ((j.release_date || j.first_air_date) as string | undefined)?.slice(0, 4),
    rating: typeof j.vote_average === "number" ? Math.round(j.vote_average * 10) / 10 : undefined,
    runtime: j.runtime ?? (Array.isArray(j.episode_run_time) ? j.episode_run_time[0] : null) ?? null,
    certificate,
    genres: (j.genres ?? []).map((g: any) => ({ id: g.id, name: g.name })),
    countries: (j.production_countries ?? []).map((c: any) => c.name),
    languages: (j.spoken_languages ?? []).map((l: any) => l.english_name || l.name),
    keywords: keywords.map((k: any) => ({ id: k.id, name: k.name })),
    collection: j.belongs_to_collection ? { id: j.belongs_to_collection.id, name: j.belongs_to_collection.name } : null,
    cast,
    credits: {
      directors: (j.credits?.crew ?? []).filter((c: any) => c.job === "Director").map((c: any) => ({ id: c.id, name: c.name })),
      creators: (j.created_by ?? []).map((c: any) => ({ id: c.id, name: c.name })),
    },
    similar,
    trailer: trailer ? { key: trailer.key, name: trailer.name } : null,
    imdbId,
    seasons: type === "tv" ? (j.number_of_seasons ?? null) : null,
    seasonList: type === "tv"
      ? (j.seasons ?? [])
          .filter((s: any) => s.season_number > 0 && s.episode_count > 0)
          .map((s: any) => ({ season_number: s.season_number, episode_count: s.episode_count, name: s.name }))
      : [],
  });
}
