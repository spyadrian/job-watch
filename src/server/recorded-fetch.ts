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
}

/** URL → response. Keys are full URLs; the `_` cache-busting query parameter is ignored. */
export type RecordedSources = Record<string, RecordedResponse>;

/**
 * A `fetch` that never touches the network: it answers from recorded Source
 * responses and fails like a network error for any URL that wasn't recorded.
 */
export function createRecordedFetch(sources: RecordedSources, baseDir = process.cwd()): typeof fetch {
  const table = new Map<string, RecordedResponse>();
  for (const [url, res] of Object.entries(sources)) table.set(normalizeUrl(url), res);

  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    init?.signal?.throwIfAborted();
    const recorded = table.get(normalizeUrl(url));
    if (!recorded) throw new TypeError(`fetch failed: no recorded response for ${url}`);

    let body: string;
    if (recorded.file !== undefined) body = readFileSync(resolve(baseDir, recorded.file), "utf8");
    else if (typeof recorded.body === "string") body = recorded.body;
    else body = JSON.stringify(recorded.body ?? null);

    const contentType =
      recorded.contentType ?? (typeof recorded.body === "string" || recorded.file ? "text/plain" : "application/json");
    return new Response(body, { status: recorded.status ?? 200, headers: { "content-type": contentType } });
  };
}

/** Loads a JSON manifest of RecordedSources; fixture `file` paths are relative to the manifest. */
export function loadRecordedFetch(manifestPath: string): typeof fetch {
  const sources = JSON.parse(readFileSync(manifestPath, "utf8")) as RecordedSources;
  return createRecordedFetch(sources, dirname(resolve(manifestPath)));
}

function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.searchParams.delete("_");
  url.searchParams.sort();
  url.hash = "";
  return url.toString();
}
