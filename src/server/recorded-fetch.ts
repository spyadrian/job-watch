import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** A canned HTTP response for one URL. */
export interface RecordedResponse {
  status?: number;
  contentType?: string;
  /** Inline body (string, or a value serialised as JSON). */
  body?: unknown;
  /** Path of a fixture file holding the body, relative to the manifest (or absolute). */
  file?: string;
  /** With a 3xx status: where the response redirects to (followed unless `redirect: "manual"`). */
  location?: string;
}

/**
 * Request → response. A GET is keyed by its full URL; a POST by `POST {url} {JSON body}`
 * (the body's key order doesn't matter). The `_` cache-busting query parameter is ignored.
 */
export type RecordedSources = Record<string, RecordedResponse>;

/**
 * A `fetch` that never touches the network: it answers from recorded Source
 * responses and fails like a network error for any request that wasn't recorded.
 */
export function createRecordedFetch(sources: RecordedSources, baseDir = process.cwd()): typeof fetch {
  const table = new Map<string, RecordedResponse>();
  for (const [key, res] of Object.entries(sources)) table.set(normalizeKey(key), res);

  return async (input, init) => {
    let url = input instanceof Request ? input.url : String(input);
    init?.signal?.throwIfAborted();
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const keyFor = (u: string) => (method === "GET" ? u : `${method} ${u} ${typeof init?.body === "string" ? init.body : ""}`);
    let recorded = table.get(normalizeKey(keyFor(url)));
    for (let hops = 0; recorded?.location !== undefined && init?.redirect !== "manual"; hops++) {
      if (hops === 20) throw new TypeError(`fetch failed: too many redirects from ${url}`);
      url = new URL(recorded.location, url).href;
      recorded = table.get(normalizeKey(keyFor(url)));
    }
    if (!recorded) throw new TypeError(`fetch failed: no recorded response for ${keyFor(url)}`);

    let body: string;
    if (recorded.file !== undefined) body = readFileSync(resolve(baseDir, recorded.file), "utf8");
    else if (typeof recorded.body === "string") body = recorded.body;
    else body = JSON.stringify(recorded.body ?? null);

    const contentType =
      recorded.contentType ?? (typeof recorded.body === "string" || recorded.file ? "text/plain" : "application/json");
    const headers: Record<string, string> = { "content-type": contentType };
    if (recorded.location !== undefined) headers.location = recorded.location;
    const res = new Response(body, { status: recorded.status ?? 200, headers });
    // Like a real fetch, the response tells the URL it finally came from.
    Object.defineProperty(res, "url", { value: url });
    return res;
  };
}

/** Loads a JSON manifest of RecordedSources; fixture `file` paths are relative to the manifest. */
export function loadRecordedFetch(manifestPath: string): typeof fetch {
  const sources = JSON.parse(readFileSync(manifestPath, "utf8")) as RecordedSources;
  return createRecordedFetch(sources, dirname(resolve(manifestPath)));
}

/** "https://…" stays a GET URL; "POST https://… {body}" gets its URL and JSON body normalized. */
function normalizeKey(key: string): string {
  const request = /^([A-Z]+) (\S+) ?([\s\S]*)$/.exec(key);
  if (!request) return normalizeUrl(key);
  const [, method, url, body] = request;
  return `${method} ${normalizeUrl(url!)} ${canonicalJson(body!)}`;
}

/** The body as JSON with sorted object keys and no spacing, or as written if it isn't JSON. */
function canonicalJson(body: string): string {
  try {
    return JSON.stringify(sortKeys(JSON.parse(body)));
  } catch {
    return body;
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.searchParams.delete("_");
  url.searchParams.sort();
  url.hash = "";
  return url.toString();
}
