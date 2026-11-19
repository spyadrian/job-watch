// Personio public XML feed: GET https://{slug}.jobs.personio.de/xml
// Boards live on both jobs.personio.de and jobs.personio.com; both serve the same feed.
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { getText, isoDate } from "./http.ts";
import { SourceError, type NormalizedJob, type SourceAdapter } from "./types.ts";

const SLUG = /^[a-z0-9-]+$/;
const HOST = /^([^.]+)\.jobs\.personio\.(?:de|com)$/;

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false, // keep ids and names as strings
  trimValues: true,
  isArray: (name) => name === "position" || name === "office",
});

interface PersonioPosition {
  id?: string;
  name?: string;
  subcompany?: string;
  office?: string[];
  additionalOffices?: { office?: string[] } | string;
  createdAt?: string;
}

export const personio: SourceAdapter = {
  type: "personio",
  label: "Personio",

  matchLink(url) {
    // {slug}.jobs.personio.de|com, any path (board, /job/{id}, /xml)
    const slug = HOST.exec(url.hostname)?.[1];
    return slug && SLUG.test(slug) ? slug : null;
  },

  async read(slug, ctx) {
    const what = `the Personio feed "${slug}"`;
    const unexpected = `The Personio feed "${slug}" answered in an unexpected format`;
    const text = await getText(ctx, `https://${slug}.jobs.personio.de/xml`, what);
    if (XMLValidator.validate(text) !== true) {
      throw new SourceError(`The Personio feed "${slug}" didn't answer with valid XML`);
    }
    const doc = parser.parse(text) as Record<string, unknown>;
    if (!("workzag-jobs" in doc)) throw new SourceError(unexpected);
    const root = doc["workzag-jobs"];
    // An empty feed parses to "", a feed with Jobs to { position: [...] }.
    const raw = root && typeof root === "object" ? ((root as { position?: unknown }).position ?? []) : [];
    if (!Array.isArray(raw)) throw new SourceError(unexpected);

    const jobs: NormalizedJob[] = (raw as PersonioPosition[]).map((position) => {
      if (!position.id || !position.name) throw new SourceError(unexpected);
      return {
        sourceJobId: position.id,
        title: position.name,
        url: `https://${slug}.jobs.personio.de/job/${encodeURIComponent(position.id)}`,
        locations: officesOf(position),
        publishedAt: isoDate(position.createdAt),
      };
    });
    const companyName = (raw as PersonioPosition[]).find((position) => position.subcompany)?.subcompany;
    return companyName ? { jobs, companyName } : { jobs };
  },
};

/** The main office, then the additional offices, as published. */
function officesOf(position: PersonioPosition): string[] {
  const additional = typeof position.additionalOffices === "object" ? (position.additionalOffices.office ?? []) : [];
  return [...(position.office ?? []), ...additional].filter((office) => typeof office === "string" && office !== "");
}
