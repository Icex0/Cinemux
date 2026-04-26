import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 3600;

const IMG = (p: string | null | undefined, size = "w342") =>
  p ? `https://image.tmdb.org/t/p/${size}${p}` : null;

function pickLogo(logos: any[]): string | null {
  if (!logos?.length) return null;
  const en = logos.find((l) => l.iso_639_1 === "en" && l.file_path?.endsWith(".png"));
  if (en) return en.file_path;
  const enAny = logos.find((l) => l.iso_639_1 === "en");
  if (enAny) return enAny.file_path;
  const noLang = logos.find((l) => !l.iso_639_1);
  if (noLang) return noLang.file_path;
  return logos[0].file_path ?? null;
}

export async function GET() {
  const key = process.env.TMDB_API_KEY;
  if (!key) return NextResponse.json({ error: "TMDB_API_KEY not set", results: [] }, { status: 501 });

  const tu = new URL("https://api.themoviedb.org/3/trending/all/week");
  tu.searchParams.set("api_key", key);
  const tr = await fetch(tu, { next: { revalidate: 3600 } });
  if (!tr.ok) return NextResponse.json({ error: "tmdb failed", results: [] }, { status: 502 });
  const tj: any = await tr.json();

  const candidates = (tj.results ?? [])
    .filter((m: any) => (m.media_type === "movie" || m.media_type === "tv") && m.backdrop_path && m.overview)
    .slice(0, 8);

  const enriched = await Promise.all(
    candidates.map(async (m: any) => {
      const iu = new URL(`https://api.themoviedb.org/3/${m.media_type}/${m.id}/images`);
      iu.searchParams.set("api_key", key);
      iu.searchParams.set("include_image_language", "en,null");
      try {
        const ir = await fetch(iu, { next: { revalidate: 86400 } });
        const ij: any = ir.ok ? await ir.json() : {};
        const logoPath = pickLogo(ij.logos ?? []);
        return {
          id: m.id,
          type: m.media_type as "movie" | "tv",
          title: m.title || m.name,
          year: ((m.release_date || m.first_air_date) as string | undefined)?.slice(0, 4),
          poster: IMG(m.poster_path),
          backdrop: IMG(m.backdrop_path, "w1280"),
          overview: m.overview || null,
          rating: typeof m.vote_average === "number" ? Math.round(m.vote_average * 10) / 10 : undefined,
          logo: IMG(logoPath, "w500"),
        };
      } catch {
        return {
          id: m.id,
          type: m.media_type as "movie" | "tv",
          title: m.title || m.name,
          year: ((m.release_date || m.first_air_date) as string | undefined)?.slice(0, 4),
          poster: IMG(m.poster_path),
          backdrop: IMG(m.backdrop_path, "w1280"),
          overview: m.overview || null,
          rating: typeof m.vote_average === "number" ? Math.round(m.vote_average * 10) / 10 : undefined,
          logo: null,
        };
      }
    })
  );

  return NextResponse.json({ results: enriched.slice(0, 6) });
}
