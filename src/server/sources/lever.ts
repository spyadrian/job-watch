// Lever public Postings API, one adapter per instance:
//   US: GET https://api.lever.co/v0/postings/{slug}?mode=json     (boards on jobs.lever.co)
//   EU: GET https://api.eu.lever.co/v0/postings/{slug}?mode=json  (boards on jobs.eu.lever.co)
// The answer is a bare array of postings (no company name).
import type { SourceType } from "../../shared/types.ts";
import { getJson, isoDate } from "./http.ts";
import { SourceError, type NormalizedJob, type SourceAdapter } from "./types.ts";

const SLUG = /^[A-Za-z0-9_.-]+$/;

interface LeverPosting {
  id?: string;
  text?: string;
  hostedUrl?: string;
  createdAt?: number;
  categories?: { location?: string | null; allLocations?: string[] | null } | null;
}

function leverAdapter(type: SourceType, label: string, domain: string): SourceAdapter {
  const boardHost = `jobs.${domain}`;
  const apiHost = `api.${domain}`;

  return {
    type,
    label,

    matchLink(url) {
      const segments = url.pathname.split("/").filter(Boolean);
      let slug: string | undefined;
      // /{slug}, /{slug}/{postingId}, /{slug}/{postingId}/apply
      if (url.hostname === boardHost) slug = segments[0];
      // /v0/postings/{slug}
      else if (url.hostname === apiHost && segments[0] === "v0" && segments[1] === "postings") slug = segments[2];
      return slug && SLUG.test(slug) ? slug.toLowerCase() : null;
    },

    async read(slug, ctx) {
      const what = `the ${label} board "${slug}"`;
      const unexpected = `The ${label} board "${slug}" answered in an unexpected format`;
      const body = await getJson(ctx, `https://${apiHost}/v0/postings/${encodeURIComponent(slug)}?mode=json`, what);
      if (!Array.isArray(body)) throw new SourceError(unexpected);

      const jobs: NormalizedJob[] = (body as LeverPosting[]).map((posting) => {
        if (!posting?.id || !posting.text || !posting.hostedUrl) throw new SourceError(unexpected);
        return {
          sourceJobId: posting.id,
          title: posting.text,
          url: posting.hostedUrl,
          locations: locationsOf(posting),
          publishedAt: isoDate(posting.createdAt),
        };
      });
      return { jobs };
    },
  };
}

/** Every location the posting lists, falling back to its single primary location. */
function locationsOf(posting: LeverPosting): string[] {
  const all = posting.categories?.allLocations;
  const raw = Array.isArray(all) && all.length > 0 ? all : [posting.categories?.location];
  return raw.flatMap((location) => (typeof location === "string" && location.trim() ? [location.trim()] : []));
}

export const lever = leverAdapter("lever", "Lever", "lever.co");
export const leverEu = leverAdapter("lever-eu", "Lever (EU)", "eu.lever.co");
