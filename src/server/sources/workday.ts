// Workday careers sites ({tenant}.wd{N}.myworkdayjobs.com/{site}) read their Jobs from a
// public JSON search API:
//   POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
//   {"limit":20,"offset":{n},"searchText":"","appliedFacets":{}}
// Paginated: pages of 20 (the API refuses more), read until the total the first page
// announces (later pages say 0), and never more than 50 pages.
// The key is "{tenant}.wd{N}/{site}", e.g. "temenos.wd103/Temenoscareers": the tenant and
// data centre make the host, the site is the careers site's own path. A Company name says
// neither, so name discovery doesn't try Workday.
import { postJson } from "./http.ts";
import { SourceError, type NormalizedJob, type SourceAdapter } from "./types.ts";

const HOST = /^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/;
const KEY = /^([a-z0-9-]+)\.(wd\d+)\/([A-Za-z0-9_.-]+)$/;
const SITE = /^[A-Za-z0-9_.-]+$/;
/** "/en-US/{site}": a locale segment before the site, ignored. */
const LOCALE = /^[a-z]{2}(?:-[a-z]{2})?$/i;
const PAGE_SIZE = 20;
const MAX_PAGES = 50;

interface JobsPage {
  total?: number;
  jobPostings?: Posting[];
}

interface Posting {
  title?: string;
  /** "/job/{location}/{slug}_{reqId}", relative to the site. */
  externalPath?: string;
  /** One location, or "3 Locations" when there are several. */
  locationsText?: string;
  /** Relative text only ("Posted Today", "Posted 30+ Days Ago"), so never a publishedAt. */
  postedOn?: string;
  /** The requisition id first, on the sites seen so far. */
  bulletFields?: string[];
}

export const workday: SourceAdapter = {
  type: "workday",
  label: "Workday",

  matchLink(url) {
    const host = HOST.exec(url.hostname.toLowerCase());
    if (!host) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    let site: string | undefined;
    if (segments[0] === "wday" && segments[1] === "cxs") {
      // /wday/cxs/{tenant}/{site}/jobs, the API itself
      site = segments[3];
    } else {
      // /{site}, /{locale}/{site}, /{site}/job/{location}/{slug}_{reqId}
      site = segments[0] && LOCALE.test(segments[0]) ? segments[1] : segments[0];
    }
    return site && SITE.test(site) ? `${host[1]}.${host[2]}/${site}` : null;
  },

  nameFromKey(key) {
    return KEY.exec(key)?.[1] ?? key;
  },

  async read(key, ctx) {
    const what = `the Workday site "${key}"`;
    const unexpected = `The Workday site "${key}" answered in an unexpected format`;
    const parts = KEY.exec(key);
    if (!parts) throw new SourceError(`"${key}" isn't a Workday site`);
    const [, tenant, dataCentre, site] = parts as unknown as [string, string, string, string];
    const origin = `https://${tenant}.${dataCentre}.myworkdayjobs.com`;
    const api = `${origin}/wday/cxs/${tenant}/${site}/jobs`;

    const postings: Posting[] = [];
    let total = Infinity;
    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
      const offset = pageIndex * PAGE_SIZE;
      const search = { limit: PAGE_SIZE, offset, searchText: "", appliedFacets: {} };
      const body = (await postJson(ctx, api, search, what)) as JobsPage | null;
      const page = body?.jobPostings;
      if (!Array.isArray(page)) throw new SourceError(unexpected);
      // Only the first page's total is right; later pages say 0.
      if (pageIndex === 0 && typeof body?.total === "number") total = body.total;
      postings.push(...page);
      if (page.length < PAGE_SIZE || offset + page.length >= total) break;
    }

    // A Job published while paging shifts the offsets: the same posting may come twice.
    const unique = new Map<string, Posting>();
    for (const posting of postings) {
      if (!posting?.title || !posting.externalPath?.startsWith("/")) throw new SourceError(unexpected);
      unique.set(posting.externalPath, posting);
    }
    const requisitionCount = new Map<string, number>();
    for (const posting of unique.values()) {
      const req = requisitionOf(posting);
      if (req) requisitionCount.set(req, (requisitionCount.get(req) ?? 0) + 1);
    }

    const jobs: NormalizedJob[] = [...unique.values()].map((posting) => {
      const req = requisitionOf(posting);
      return {
        // The requisition id, unless the requisition is posted more than once on the site.
        sourceJobId: req && requisitionCount.get(req) === 1 ? req : posting.externalPath!,
        title: posting.title!,
        url: `${origin}/${site}${posting.externalPath}`,
        locations: posting.locationsText?.trim() ? [posting.locationsText.trim()] : [],
        publishedAt: null,
      };
    });
    return { jobs };
  },
};

function requisitionOf(posting: Posting): string | undefined {
  const first = posting.bulletFields?.[0];
  return typeof first === "string" && first.trim() ? first.trim() : undefined;
}
