import { SourceError, type SourceContext } from "./types.ts";

/** Every Source request gives up after this long. */
export const SOURCE_TIMEOUT_MS = 15_000;

/**
 * GETs a Source URL with a timeout and returns the response body as text.
 * Network errors, timeouts and non-2xx answers become a SourceError.
 */
export async function getText(ctx: SourceContext, url: string, what: string): Promise<string> {
  return (await getPage(ctx, url, what)).text;
}

/** Like getText, also telling the URL the body finally came from (after redirects). */
export async function getPage(ctx: SourceContext, url: string, what: string): Promise<{ url: string; text: string }> {
  return request(ctx, url, {}, what);
}

/**
 * Sends a request with the Source timeout and returns the body with the URL it finally
 * came from; network errors, timeouts and non-2xx answers become a SourceError.
 */
async function request(ctx: SourceContext, url: string, init: RequestInit, what: string): Promise<{ url: string; text: string }> {
  let res: Response;
  try {
    res = await ctx.fetch(url, {
      ...init,
      signal: AbortSignal.timeout(ctx.sourceTimeoutMs ?? SOURCE_TIMEOUT_MS),
      redirect: "follow",
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new SourceError(timedOut ? `${what} didn't answer in time` : `Couldn't reach ${what}`);
  }
  if (res.status === 404) throw new SourceError(`${capitalize(what)} doesn't exist (HTTP 404)`, 404);
  if (!res.ok) throw new SourceError(`${capitalize(what)} answered with an error (HTTP ${res.status})`, res.status);
  return { url: res.url || url, text: await res.text() };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Like getText, then parses JSON; an unparsable body is a SourceError. */
export async function getJson(ctx: SourceContext, url: string, what: string): Promise<unknown> {
  return parseJson(await getText(ctx, url, what), what);
}

/** POSTs `body` as JSON (for APIs that only answer a JSON search request), then parses the JSON answer like getJson. */
export async function postJson(ctx: SourceContext, url: string, body: unknown, what: string): Promise<unknown> {
  const init: RequestInit = {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  };
  return parseJson((await request(ctx, url, init, what)).text, what);
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new SourceError(`${capitalize(what)} didn't answer with valid JSON`);
  }
}

/** Parses a date the Source gave into ISO 8601 UTC, or null if absent or unreadable. */
export function isoDate(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Runs `task` on every item with at most `limit` running at once and gives the results in
 * the items' order. The first failure rejects the whole run and stops starting new tasks,
 * so a paged read never yields a partial list.
 */
export async function mapConcurrently<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  async function worker(): Promise<void> {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await task(items[index]!);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
