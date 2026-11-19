// Source discovery: from what the person typed to zero or more Candidates,
// each read once through its adapter for an actual job count. Saves nothing.
import type { Candidate, SourceRef } from "../shared/types.ts";
import type { Database } from "./db.ts";
import { adapters, adapterFor, SourceError, type SourceContext } from "./sources/index.ts";

/** The input can't be used; `status` is the HTTP status to answer with. */
export class DiscoveryError extends Error {
  status: 400 | 502;
  constructor(message: string, status: 400 | 502) {
    super(message);
    this.name = "DiscoveryError";
    this.status = status;
  }
}

export interface DiscoveryDeps extends SourceContext {
  db: Database;
}

export async function discover(input: string, deps: DiscoveryDeps): Promise<Candidate[]> {
  const url = parseLink(input);
  if (!url) {
    throw new DiscoveryError(
      "That doesn't look like a link. Paste the link of a job board or of one of its Jobs.",
      400,
    );
  }

  const refs = sourcesFromLink(url);
  const results = await Promise.allSettled(refs.map((ref) => candidateFor(ref, deps)));
  const candidates = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const firstFailure = results.find((r) => r.status === "rejected");
  if (candidates.length === 0 && firstFailure) {
    const err = firstFailure.reason;
    if (err instanceof SourceError) throw new DiscoveryError(err.message, 502);
    throw err;
  }
  return candidates;
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

async function candidateFor(source: SourceRef, deps: DiscoveryDeps): Promise<Candidate> {
  const adapter = adapterFor(source.type)!;
  const read = await adapter.read(source.key, deps);
  const followed = deps.db
    .prepare("SELECT name FROM company WHERE source_type = ? AND source_key = ?")
    .get(source.type, source.key) as { name: string } | undefined;
  return {
    source,
    sourceLabel: adapter.label,
    suggestedName: read.companyName?.trim() || nameFromKey(source.key),
    jobCount: read.jobs.length,
    alreadyFollowing: followed?.name ?? null,
  };
}

function parseLink(input: string): URL | null {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;
  // Accept links pasted without a scheme ("job-boards.greenhouse.io/acme").
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname.includes(".")) return null;
    return url;
  } catch {
    return null;
  }
}

/** "acme-robotics" → "Acme Robotics" (fallback when the Source doesn't state a name). */
function nameFromKey(key: string): string {
  return key
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}
