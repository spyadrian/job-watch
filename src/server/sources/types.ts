// The shared Source adapter interface. One adapter per Source type; adding an
// ATS means adding one adapter file and registering it in ./index.ts.
import type { SourceRef, SourceType } from "../../shared/types.ts";

export type { SourceRef, SourceType };

/** One Job as a Source publishes it, normalized to the same shape for every adapter. */
export interface NormalizedJob {
  /** The Source's own Job id; with the Company it is the Job's identity. */
  sourceJobId: string;
  title: string;
  /** The Job's own page. */
  url: string;
  /** Locations exactly as published, in order (empty when none). */
  locations: string[];
  /** ISO 8601 (UTC), or null when the Source doesn't give one. */
  publishedAt: string | null;
}

/** The complete result of reading a Source. */
export interface SourceRead {
  jobs: NormalizedJob[];
  /** The Company's name when the Source states it (used to suggest a name at discovery). */
  companyName?: string;
}

export interface SourceContext {
  fetch: typeof globalThis.fetch;
  /** Per-request timeout in ms; defaults to SOURCE_TIMEOUT_MS (tests shorten it). */
  sourceTimeoutMs?: number;
}

export interface SourceAdapter {
  type: SourceType;
  /** Human-readable Source type, e.g. "Greenhouse". */
  label: string;
  /**
   * Recognises a job board or single-Job link of this Source type and returns
   * the Source key (slug or feed URL), or null when the link isn't one of ours.
   */
  matchLink(url: URL): string | null;
  /** Reads every Job of the Source. Throws SourceError on any failure; never returns a partial list. */
  read(key: string, ctx: SourceContext): Promise<SourceRead>;
}

/** A Source couldn't be read; `message` is shown to the person as-is. */
export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceError";
  }
}
