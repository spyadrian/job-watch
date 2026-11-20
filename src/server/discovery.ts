// Source discovery: from what the person typed to zero or more Candidates,
// each read once through its adapter for an actual job count. Saves nothing.
import type { Candidate, DiscoverResponse, SourceRef } from "../shared/types.ts";
import { companyFollowing } from "./companies.ts";
import type { Database } from "./db.ts";
import { RequestError } from "./errors.ts";
import { feedKey, feedSourceFromPage } from "./sources/feed.ts";
import { getText } from "./sources/http.ts";
import { adapters, adapterFor, SourceError, type SourceContext } from "./sources/index.ts";

/** The input can't be used, or no Source it designates could be read. */
export class DiscoveryError extends RequestError {
  constructor(message: string, status: 400 | 502) {
    super(message, status);
    this.name = "DiscoveryError";
  }
}

export interface DiscoveryDeps extends SourceContext {
  db: Database;
}

export async function discover(input: string, deps: DiscoveryDeps): Promise<DiscoverResponse> {
  const url = parseLink(input);
  if (!url) {
    if (input.includes("://")) {
      throw new DiscoveryError(
        "That doesn't look like a link. Paste the link of a job board or of one of its Jobs.",
        400,
      );
    }
    return { candidates: await discoverByName(input, deps) };
  }
  if (!mayBeName(input, url)) return discoverByLink(url, deps);

  // "Booking.com", "monday.com": a bare host may be the site or the Company's name. Try both.
  const [byLink, byName] = await Promise.all([
    discoverByLink(url, deps).catch((err: unknown) => {
      if (err instanceof DiscoveryError) return err;
      throw err;
    }),
    discoverByName(input, deps),
  ]);
  const fromLink = byLink instanceof DiscoveryError ? [] : byLink.candidates;
  const seen = new Set(fromLink.map((c) => `${c.source.type}:${c.source.key}`));
  const merged = [...fromLink, ...byName.filter((c) => !seen.has(`${c.source.type}:${c.source.key}`))];
  // A feed the site advertises is likely its news, not its Jobs, once an ATS board is known.
  const candidates = merged.some((c) => c.source.type !== "feed") ? merged.filter((c) => c.source.type !== "feed") : merged;
  if (byLink instanceof DiscoveryError) {
    if (candidates.length === 0) throw byLink;
    return { candidates };
  }
  return byLink.unreachable === undefined ? { candidates } : { candidates, unreachable: byLink.unreachable };
}

/** Input typed without a scheme that is only a host ("Booking.com") could also be a Company name. */
function mayBeName(input: string, url: URL): boolean {
  return !hasScheme(input.trim()) && url.pathname === "/" && !url.search && !url.hash && !input.trim().endsWith("/");
}

function hasScheme(text: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
}

/**
 * The Sources a link designates: a known job board or Job link, else whatever the
 * page it opens is (a feed) or embeds (ATS boards). A page with no board leads to
 * the boards found for the site's name, and only failing those, to the feeds the
 * page advertises (often its news). When the page can't be opened, `unreachable` says why.
 */
async function discoverByLink(url: URL, deps: DiscoveryDeps): Promise<DiscoverResponse> {
  const refs = sourcesFromLink(url);
  if (refs.length > 0) return readCandidates(refs, deps);

  // No known link pattern: fetch the link once; an RSS/Atom answer is itself the Source.
  const page = await fetchPage(url, deps);
  if ("body" in page) {
    const feedRef = feedSourceFromPage(url, page.body);
    if (feedRef) return readCandidates([feedRef], deps);
  }
  const inPage = "body" in page ? sourcesInPage(url, page.body) : [];
  const boards = inPage.filter((ref) => ref.type !== "feed");
  if (boards.length > 0) return readCandidates(boards, deps);

  const byName = await discoverByName(siteName(url), deps);
  const found = byName.length > 0 ? { candidates: byName } : await readCandidates(inPage, deps);
  return "unreachable" in page ? { candidates: found.candidates, unreachable: page.unreachable } : found;
}

/** Reads each Source once; fails only when every one of them failed. */
async function readCandidates(refs: SourceRef[], deps: DiscoveryDeps): Promise<DiscoverResponse> {
  const results = await Promise.allSettled(refs.map((ref) => candidateFor(ref, deps)));
  const candidates = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const firstFailure = results.find((r) => r.status === "rejected");
  if (candidates.length === 0 && firstFailure) {
    const err = firstFailure.reason;
    if (err instanceof SourceError) throw new DiscoveryError(err.message, 502);
    throw err;
  }
  return { candidates };
}

/**
 * Tries a Company name's candidate slugs on every ATS in parallel. A board that
 * can't be read simply isn't a candidate; neither is an empty board on an ATS that
 * answers unknown keys with an empty board, since that proves nothing.
 */
async function discoverByName(name: string, deps: DiscoveryDeps): Promise<Candidate[]> {
  const slugs = slugsForName(name);
  const tries = adapters
    .filter((adapter) => adapter.type !== "feed" && adapter.triedByName !== false)
    .flatMap((adapter) => slugs.map((slug) => ({ adapter, ref: { type: adapter.type, key: slug } })));
  const results = await Promise.allSettled(
    tries.map(async ({ adapter, ref }) => {
      const candidate = await candidateFor(ref, deps);
      return candidate.jobCount === 0 && adapter.unknownKeyReadsEmpty ? null : candidate;
    }),
  );
  return results.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
}

