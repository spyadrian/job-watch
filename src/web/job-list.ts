// The pure job-list module: no DOM, no network. It owns every Filter, sort and
// search rule; the UI only paginates and renders its output.
import type { Filter, Job, JobStatus } from "../shared/types.ts";
import { matchesSearch, searchHighlights, searchWords } from "./search.ts";

export type { Filter, Job, JobStatus };

export type ListKind = "inbox" | "saved" | "applied" | "seen";

/** A character range [start, end) of one field to highlight. */
export interface Highlight {
  start: number;
  end: number;
  kind: "required" | "boosted" | "search";
}

/** Highlights per field: title, Company, and one array per location (same order as `job.locations`). */
export interface RowHighlights {
  title: Highlight[];
  company: Highlight[];
  locations: Highlight[][];
}

export interface JobRow {
  job: Job;
  highlights: RowHighlights;
}

export const emptyFilter: Filter = { cities: [], required: [], boosted: [], excluded: [] };

const statusOfList: Record<ListKind, JobStatus> = {
  inbox: "unseen",
  saved: "saved",
  applied: "applied",
  seen: "seen",
};

/** The ordered rows to show for one list. */
export function jobRows(jobs: readonly Job[], list: ListKind, _filter: Filter, query: string): JobRow[] {
  const words = searchWords(query);
  return jobs
    .filter((job) => job.status === statusOfList[list])
    .filter((job) => matchesSearch(job, words))
    .sort(compareJobs)
    .map((job) => ({ job, highlights: searchHighlights(job, words) }));
}

const titleCollator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** First-fetched date (newest first), then publication date (newest first, missing last), then title. */
function compareJobs(a: Job, b: Job): number {
  return (
    time(b.firstFetchedAt) - time(a.firstFetchedAt) ||
    time(b.publishedAt) - time(a.publishedAt) ||
    titleCollator.compare(a.title, b.title)
  );
}

/** Milliseconds since epoch; a missing date sorts after every real one. */
function time(iso: string | null): number {
  if (iso === null) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}
