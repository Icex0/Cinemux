import { notFound } from "next/navigation";
import { Header } from "@/app/_components/Header";
import { ListView } from "@/app/_components/ListView";

const TITLES: Record<string, string> = {
  movies: "All Movies",
  tv: "All Shows",
  trending: "Trending This Week",
  popular_movies: "Popular Movies",
  popular_tv: "Popular TV",
  top_rated_movies: "Top Rated Movies",
  top_rated_tv: "Top Rated TV",
  upcoming: "Upcoming Movies",
  airing_today: "Airing Today",
  on_the_air: "On The Air",
};

export default async function Page({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!(name in TITLES)) notFound();
  return (
    <>
      <Header />
      <ListView name={name} title={TITLES[name]} />
    </>
  );
}
