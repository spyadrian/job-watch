// iCIMS careers sites built on Jibe, usually on the employer's own domain. Their public API:
//   GET https://{host}/api/jobs?page={n}&limit=100   (pages start at 1; 100 is the largest page)
//   → { totalCount, jobs: [{ data: { slug, title, full_location, posted_date, hiring_organization, … } }] }
// The key is the careers site's host, e.g. "careers.sita.aero". A Job's page is https://{host}/jobs/{slug}.
// Custom domains can't be recognised from a link, so discovery recognises the site from its
// page (matchPage: it loads Jibe's assets from jibecdn.com), then reading the API confirms it.
import { getJson, isoDate } from "./http.ts";
import { SourceError, type NormalizedJob, type SourceAdapter } from "./types.ts";

const HOST = /^(?:[a-z0-9-]+\.)+[a-z0-9-]{2,}$/;
const JIBE_ASSETS = /\/\/[a-z0-9.-]*\.jibecdn\.com\//i;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

interface JobsPage {
  totalCount?: number;
  jobs?: { data?: JibeJob | null }[];
}

interface JibeJob {
  slug?: string;
  req_id?: string;
  title?: string;
  full_location?: string;
  city?: string;
  state?: string;
  country?: string;
  posted_date?: string;
  hiring_organization?: string;
}

export const jibe: SourceAdapter = {
  type: "jibe",
  label: "iCIMS (Jibe)",

  // Jibe sites sit on the employer's own domain: no link pattern is Jibe's alone.
  matchLink() {
    return null;
  },

  matchPage(pageUrl, html) {
    const host = pageUrl.hostname.toLowerCase();
    return JIBE_ASSETS.test(html) && HOST.test(host) ? host : null;
  },

  async read(host, ctx) {
    if (!HOST.test(host)) throw new SourceError(`"${host}" isn't the host of a Jibe careers site`);
    const what = `the Jibe careers site ${host}`;
    const unexpected = `The Jibe careers site ${host} answered in an unexpected format`;

    const found: JibeJob[] = [];
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
      const body = (await getJson(ctx, `https://${host}/api/jobs?page=${pageNumber}&limit=${PAGE_SIZE}`, what)) as JobsPage | null;
      const jobs = body?.jobs;
      if (!Array.isArray(jobs)) throw new SourceError(unexpected);
      found.push(...jobs.map((job) => job?.data ?? {}));
      const total = typeof body?.totalCount === "number" ? body.totalCount : Infinity;
      if (jobs.length < PAGE_SIZE || pageNumber * PAGE_SIZE >= total) break;
    }

    const seen = new Set<string>();
    const result: NormalizedJob[] = [];
    for (const job of found) {
      const id = job.slug || job.req_id;
      if (!id || !job.title) throw new SourceError(unexpected);
      // A site published in several languages lists a Job once per language.
      if (seen.has(id)) continue;
      seen.add(id);
      result.push({
        sourceJobId: String(id),
        title: job.title,
        url: `https://${host}/jobs/${encodeURIComponent(id)}`,
        locations: locationsOf(job),
        publishedAt: isoDate(job.posted_date),
      });
    }
    const companyName = mostFrequent(found.map((job) => job.hiring_organization?.trim()));
    return companyName ? { jobs: result, companyName } : { jobs: result };
  },
};

/** "Delhi, India; Amman, Jordan" → ["Delhi, India", "Amman, Jordan"]. */
function locationsOf(job: JibeJob): string[] {
  const full = job.full_location?.trim();
  if (full) return full.split(";").map((part) => part.trim()).filter(Boolean);
  const text = [job.city, job.state, job.country].map((part) => part?.trim()).filter(Boolean).join(", ");
  return text ? [text] : [];
}

/** The name most Jobs give their hiring organization (a few may name a subsidiary). */
function mostFrequent(names: (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  for (const name of names) if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  let best: string | undefined;
  for (const [name, count] of counts) if (best === undefined || count > counts.get(best)!) best = name;
  return best;
}
