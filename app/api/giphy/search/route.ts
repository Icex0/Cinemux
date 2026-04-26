import { NextResponse } from "next/server";

const KEY = process.env.GIPHY_API_KEY;

export async function GET(req: Request) {
  if (!KEY) return NextResponse.json({ error: "GIPHY_API_KEY not configured" }, { status: 503 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const limit = Math.min(Number(url.searchParams.get("limit") || 24), 50);

  const endpoint = q
    ? `https://api.giphy.com/v1/gifs/search?api_key=${KEY}&q=${encodeURIComponent(q)}&limit=${limit}&rating=pg-13&bundle=messaging_non_clips`
    : `https://api.giphy.com/v1/gifs/trending?api_key=${KEY}&limit=${limit}&rating=pg-13&bundle=messaging_non_clips`;

  try {
    const r = await fetch(endpoint, { next: { revalidate: 60 } });
    if (!r.ok) return NextResponse.json({ error: "giphy_error", status: r.status }, { status: 502 });
    const j = await r.json();
    const results = (j.data || []).map((g: any) => ({
      id: g.id,
      title: g.title || "",
      // Small fixed-height preview for grid; full URL for sending.
      preview: g.images?.fixed_height_small?.url || g.images?.fixed_height?.url || "",
      url: g.images?.fixed_height?.url || g.images?.original?.url || "",
      width: Number(g.images?.fixed_height?.width) || 0,
      height: Number(g.images?.fixed_height?.height) || 0,
    })).filter((g: any) => g.url && g.preview);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
  }
}
