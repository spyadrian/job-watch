// Eightfold careers sites ("PCSX"), on {company}.eightfold.ai or the employer's own
// domain (jobs.nvidia.com, apply.careers.microsoft.com). Each site serves its Jobs from:
//   GET https://{host}/api/pcsx/search?domain={domain}&query=&location=&start={n}&sort_by=relevance
//   → { data: { count, positions: [{ id, name, locations, postedTs, positionUrl }] } }
// `domain` names the tenant on that host; it is stated in the site's pages, in
// <code id="pcsx-data">{"domain": "nvidia.com", …}</code>, which is how discovery
// recognises a site on a custom domain (Jobs are never read from the page).
// The key is "{host}/{domain}", e.g. "jobs.nvidia.com/nvidia.com".
// Pages hold 10 Jobs whatever is asked; they are read one after the other until the
// count the first page gives, and never more than MAX_PAGES (1000 Jobs, as for
// SmartRecruiters). The default sort (by posting day) pages unstably: Jobs posted
// the same day swap between pages, so some appear twice and others never (PayPal,
// 2026-11-20: 339 distinct of 354). Sorting by relevance for an empty query reads
// them all (354 of 354).
// Sites throttle bursts with HTTP 429 (NVIDIA after ~25 quick requests, Microsoft
// after ~14, for up to about a minute), so a throttled page is asked again after
// growing pauses before the read fails. A full read of a large site (1000 Jobs) can
// take a few minutes (Microsoft, 2026-11-20: about 4).
// The older /api/apply/v2/jobs answers 403 on PCSX sites, so it isn't used.
// Not tried by name discovery: a name doesn't tell the site's host.
import { getJson } from "./http.ts";
import { SourceError, type NormalizedJob, type SourceAdapter } from "./types.ts";

const HOST = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/;
const MAX_PAGES = 100;
/** Pauses before asking a throttled (HTTP 429) page again; then the read fails. */
const THROTTLE_PAUSES_MS = [5_000, 15_000, 30_000, 60_000];

interface SearchAnswer {
  data?: { count?: number; positions?: Position[] } | null;
}

interface Position {
  id?: number | string;
  name?: string;
  locations?: string[] | null;
  standardizedLocations?: string[] | null;
  postedTs?: number | null;
  positionUrl?: string | null;
}

export const eightfold: SourceAdapter = {
  type: "eightfold",
  label: "Eightfold",

  matchLink(url) {
    // https://{company}.eightfold.ai/careers?domain={domain}… states both parts of the key.
    if (!url.hostname.endsWith(".eightfold.ai")) return null;
    return keyOf(url.hostname, url.searchParams.get("domain"));
  },

  matchPage(pageUrl, html) {
    const data = /<code\b[^>]*\bid\s*=\s*["']pcsx-data["'][^>]*>([\s\S]*?)<\/code>/i.exec(html)?.[1];
    if (!data) return null;
    const domain = /"domain"\s*:\s*"([^"]+)"/.exec(data.replaceAll("&#34;", '"').replaceAll("&quot;", '"'))?.[1];
    return keyOf(pageUrl.hostname, domain ?? null);
  },

  async read(key, ctx) {
    const [host, domain] = key.split("/");
    if (!host || !domain) throw new SourceError(`"${key}" isn't an Eightfold careers site`);
    const what = `the Eightfold careers site ${host}`;
    const unexpected = `The Eightfold careers site ${host} answered in an unexpected format`;
    const pageAt = async (start: number) => {
      const url = `https://${host}/api/pcsx/search?domain=${encodeURIComponent(domain)}&query=&location=&start=${start}&sort_by=relevance`;
      const data = ((await getPatiently(() => getJson(ctx, url, what))) as SearchAnswer | null)?.data;
      if (!Array.isArray(data?.positions)) throw new SourceError(unexpected);
      return { positions: data.positions, count: data.count };
    };

    // Any page failing fails the whole read.
    const positions: Position[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { positions: more, count } = await pageAt(positions.length);
      positions.push(...more);
      if (more.length === 0 || typeof count !== "number" || positions.length >= count) break;
    }

    const seen = new Set<string>();
    const jobs: NormalizedJob[] = [];
    for (const position of positions) {
      if (position?.id === undefined || position.id === null || !position.name) throw new SourceError(unexpected);
      const id = String(position.id);
      // A Job posted while reading shifts the pages, so one may appear twice.
      if (seen.has(id)) continue;
      seen.add(id);
      jobs.push({
        sourceJobId: id,
        title: position.name,
        url: new URL(position.positionUrl || `/careers/job/${encodeURIComponent(id)}`, `https://${host}`).href,
        locations: locationsOf(position),
        publishedAt: typeof position.postedTs === "number" ? new Date(position.postedTs * 1000).toISOString() : null,
      });
    }
    return { jobs };
  },
};

/** Runs a request, asking again after a pause while the site answers HTTP 429. */
async function getPatiently<T>(request: () => Promise<T>): Promise<T> {
  for (const pause of THROTTLE_PAUSES_MS) {
    try {
      return await request();
    } catch (err) {
      if (!(err instanceof SourceError) || err.status !== 429) throw err;
      await new Promise((resolve) => setTimeout(resolve, pause));
    }
  }
  return request();
}

function keyOf(host: string, domain: string | null): string | null {
  const h = host.toLowerCase();
  const d = domain?.trim().toLowerCase();
  return d && HOST.test(h) && HOST.test(d) ? `${h}/${d}` : null;
}

/** The locations as published ("Remote - Switzerland"), else their standardized form. */
function locationsOf(position: Position): string[] {
  const clean = (list: string[] | null | undefined) =>
    (list ?? []).flatMap((l) => (typeof l === "string" && l.trim() ? [l.trim()] : []));
  const published = clean(position.locations);
  return published.length > 0 ? published : clean(position.standardizedLocations);
}
