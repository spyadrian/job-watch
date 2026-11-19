// Ashby public Job Posting API: GET https://api.ashbyhq.com/posting-api/job-board/{slug}
// Boards live on jobs.ashbyhq.com/{slug}. The answer gives no company name.
// Jobs with `isListed: false` are unlisted on the board and are dropped here, so
// they can never be stored or shown.
import { getJson, isoDate } from "./http.ts";
import { SourceError, type NormalizedJob, type SourceAdapter } from "./types.ts";

const SLUG = /^[A-Za-z0-9_.-]+$/;

interface AshbyJob {
  id?: string;
  title?: string;
  jobUrl?: string;
  location?: string | null;
  secondaryLocations?: { location?: string | null }[] | null;
  publishedAt?: string | null;
  isListed?: boolean;
}

export const ashby: SourceAdapter = {
  type: "ashby",
  label: "Ashby",

  matchLink(url) {
    const segments = url.pathname.split("/").filter(Boolean);
    let slug: string | undefined;
    // /{slug}, /{slug}/jobs, /{slug}/{jobId}, /{slug}/{jobId}/application
    if (url.hostname === "jobs.ashbyhq.com") slug = segments[0];
    // /posting-api/job-board/{slug}
    else if (url.hostname === "api.ashbyhq.com" && segments[0] === "posting-api" && segments[1] === "job-board") {
      slug = segments[2];
    }
    return slug && SLUG.test(slug) ? slug.toLowerCase() : null;
  },

  async read(slug, ctx) {
    const what = `the Ashby board "${slug}"`;
    const unexpected = `The Ashby board "${slug}" answered in an unexpected format`;
    const body = await getJson(ctx, `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`, what);
    const raw = (body as { jobs?: unknown } | null)?.jobs;
    if (!Array.isArray(raw)) throw new SourceError(unexpected);

    const jobs: NormalizedJob[] = (raw as AshbyJob[]).flatMap((job) => {
      // An unlisted Job is never shown; a listed one too incomplete to show is skipped
      // rather than failing the whole board (OpenAI's board has one with an empty title).
      if (job?.isListed === false || !job?.id || !job.title?.trim() || !job.jobUrl) return [];
      return [
        {
          sourceJobId: job.id,
          title: job.title,
          url: job.jobUrl,
          locations: [job.location, ...(job.secondaryLocations ?? []).map((s) => s?.location)].flatMap((location) =>
            typeof location === "string" && location.trim() ? [location.trim()] : [],
          ),
          publishedAt: isoDate(job.publishedAt),
        },
      ];
    });
    return { jobs };
  },
};
