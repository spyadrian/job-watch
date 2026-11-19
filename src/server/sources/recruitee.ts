// Recruitee public offers API: GET https://{slug}.recruitee.com/api/offers/
import { getJson, isoDate } from "./http.ts";
import { SourceError, type NormalizedJob, type SourceAdapter } from "./types.ts";

const SLUG = /^[a-z0-9-]+$/;
/** Subdomains of Recruitee's own site, never a company's board. */
const RESERVED = new Set(["www", "app", "api", "help", "support", "blog", "docs", "status"]);

interface RecruiteeLocation {
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

interface RecruiteeOffer {
  id: number | string;
  title?: string;
  careers_url?: string;
  location?: string | null;
  remote?: boolean;
  locations?: RecruiteeLocation[] | null;
  published_at?: string | null;
  company_name?: string;
}

export const recruitee: SourceAdapter = {
  type: "recruitee",
  label: "Recruitee",

  matchLink(url) {
    // {slug}.recruitee.com, any path (board, /o/{offer}, /l/{lang}/o/{offer}, /api/offers/)
    const match = /^([^.]+)\.recruitee\.com$/.exec(url.hostname);
    const slug = match?.[1];
    return slug && SLUG.test(slug) && !RESERVED.has(slug) ? slug : null;
  },

  async read(slug, ctx) {
    const what = `the Recruitee board "${slug}"`;
    const unexpected = `The Recruitee board "${slug}" answered in an unexpected format`;
    const body = await getJson(ctx, `https://${slug}.recruitee.com/api/offers/`, what);
    const raw = (body as { offers?: unknown } | null)?.offers;
    if (!Array.isArray(raw)) throw new SourceError(unexpected);

    const jobs: NormalizedJob[] = (raw as RecruiteeOffer[]).map((offer) => {
      if (offer.id === undefined || !offer.title || !offer.careers_url) throw new SourceError(unexpected);
      return {
        sourceJobId: String(offer.id),
        title: offer.title,
        url: offer.careers_url,
        locations: locationsOf(offer),
        publishedAt: isoDate(offer.published_at),
      };
    });
    const companyName = (raw as RecruiteeOffer[]).find((offer) => offer.company_name)?.company_name;
    return companyName ? { jobs, companyName } : { jobs };
  },
};

/**
 * Every location of the offer, written the way Recruitee writes its main one
 * ("City, State, Country"); a remote offer starts with Recruitee's own remote label.
 */
function locationsOf(offer: RecruiteeOffer): string[] {
  const listed = (offer.locations ?? [])
    .map((loc) => [loc.city, loc.state, loc.country].map((part) => part?.trim()).filter(Boolean).join(", "))
    .filter(Boolean);
  const main = offer.location?.trim();
  if (listed.length === 0) return main ? [main] : [];
  return offer.remote && main && !listed.includes(main) ? [main, ...listed] : listed;
}
