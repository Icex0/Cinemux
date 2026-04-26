export type CatalogItem = {
  id: number | string;
  type: "movie" | "tv";
  title: string;
  year?: number | string;
  poster?: string | null;
  backdrop?: string | null;
  overview?: string | null;
  rating?: number;
  runtime?: number | null;
  logo?: string | null;
};

export const CATALOG: CatalogItem[] = [
  { id: 533535, type: "movie", title: "Deadpool & Wolverine", year: 2024, poster: "https://image.tmdb.org/t/p/w342/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg" },
  { id: 1022789, type: "movie", title: "Inside Out 2", year: 2024, poster: "https://image.tmdb.org/t/p/w342/vpnVM9B6NMmQpWeZvzLvDESb2QY.jpg" },
  { id: 558, type: "movie", title: "Spider-Man 2", year: 2004, poster: "https://image.tmdb.org/t/p/w342/9SWDzK7yCe2PvcbEzrTjGymGbWB.jpg" },
  { id: 27205, type: "movie", title: "Inception", year: 2010, poster: "https://image.tmdb.org/t/p/w342/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg" },
  { id: 63174, type: "tv", title: "Lucifer", year: 2016, poster: "https://image.tmdb.org/t/p/w342/ekZobS8isE6mA53RAiGDG93hBxL.jpg" },
  { id: 1399, type: "tv", title: "Game of Thrones", year: 2011, poster: "https://image.tmdb.org/t/p/w342/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg" },
];

export function progressKey(item: { id: number | string; type: "movie" | "tv" }) {
  return (item.type === "tv" ? "t" : "m") + item.id;
}
