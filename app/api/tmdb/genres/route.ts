import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 86400;

export async function GET(req: Request) {
  const key = process.env.TMDB_API_KEY;
  if (!key) return NextResponse.json({ genres: [] }, { status: 501 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") === "tv" ? "tv" : "movie";

  const url = new URL(`https://api.themoviedb.org/3/genre/${type}/list`);
  url.searchParams.set("api_key", key);

  const r = await fetch(url, { next: { revalidate: 86400 } });
  if (!r.ok) return NextResponse.json({ genres: [] }, { status: 502 });
  const j: any = await r.json();
  return NextResponse.json({ genres: j.genres ?? [] });
}