/**
 * "Café Zürich" → ["cafezurich", "cafe-zurich", "cafe"]: lowercase, no accents, one word,
 * hyphenated, and the first word alone ("Rai Institute" is `rai` on Lever). A dotted
 * name is also tried as written ("mistral.ai" is an Ashby board).
 */
export function slugsForName(name: string): string[] {
  const plain = name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
  const words = plain.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return [];
  const slugs = [words.join(""), words.join("-")];
  if (words.length > 1) slugs.push(words[0]!);
  if (PLAUSIBLE_HOST.test(plain)) slugs.push(plain);
  return [...new Set(slugs)];
}

/** Matches a link against every adapter's known link patterns. */
export function sourcesFromLink(url: URL): SourceRef[] {
  const refs: SourceRef[] = [];
  for (const adapter of adapters) {
    const key = adapter.matchLink(url);
    if (key !== null) refs.push({ type: adapter.type, key });
  }
  return refs;
}

/** At most this many Sources are read from one careers page. */
const MAX_PAGE_SOURCES = 10;

/**
 * The Sources an HTML page points to: embedded ATS boards (any link, iframe or
 * script URL matching an adapter's link patterns). Jobs are never read from the HTML itself.
 */
export function sourcesInPage(pageUrl: URL, html: string): SourceRef[] {
  // URLs may sit in attributes (&amp;-escaped) or in inline JSON (\/-escaped).
  const text = html.replaceAll("\\/", "/").replaceAll("&amp;", "&");
  const found = new Map<string, SourceRef>();
  for (const [raw] of text.matchAll(/(?:https?:)?\/\/[^\s"'<>`\\()]+/gi)) {
    let url: URL;
    try {
      url = new URL(raw, pageUrl);
    } catch {
      continue;
    }
    for (const ref of sourcesFromLink(url)) found.set(`${ref.type}:${ref.key}`, ref);
  }
  for (const href of alternateFeedLinks(html)) {
    try {
      const key = feedKey(new URL(href, pageUrl));
      found.set(`feed:${key}`, { type: "feed", key });
    } catch {
      // An href that isn't a URL designates nothing.
    }
  }
  return [...found.values()].slice(0, MAX_PAGE_SOURCES);
}

const FEED_TYPES = new Set(["application/rss+xml", "application/atom+xml"]);

/** The href of every `<link rel="alternate" type="application/rss+xml|atom+xml">` in the page. */
function alternateFeedLinks(html: string): string[] {
  const hrefs: string[] = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    for (const m of tag.matchAll(/([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      attrs.set(m[1]!.toLowerCase(), decodeEntities(m[2] ?? m[3] ?? m[4] ?? ""));
    }
    const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/);
    const type = (attrs.get("type") ?? "").toLowerCase().trim();
    const href = attrs.get("href")?.trim();
    if (rel.includes("alternate") && FEED_TYPES.has(type) && href) hrefs.push(href);
  }
  return hrefs;
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

/** The body behind a link, or why it can't be fetched (then it yields no Source). */
async function fetchPage(url: URL, deps: DiscoveryDeps): Promise<{ body: string } | { unreachable: string }> {
  try {
    return { body: await getText(deps, url.href, `the page ${url.href}`) };
  } catch (err) {
    if (err instanceof SourceError) return { unreachable: err.message };
    throw err;
  }
}

async function candidateFor(source: SourceRef, deps: DiscoveryDeps): Promise<Candidate> {
  const adapter = adapterFor(source.type)!;
  const read = await adapter.read(source.key, deps);
  const followed = companyFollowing(deps.db, source);
  return {
    source,
    sourceLabel: adapter.label,
    suggestedName:
      read.companyName?.trim() ||
      (source.type === "feed"
        ? nameFromHost(source.key)
        : nameFromKey(adapter.nameFromKey ? adapter.nameFromKey(source.key) : source.key)),
    jobCount: read.jobs.length,
    alreadyFollowing: followed?.name ?? null,
  };
}

/** A host name a person could type: labels, then a real-looking top-level domain. */
const PLAUSIBLE_HOST = /^(?:[a-z0-9-]+\.)+(?:[a-z]{2,}|xn--[a-z0-9-]+)$/;

function parseLink(input: string): URL | null {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;
  // Accept links pasted without a scheme ("job-boards.greenhouse.io/acme"), if the host
  // is plausible: otherwise "Acme.x1" is a name, not a site to fetch.
  const schemeless = !hasScheme(text);
  try {
    const url = new URL(schemeless ? `https://${text}` : text);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname.includes(".")) return null;
    if (schemeless && !PLAUSIBLE_HOST.test(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

/** "https://careers.acme.example/feed/" → "Acme": the site's main label (for a feed without a title). */
function nameFromHost(link: string): string {
  return nameFromKey(siteName(new URL(link)));
}

/** "careers.acme.example" → "acme": the label that names the site. */
function siteName(url: URL): string {
  const host = url.hostname.replace(/^(?:www|careers|jobs|karriere)\./, "");
  return host.split(".")[0] ?? host;
}

/** "acme-robotics" → "Acme Robotics" (fallback when the Source doesn't state a name). */
function nameFromKey(key: string): string {
  return key
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}
