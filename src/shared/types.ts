// Shapes exchanged over the JSON HTTP API, shared by server and front end.
// Vocabulary follows GLOSSARY.md.

export type JobStatus = "unseen" | "seen" | "saved" | "applied";

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

/** A link to a careers site whose Jobs cannot be read automatically. */
export interface Shortcut {
  id: number;
  name: string;
  url: string;
}

export interface Filter {
  /** Each City filter is a list of spellings, e.g. ["Geneva", "Genève", "Genf"]. */
  cities: string[][];
  required: string[];
  boosted: string[];
  excluded: string[];
}
