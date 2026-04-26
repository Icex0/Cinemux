// Embed providers are configured entirely via environment variables.
// See .env.example for the slot names + URL templates each provider supports.
//
// URL templates can use these placeholders:
//   {id}       — TMDB id
//   {season}   — TV season number
//   {episode}  — TV episode number
//   {startAt}  — resume position in seconds (only Alpha is expected to honor this)
//   {sub}      — subtitle language code (only Alpha is expected to honor this)
//
// Providers without movie+tv templates set are hidden from the source switcher.
// The Alpha slot is treated as the canonical "controllable" provider for the
// watch-party feature and "Continue Watching" — its iframe must emit the
// vidup-compatible MEDIA_DATA / playerstatus events for those to work.

export type ProviderOpts = { startAt?: number; sub?: string };

export type Provider = {
  id: string;
  name: string;
  origin: string;
  movieUrl: (id: string | number, opts: ProviderOpts) => string;
  tvUrl: (id: string | number, s: number, e: number, opts: ProviderOpts) => string;
};

// Each slot's env vars are read as static literals so Next can inline them.
const SLOTS = [
  {
    id: "alpha",
    defaultName: "Alpha",
    name: process.env.NEXT_PUBLIC_PROVIDER_ALPHA_NAME,
    origin: process.env.NEXT_PUBLIC_PROVIDER_ALPHA_ORIGIN,
    movie: process.env.NEXT_PUBLIC_PROVIDER_ALPHA_MOVIE,
    tv: process.env.NEXT_PUBLIC_PROVIDER_ALPHA_TV,
  },
  {
    id: "beta",
    defaultName: "Beta",
    name: process.env.NEXT_PUBLIC_PROVIDER_BETA_NAME,
    origin: process.env.NEXT_PUBLIC_PROVIDER_BETA_ORIGIN,
    movie: process.env.NEXT_PUBLIC_PROVIDER_BETA_MOVIE,
    tv: process.env.NEXT_PUBLIC_PROVIDER_BETA_TV,
  },
  {
    id: "gamma",
    defaultName: "Gamma",
    name: process.env.NEXT_PUBLIC_PROVIDER_GAMMA_NAME,
    origin: process.env.NEXT_PUBLIC_PROVIDER_GAMMA_ORIGIN,
    movie: process.env.NEXT_PUBLIC_PROVIDER_GAMMA_MOVIE,
    tv: process.env.NEXT_PUBLIC_PROVIDER_GAMMA_TV,
  },
  {
    id: "delta",
    defaultName: "Delta",
    name: process.env.NEXT_PUBLIC_PROVIDER_DELTA_NAME,
    origin: process.env.NEXT_PUBLIC_PROVIDER_DELTA_ORIGIN,
    movie: process.env.NEXT_PUBLIC_PROVIDER_DELTA_MOVIE,
    tv: process.env.NEXT_PUBLIC_PROVIDER_DELTA_TV,
  },
] as const;

function fillTemplate(tpl: string, vars: Record<string, string | number | undefined>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v != null && v !== "" ? String(v) : "";
  });
}

export const PROVIDERS: Provider[] = SLOTS
  .filter((s) => s.movie && s.tv)
  .map((s): Provider => ({
    id: s.id,
    name: s.name || s.defaultName,
    origin: s.origin || "",
    movieUrl: (id, o) => fillTemplate(s.movie!, { id, startAt: o.startAt, sub: o.sub }),
    tvUrl: (id, season, episode, o) => fillTemplate(s.tv!, { id, season, episode, startAt: o.startAt, sub: o.sub }),
  }));

export const ALPHA_PROVIDER = PROVIDERS.find((p) => p.id === "alpha") ?? PROVIDERS[0];
export const DEFAULT_PROVIDER = ALPHA_PROVIDER?.id ?? "alpha";
export const PROVIDER_STORAGE_KEY = "preferred_provider";

export function getProvider(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}
