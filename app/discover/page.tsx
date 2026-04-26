import { Header } from "@/app/_components/Header";
import { Discover } from "@/app/_components/Discover";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") flat[k] = v;
    else if (Array.isArray(v) && v[0]) flat[k] = v[0];
  }
  return (
    <>
      <Header />
      <Discover params={flat} />
    </>
  );
}
