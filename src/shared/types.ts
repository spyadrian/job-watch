// Shapes exchanged over the JSON HTTP API, shared by server and front end.
// Vocabulary follows GLOSSARY.md.

export type JobStatus = "unseen" | "seen" | "saved" | "applied";

/** POST /api/jobs/:id/status { action }: the actions of the spec's status table. */
export type JobAction = "seen" | "unseen" | "save" | "unsave" | "apply" | "unapply";

export interface Job {
  id: number;
  /** The Company's current display name (or its kept name once the Company is removed). */
  companyName: string;
  title: string;
  url: string;
  /** Locations exactly as the Source publishes them, in order. */
  locations: string[];
  /** ISO 8601, when the Source provides it. */
  publishedAt: string | null;
  /** ISO 8601, set when the Job is first stored. */
  firstFetchedAt: string;
  status: JobStatus;
  /** "Was Saved before Applied" flag. */
  wasSaved: boolean;
  outdated: boolean;
}

/** Every supported Source type; one Source adapter each (src/server/sources/). */
export type SourceType = "greenhouse" | "lever" | "lever-eu" | "ashby" | "smartrecruiters" | "recruitee" | "workable" | "personio" | "bamboohr" | "jibe" | "workday" | "feed";

/** Which Source a Company follows: its type plus slug (ATS) or feed URL (RSS/Atom). */
export interface SourceRef {
  type: SourceType;
  key: string;
}

/** One possible Source found by discovery, with its job count from an actual read. */
export interface Candidate {
  source: SourceRef;
  /** Human-readable Source type, e.g. "Greenhouse". */
  sourceLabel: string;
  suggestedName: string;
  jobCount: number;
  /** Name of the Company already following this Source, or null. */
  alreadyFollowing: string | null;
}

/** POST /api/companies/discover { input } → */
export interface DiscoverResponse {
  candidates: Candidate[];
  /** Set when the pasted link couldn't be opened: why, e.g. "Couldn't reach the page https://…". */
  unreachable?: string;
}

export interface Company {
  id: number;
  name: string;
  source: SourceRef;
  sourceLabel: string;
  createdAt: string;
  /** Why the Source failed on the last read, or null when it was read fine. */
  lastError: CompanyError | null;
}

/** A failed read of a Company's Source: the reason, and when (ISO 8601). */
export interface CompanyError {
  message: string;
  at: string;
}

/** GET /api/companies → followed Companies, by name. */
export interface CompaniesResponse {
  companies: Company[];
}

/** POST /api/companies { source, name } → 201 */
export interface CreateCompanyResponse {
  company: Company;
  /** How many Jobs were stored for the new Company. */
  jobCount: number;
}

/** A link to a careers site whose Jobs cannot be read automatically. */
export interface Shortcut {
  id: number;
  name: string;
  url: string;
}

/** What a refresh changed: new Jobs, Jobs that became Outdated, Sources that failed. */
export interface RefreshSummary {
  new: number;
  outdated: number;
  failed: number;
}

/**
 * POST /api/refresh streams these as NDJSON (one JSON object per line):
 * a start, one progress line per Source as it completes, then the summary.
 */
export type RefreshEvent =
  | { type: "start"; total: number }
  | { type: "progress"; done: number; total: number; companyId: number; companyName: string; error: string | null }
  | { type: "done"; summary: RefreshSummary };

export interface Filter {
  /** Each City filter is a list of spellings, e.g. ["Geneva", "Genève", "Genf"]. */
  cities: string[][];
  required: string[];
  boosted: string[];
  excluded: string[];
  /** Whether a Job with a remote location passes City filters ("Include remote Jobs"). */
  includeRemote: boolean;
}
