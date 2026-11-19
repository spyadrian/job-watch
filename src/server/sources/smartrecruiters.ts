// SmartRecruiters public Posting API:
//   GET https://api.smartrecruiters.com/v1/companies/{companyId}/postings?limit=100&offset={n}
// Paginated: pages of 100, read until the last page, and never more than 10 pages.
// Company ids are case-insensitive for the API, so keys are lowercased.
import { getJson, isoDate } from "./http.ts";
import { SourceError, type NormalizedJob, type SourceAdapter } from "./types.ts";

const COMPANY_ID = /^[A-Za-z0-9_.-]+$/;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

interface PostingsPage {
  totalFound?: number;
  content?: Posting[];
}

interface Posting {
  id?: string;
  name?: string;
  releasedDate?: string | null;
  company?: { identifier?: string; name?: string } | null;
  location?: {
    city?: string;
    region?: string;
    country?: string;
    remote?: boolean;
    fullLocation?: string;
  } | null;
}

export const smartrecruiters: SourceAdapter = {
  type: "smartrecruiters",
  label: "SmartRecruiters",

  matchLink(url) {
    const segments = url.pathname.split("/").filter(Boolean);
    let id: string | undefined;
    if (url.hostname === "careers.smartrecruiters.com") {
      // /{Company}, /{Company}/{anything}
      id = segments[0];
    } else if (url.hostname === "jobs.smartrecruiters.com") {
      // /oneclick-ui/company/{Company}/publication/{uuid}
      if (segments[0] === "oneclick-ui") id = segments[1] === "company" ? segments[2] : undefined;
      // /{Company}, /{Company}/{postingId}-{title}
      else id = segments[0];
    } else if (url.hostname === "api.smartrecruiters.com" && segments[0] === "v1" && segments[1] === "companies") {
      id = segments[2];
    }
    return id && COMPANY_ID.test(id) ? id.toLowerCase() : null;
  },

  async read(companyId, ctx) {
    const what = `the SmartRecruiters Company "${companyId}"`;
    const unexpected = `The SmartRecruiters Company "${companyId}" answered in an unexpected format`;
    const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyId)}/postings`;

    const postings: Posting[] = [];
    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
      const offset = pageIndex * PAGE_SIZE;
      const body = (await getJson(ctx, `${base}?limit=${PAGE_SIZE}&offset=${offset}`, what)) as PostingsPage | null;
      const content = body?.content;
      if (!Array.isArray(content)) throw new SourceError(unexpected);
      postings.push(...content);
      const total = typeof body?.totalFound === "number" ? body.totalFound : Infinity;
      if (content.length < PAGE_SIZE || offset + content.length >= total) break;
    }

    const jobs: NormalizedJob[] = postings.map((posting) => {
      if (!posting?.id || !posting.name) throw new SourceError(unexpected);
      const identifier = posting.company?.identifier || companyId;
      return {
        sourceJobId: String(posting.id),
        title: posting.name,
        url: `https://jobs.smartrecruiters.com/${encodeURIComponent(identifier)}/${encodeURIComponent(posting.id)}`,
        locations: locationsOf(posting),
        publishedAt: isoDate(posting.releasedDate),
      };
    });
    const companyName = postings.find((posting) => posting.company?.name)?.company?.name;
    return companyName ? { jobs, companyName } : { jobs };
  },
};

/** The location as published; a remote posting with no place is "Remote". */
function locationsOf(posting: Posting): string[] {
  const location = posting.location;
  const text =
    location?.fullLocation?.trim() ||
    [location?.city, location?.region, location?.country]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(", ");
  if (text) return [text];
  return location?.remote ? ["Remote"] : [];
}
