// Greenhouse public Job Board API: GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs
import { getJson, isoDate } from "./http.ts";
import { SourceError, type NormalizedJob, type SourceAdapter } from "./types.ts";

const SLUG = /^[A-Za-z0-9_-]+$/;
const BOARD_HOSTS = new Set(["boards.greenhouse.io", "job-boards.greenhouse.io"]);

interface GreenhouseJob {
  id: number | string;
  title?: string;
  absolute_url?: string;
  location?: { name?: string | null } | null;
  first_published?: string | null;
  company_name?: string;
}

export const greenhouse: SourceAdapter = {
  type: "greenhouse",
  label: "Greenhouse",

  matchLink(url) {
    const segments = url.pathname.split("/").filter(Boolean);
    let slug: string | null | undefined = null;
    if (BOARD_HOSTS.has(url.hostname)) {
      // /embed/job_board?for={slug}, /embed/job_app?for={slug}&token=…
      if (segments[0] === "embed") slug = url.searchParams.get("for");
      // /{slug}, /{slug}/jobs/{id}
      else slug = segments[0];
    } else if (url.hostname === "boards-api.greenhouse.io" && segments[0] === "v1" && segments[1] === "boards") {
      slug = segments[2];
    }
    return slug && SLUG.test(slug) ? slug.toLowerCase() : null;
  },

  async read(slug, ctx) {
    const what = `the Greenhouse board "${slug}"`;
    const unexpected = `The Greenhouse board "${slug}" answered in an unexpected format`;
    const body = await getJson(ctx, `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`, what);
    const raw = (body as { jobs?: unknown } | null)?.jobs;
    if (!Array.isArray(raw)) throw new SourceError(unexpected);

    const jobs: NormalizedJob[] = (raw as GreenhouseJob[]).map((job) => {
      if (job.id === undefined || !job.title || !job.absolute_url) {
        throw new SourceError(unexpected);
      }
      const location = job.location?.name?.trim();
      return {
        sourceJobId: String(job.id),
        title: job.title,
        url: job.absolute_url,
        locations: location ? [location] : [],
        publishedAt: isoDate(job.first_published),
      };
    });
    const companyName = (raw as GreenhouseJob[]).find((job) => job.company_name)?.company_name;
    return companyName ? { jobs, companyName } : { jobs };
  },
};
