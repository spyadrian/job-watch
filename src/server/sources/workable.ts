// Workable public widget API: GET https://apply.workable.com/api/v1/widget/accounts/{slug}
import { getJson, isoDate } from "./http.ts";
import { SourceError, type NormalizedJob, type SourceAdapter } from "./types.ts";

const SLUG = /^[a-z0-9_-]+$/;
/** First path segments of apply.workable.com that aren't an account. */
const NOT_ACCOUNTS = new Set(["j", "api"]);
/** Subdomains of Workable's own site, never a company's board. */
const RESERVED = new Set(["www", "apply", "jobs", "help", "resources", "api", "app", "blog", "developers"]);

interface WorkableLocation {
  city?: string | null;
  region?: string | null;
  country?: string | null;
  hidden?: boolean;
}

interface WorkableJob {
  shortcode?: string;
  title?: string;
  url?: string;
  telecommuting?: boolean;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  locations?: WorkableLocation[] | null;
  published_on?: string | null;
}

export const workable: SourceAdapter = {
  type: "workable",
  label: "Workable",
  // Answers 200 with no Jobs for many names it doesn't know.
  unknownKeyReadsEmpty: true,

  matchLink(url) {
    const segments = url.pathname.split("/").filter(Boolean);
    let slug: string | undefined;
    if (url.hostname === "apply.workable.com") {
      if (segments[0] === "api") {
        // /api/v1/widget/accounts/{slug}, /api/v3/accounts/{slug}/jobs
        const at = segments.indexOf("accounts");
        slug = at > 0 ? segments[at + 1] : undefined;
      } else if (!NOT_ACCOUNTS.has(segments[0] ?? "")) {
        // /{slug}, /{slug}/j/{shortcode}/…  (/j/{shortcode} alone doesn't name the account)
        slug = segments[0];
      }
    } else {
      // Legacy boards: {slug}.workable.com
      const sub = /^([^.]+)\.workable\.com$/.exec(url.hostname)?.[1];
      if (sub && !RESERVED.has(sub)) slug = sub;
    }
    const key = slug?.toLowerCase();
    return key && SLUG.test(key) ? key : null;
  },

  async read(slug, ctx) {
    const what = `the Workable account "${slug}"`;
    const unexpected = `The Workable account "${slug}" answered in an unexpected format`;
    const body = await getJson(ctx, `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}`, what);
    const account = body as { name?: unknown; jobs?: unknown } | null;
    if (!Array.isArray(account?.jobs)) throw new SourceError(unexpected);

    const jobs: NormalizedJob[] = (account.jobs as WorkableJob[]).map((job) => {
      if (!job.shortcode || !job.title) throw new SourceError(unexpected);
      return {
        sourceJobId: job.shortcode,
        title: job.title,
        url: job.url || `https://apply.workable.com/${slug}/j/${job.shortcode}/`,
        locations: locationsOf(job),
        publishedAt: isoDate(job.published_on),
      };
    });
    const companyName = typeof account.name === "string" ? account.name : undefined;
    return companyName ? { jobs, companyName } : { jobs };
  },
};

/** The locations Workable shows on the Job ad ("City, Region, Country"), then "Remote" for a remote Job. */
function locationsOf(job: WorkableJob): string[] {
  const places = job.locations ?? [{ city: job.city, region: job.state, country: job.country }];
  const shown = places
    .filter((place) => !place.hidden)
    .map((place) => [place.city, place.region, place.country].map((part) => part?.trim()).filter(Boolean).join(", "))
    .filter(Boolean);
  return job.telecommuting ? [...shown, "Remote"] : shown;
}
