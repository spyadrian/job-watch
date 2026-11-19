import { SourceError, type SourceContext } from "./types.ts";

/** Every Source request gives up after this long. */
export const SOURCE_TIMEOUT_MS = 15_000;

/**
 * GETs a Source URL with a timeout and returns the response body as text.
 * Network errors, timeouts and non-2xx answers become a SourceError.
 */
export async function getText(ctx: SourceContext, url: string, what: string): Promise<string> {
  let res: Response;
  try {
    res = await ctx.fetch(url, { signal: AbortSignal.timeout(ctx.sourceTimeoutMs ?? SOURCE_TIMEOUT_MS), redirect: "follow" });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new SourceError(timedOut ? `${what} didn't answer in time` : `Couldn't reach ${what}`);
  }
  if (res.status === 404) throw new SourceError(`${capitalize(what)} doesn't exist (HTTP 404)`);
  if (!res.ok) throw new SourceError(`${capitalize(what)} answered with an error (HTTP ${res.status})`);
  return res.text();
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Like getText, then parses JSON; an unparsable body is a SourceError. */
export async function getJson(ctx: SourceContext, url: string, what: string): Promise<unknown> {
  const text = await getText(ctx, url, what);
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
