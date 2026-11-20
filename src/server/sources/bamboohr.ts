// BambooHR public careers API, the one its careers pages read:
//   GET https://{slug}.bamboohr.com/careers/list          → { meta: { totalCount }, result: [Job…] }
//   GET https://{slug}.bamboohr.com/careers/company-info  → { result: { name, … } }
// The list isn't paginated: one answer holds every Job. It gives no publication date
// (only each Job's own detail does), so publishedAt is null rather than one request per Job.
// An unknown subdomain is redirected to BambooHR's home page (HTML), so it fails the read.
import { getJson, getText } from "./http.ts";
import { SourceError, type NormalizedJob, type SourceAdapter, type SourceContext } from "./types.ts";

const SLUG = /^[a-z0-9-]+$/;
/** Subdomains of BambooHR's own site, never a company's careers site. */
const RESERVED = new Set(["www", "api", "app", "help", "support", "blog", "docs", "status", "partners", "marketplace"]);
/** BambooHR's location types: 0 on-site, 1 remote, 2 hybrid. */
const REMOTE_LOCATION_TYPE = "1";

interface BambooJob {
  id?: string | number;
  jobOpeningName?: string;
  /** The office's address, for on-site and hybrid Jobs. */
  location?: { city?: string | null; state?: string | null } | null;
  /** Where a remote Job may be done from. */
  atsLocation?: { city?: string | null; province?: string | null; state?: string | null; country?: string | null } | null;
  isRemote?: boolean | null;
  locationType?: string | number | null;
}

export const bamboohr: SourceAdapter = {
  type: "bamboohr",
  label: "BambooHR",

  matchLink(url) {
    // {slug}.bamboohr.com, any path (/careers, /careers/{id}, /jobs/, /jobs/view.php, /jobs/embed2.php, /js/embed.js)
    const match = /^([^.]+)\.bamboohr\.com$/.exec(url.hostname);
    const slug = match?.[1];
    return slug && SLUG.test(slug) && !RESERVED.has(slug) ? slug : null;
  },

  async read(slug, ctx) {
    const what = `the BambooHR site "${slug}"`;
    const unexpected = `The BambooHR site "${slug}" answered in an unexpected format`;
    if (!SLUG.test(slug)) throw new SourceError(`The BambooHR site "${slug}" doesn't exist`);
    const base = `https://${slug}.bamboohr.com/careers`;

    const text = await getText(ctx, `${base}/list`, what);
    if (/^\s*</.test(text)) throw new SourceError(`The BambooHR site "${slug}" doesn't exist`);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new SourceError(`The BambooHR site "${slug}" didn't answer with valid JSON`);
    }
    const raw = (body as { result?: unknown } | null)?.result;
    if (!Array.isArray(raw)) throw new SourceError(unexpected);

    const jobs: NormalizedJob[] = (raw as BambooJob[]).map((job) => {
      const title = job?.jobOpeningName?.trim();
      if (job?.id === undefined || job.id === null || !title) throw new SourceError(unexpected);
      return {
        sourceJobId: String(job.id),
        title,
        url: `${base}/${encodeURIComponent(String(job.id))}`,
        locations: locationsOf(job),
        publishedAt: null,
      };
    });
    const companyName = await companyNameOf(base, slug, ctx);
    return companyName ? { jobs, companyName } : { jobs };
  },
};

/** The Company's name from its careers site, or undefined when it can't be read (the Jobs still are). */
async function companyNameOf(base: string, slug: string, ctx: SourceContext): Promise<string | undefined> {
  try {
    const info = (await getJson(ctx, `${base}/company-info`, `the BambooHR site "${slug}"`)) as {
      result?: { name?: unknown };
    } | null;
    const name = info?.result?.name;
    return typeof name === "string" && name.trim() ? name.trim() : undefined;
  } catch (err) {
    if (err instanceof SourceError) return undefined;
    throw err;
  }
}

/**
 * The place as published: the office ("City, State") for on-site and hybrid Jobs,
 * else where a remote Job may be done from ("City, Province, Country"). A remote
 * Job starts with "Remote".
 */
function locationsOf(job: BambooJob): string[] {
  const office = [job.location?.city, job.location?.state];
  const ats = job.atsLocation;
  const remoteArea = [ats?.city, ats?.province || ats?.state, ats?.country];
  const join = (parts: (string | null | undefined)[]) =>
    parts.map((part) => part?.trim()).filter(Boolean).join(", ");
  const place = join(office) || join(remoteArea);
  const remote = job.isRemote === true || String(job.locationType ?? "") === REMOTE_LOCATION_TYPE;
  if (remote) return place ? ["Remote", place] : ["Remote"];
  return place ? [place] : [];
}
