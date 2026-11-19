// RSS 2.0 / Atom job feeds. The Source key is the feed URL itself.
// Feeds have no recognisable link pattern: discovery finds them by fetching an
// unrecognised link once and checking the answer with parseFeed().
import { XMLParser } from "fast-xml-parser";
import { getText, isoDate } from "./http.ts";
import {
  SourceError,
  type NormalizedJob,
  type SourceAdapter,
  type SourceContext,
  type SourceRef,
} from "./types.ts";

/** At most this many `?paged=N` pages are read per refresh. */
export const FEED_MAX_PAGES = 10;

/** A parsed RSS or Atom document. */
export interface ParsedFeed {
  /** The feed's own title (channel / feed title), if any. */
  title?: string;
  /** Items in document order, normalized. */
  jobs: NormalizedJob[];
}

/** The document is RSS/Atom but an item can't be turned into a Job (no link). */
export class FeedItemError extends Error {}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => name === "item" || name === "entry" || name === "link",
});

/**
 * Is this response body an RSS 2.0 or Atom feed? Returns the parsed feed, or
 * null when it is anything else (HTML, JSON, broken XML…). Never throws for
 * "not a feed"; throws FeedItemError when it IS a feed but an item has no link.
 */
export function parseFeed(body: string): ParsedFeed | null {
  if (!/<(rss|feed)[\s>]/.test(body)) return null;
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
  const rss = doc.rss as Record<string, unknown> | undefined;
  if (rss !== undefined && "channel" in Object(rss)) {
    const channel = Object(rss.channel) as Record<string, unknown>; // "" for an empty <channel/>
    return { title: text(channel.title), jobs: list(channel.item).map(rssItem) };
  }
  if (doc.feed !== undefined) {
    const atom = Object(doc.feed) as Record<string, unknown>;
    return { title: text(atom.title), jobs: list(atom.entry).map(atomEntry) };
  }
  return null;
}

/**
 * "Fetch once, is it a feed?": given a link and the body it answered with,
 * returns the feed Source it designates, or null when the body isn't RSS/Atom.
 * A feed whose items can't be read still counts; the adapter read reports why.
 */
export function feedSourceFromPage(link: URL, body: string): SourceRef | null {
  try {
    if (!parseFeed(body)) return null;
  } catch (err) {
    if (!(err instanceof FeedItemError)) throw err;
  }
  return { type: "feed", key: feedKey(link) };
}

/** A feed URL as its Source key: no fragment, cache-buster or page number. */
export function feedKey(link: URL | string): string {
  const url = new URL(link);
  url.hash = "";
  url.searchParams.delete("_");
  url.searchParams.delete("paged");
  return url.href;
}

export const feed: SourceAdapter = {
  type: "feed",
  label: "RSS/Atom feed",

  matchLink() {
    return null; // found by content, not by URL pattern (see parseFeed)
  },

  async read(key, ctx) {
    const what = `the feed ${key}`;
    const jobs = new Map<string, NormalizedJob>();
    let title: string | undefined;

    for (let page = 1; page <= FEED_MAX_PAGES; page++) {
      const body = await getPage(ctx, key, page, what);
      if (body === null) break; // past the last page
      const parsed = parseOrFail(body, what);
      if (page === 1) title = parsed.title;
      const fresh = parsed.jobs.filter((job) => !jobs.has(job.sourceJobId));
      if (fresh.length === 0) break; // empty page, or the feed ignores ?paged
      for (const job of fresh) jobs.set(job.sourceJobId, job);
    }
    return title ? { jobs: [...jobs.values()], companyName: title } : { jobs: [...jobs.values()] };
  },
};

/** The URL of one page of a feed, with a fresh `_=` cache-buster. */
export function feedPageUrl(key: string, page: number): string {
  const url = new URL(key);
  if (page > 1) url.searchParams.set("paged", String(page));
  url.searchParams.set("_", Math.random().toString(36).slice(2));
  return url.toString();
}

async function getPage(ctx: SourceContext, key: string, page: number, what: string): Promise<string | null> {
  try {
    return await getText(ctx, feedPageUrl(key, page), what);
  } catch (err) {
    // WordPress answers 404 for ?paged past the last page: that's the end, not a failure.
    if (page > 1 && err instanceof SourceError && /HTTP 404/.test(err.message)) return null;
    throw err;
  }
}

function parseOrFail(body: string, what: string): ParsedFeed {
  const unexpected = `${what.charAt(0).toUpperCase()}${what.slice(1)} isn't a readable RSS or Atom feed`;
  try {
    const parsed = parseFeed(body);
    if (parsed) return parsed;
  } catch (err) {
    if (!(err instanceof FeedItemError)) throw err;
  }
  throw new SourceError(unexpected);
}

function rssItem(item: Record<string, unknown>): NormalizedJob {
  const link = text(list(item.link)[0]);
  const title = text(item.title);
  if (!link || !title) throw new FeedItemError();
  return {
    sourceJobId: text(item.guid) || link,
    title,
    url: link,
    locations: locations(item),
    publishedAt: isoDate(text(item.pubDate) ?? text(item["dc:date"])),
  };
}

function atomEntry(entry: Record<string, unknown>): NormalizedJob {
  const links = list(entry.link) as Record<string, unknown>[];
  const alternate = links.find((l) => (l["@_rel"] ?? "alternate") === "alternate") ?? links[0];
  const link = typeof alternate?.["@_href"] === "string" ? alternate["@_href"].trim() : undefined;
  const title = text(entry.title);
  if (!link || !title) throw new FeedItemError();
  return {
    sourceJobId: text(entry.id) || link,
    title,
    url: link,
    locations: locations(entry),
    publishedAt: isoDate(text(entry.published) ?? text(entry.updated)),
  };
}

/** Any `location` element, whatever its namespace prefix (e.g. `job_listing:location`). */
function locations(item: Record<string, unknown>): string[] {
  return Object.entries(item)
    .filter(([name]) => name.split(":").pop() === "location")
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .map(text)
    .filter((value): value is string => !!value);
}

/** Text of an element that may carry attributes (`{ "#text": … }`). */
function text(value: unknown): string | undefined {
  if (value && typeof value === "object" && "#text" in value) value = (value as { "#text": unknown })["#text"];
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function list(value: unknown): Record<string, unknown>[] {
  if (value === undefined || value === null || value === "") return [];
  return (Array.isArray(value) ? value : [value]) as Record<string, unknown>[];
}
