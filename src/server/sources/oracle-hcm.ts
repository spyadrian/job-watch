// Oracle Cloud HCM (Oracle Recruiting Cloud "Candidate Experience") careers sites, read
// through the public REST API their own pages use (ADR 0002):
//   GET https://{host}/hcmRestApi/resources/latest/recruitingCESites?onlyData=true&finder=SiteByNumberFinder;SiteNumber={site}
//   GET https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true
//       &expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber={site},limit=200,offset={n},sortBy=POSTING_DATES_DESC
// The key is `{host}/{siteNumber}`, e.g. `iaadtu.fa.ocs.oraclecloud.eu/CX_1`.
//
// The site is looked up first: an instance answers an unknown site number with its default
// site's Jobs, so only the site record proves the key is right (and it states the site's name).
// Requisitions come in pages of at most 200 (larger limits are capped); pages advance by
// what the API actually returned, up to TotalJobsCount, and never more than 25 pages.
//
// Links on a Company's own domain (careers.oracle.com) or using the site's URL name
// (`/sites/jobsearch`) aren't matched here: their page states `siteNumber=CX_…` in the
// URLs it loads, which discovery finds through sourcesInPage.
import { getJson, isoDate } from "./http.ts";
import { SourceError, type NormalizedJob, type SourceAdapter } from "./types.ts";

const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.oraclecloud\.(?:com|eu)$/;
const SITE_NUMBER = /^CX_\d+$/i;
const PAGE_SIZE = 200;
const MAX_PAGES = 25;

interface Site {
  SiteNumber?: string;
  SiteName?: string | null;
  SeoOrganizationName?: string | null;
}

interface RequisitionsPage {
  items?: { TotalJobsCount?: number; requisitionList?: Requisition[] }[];
}

interface Requisition {
  Id?: string | number;
  Title?: string;
  PostedDate?: string | null;
  PrimaryLocation?: string | null;
  secondaryLocations?: { Name?: string | null }[] | null;
}

export const oracleHcm: SourceAdapter = {
  type: "oracle-hcm",
  label: "Oracle Cloud HCM",
  // Name discovery skips this adapter: an instance's host (e.g. iaadtu.fa.ocs.oraclecloud.eu)
  // can't be derived from a Company's name.

  matchLink(url) {
    const host = url.hostname.toLowerCase();
    if (!HOST.test(host)) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    let site: string | undefined;
    // /hcmUI/CandidateExperience/{lang}/sites/{site}[/requisitions|/jobs|/job/{id}…]
    if (segments[0] === "hcmUI" && segments[1] === "CandidateExperience" && segments[3] === "sites") site = segments[4];
    // Any API or asset URL naming the site: ?siteNumber=CX_1, or finder=findReqs;siteNumber=CX_1,…
    site ??= url.searchParams.get("siteNumber") ?? /(?:^|[;,])siteNumber=([^;,]+)/.exec(url.searchParams.get("finder") ?? "")?.[1];
    return site && SITE_NUMBER.test(site) ? `${host}/${site.toUpperCase()}` : null;
  },

  async read(key, ctx) {
    const what = `the Oracle Cloud HCM site "${key}"`;
    const unexpected = `The Oracle Cloud HCM site "${key}" answered in an unexpected format`;
    const slash = key.indexOf("/");
    const host = key.slice(0, slash);
    const siteNumber = key.slice(slash + 1);
    if (slash < 0 || !HOST.test(host) || !SITE_NUMBER.test(siteNumber)) {
      throw new SourceError(`"${key}" isn't an Oracle Cloud HCM site (expected host/CX_n)`);
    }
    const api = `https://${host}/hcmRestApi/resources/latest`;

    const sites = (await getJson(
      ctx,
      `${api}/recruitingCESites?onlyData=true&finder=SiteByNumberFinder;SiteNumber=${siteNumber}`,
      what,
    )) as { items?: Site[] } | null;
    if (!Array.isArray(sites?.items)) throw new SourceError(unexpected);
    const site = sites.items.find((s) => s?.SiteNumber?.toUpperCase() === siteNumber);
    if (!site) throw new SourceError(`The Oracle Cloud HCM site "${key}" doesn't exist`);

    const byId = new Map<string, Requisition>();
    let offset = 0;
    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
      const body = (await getJson(
        ctx,
        `${api}/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations` +
          `&finder=findReqs;siteNumber=${siteNumber},limit=${PAGE_SIZE},offset=${offset},sortBy=POSTING_DATES_DESC`,
        what,
      )) as RequisitionsPage | null;
      const search = body?.items?.[0];
      const list = search?.requisitionList;
      if (!Array.isArray(list) || typeof search?.TotalJobsCount !== "number") throw new SourceError(unexpected);
      for (const requisition of list) {
        if (requisition?.Id === undefined || requisition.Id === null || !requisition.Title) throw new SourceError(unexpected);
        // Pages are sorted by posting date; a tie may repeat a Job across pages.
        byId.set(String(requisition.Id), requisition);
      }
      offset += list.length;
      if (list.length === 0 || offset >= search.TotalJobsCount) break;
    }

    const jobs: NormalizedJob[] = [...byId].map(([id, requisition]) => ({
      sourceJobId: id,
      title: requisition.Title!,
      url: `https://${host}/hcmUI/CandidateExperience/en/sites/${siteNumber}/job/${encodeURIComponent(id)}`,
      locations: [requisition.PrimaryLocation, ...(requisition.secondaryLocations ?? []).map((l) => l?.Name)].flatMap(
        (location) => (typeof location === "string" && location.trim() ? [location.trim()] : []),
      ),
      publishedAt: isoDate(requisition.PostedDate),
    }));
    const companyName = site.SeoOrganizationName?.trim() || site.SiteName?.trim();
    return companyName ? { jobs, companyName } : { jobs };
  },
};
