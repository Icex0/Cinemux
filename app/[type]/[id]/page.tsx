import { notFound } from "next/navigation";
import { Header } from "@/app/_components/Header";
import { Detail } from "@/app/_components/Detail";

type Params = { type: string; id: string };

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { type, id } = await params;
  if (type !== "movie" && type !== "tv") return {};
  const key = process.env.TMDB_API_KEY;
  if (!key) return { title: "Cinemux" };
  try {
    const r = await fetch(`https://api.themoviedb.org/3/${type}/${id}?api_key=${key}`, { next: { revalidate: 3600 } });
    if (!r.ok) return { title: "Cinemux" };
    const j: any = await r.json();
    const title = j.title || j.name;
    return {
      title: title ? `${title} · Cinemux` : "Cinemux",
      description: j.overview || undefined,
    };
  } catch {
    return { title: "Cinemux" };
  }
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { type, id } = await params;
  if (type !== "movie" && type !== "tv") notFound();
  return (
    <>
      <Header />
      <Detail type={type} id={id} />
    </>
  );
}
