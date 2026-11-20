// The pure job-list module: no DOM, no network. It owns every Filter, sort and
// search rule; the UI only paginates and renders its output.
import type { Filter, Job, JobStatus } from "../shared/types.ts";
import { isBoosted, keywordHighlights, passesFilter } from "./filter.ts";
import { matchesSearch, searchHighlights, searchWords } from "./search.ts";
import { byPosition } from "./text-match.ts";

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

export const emptyFilter: Filter = { cities: [], required: [], boosted: [], excluded: [], includeRemote: true };

const statusOfList: Record<ListKind, JobStatus> = {
  inbox: "unseen",
  saved: "saved",
  applied: "applied",
  seen: "seen",
};

/** The ordered rows to show for one list. */
export function jobRows(jobs: readonly Job[], list: ListKind, filter: Filter, query: string): JobRow[] {
  const inbox = list === "inbox";
  const words = searchWords(query);
  return jobs
    .filter((job) => job.status === statusOfList[list])
    .filter((job) => !inbox || passesFilter(job, filter))
    .filter((job) => matchesSearch(job, words))
    .map((job) => ({ job, boosted: inbox && isBoosted(job, filter) }))
    .sort((a, b) => Number(b.boosted) - Number(a.boosted) || compareJobs(a.job, b.job))
    .map(({ job }) => {
      const highlights = searchHighlights(job, words);
      highlights.title = [...keywordHighlights(job.title, filter), ...highlights.title].sort(byPosition);
      return { job, highlights };
    });
}

/** Why a list has no rows. */
export type EmptyListState =
  | { kind: "loading" }
  | { kind: "no-match"; query: string }
  | { kind: "no-company" }
  | { kind: "caught-up"; hiddenByFilter: number }
  | { kind: "list-message" };

/** What the page knows so far: whether the Jobs have loaded, and whether any Company is followed. */
export interface LoadState {
  jobsLoaded: boolean;
  companies: "loading" | "failed" | "none" | "some";
}

/**
 * Why `jobRows(jobs, list, filter, query)` is empty: not known yet (still loading), a search
 * that matches nothing, an Inbox with no Company followed, an Inbox with nothing new to review
 * (some Unseen Jobs maybe hidden by the Filter), or any other list's own empty message.
 * When the Companies failed to load, the Inbox doesn't claim none are followed.
 */
export function emptyListState(
  jobs: readonly Job[],
  list: ListKind,
  filter: Filter,
  query: string,
  loaded: LoadState,
): EmptyListState {
  if (!loaded.jobsLoaded) return { kind: "loading" };
  if (query.trim() !== "" && jobRows(jobs, list, filter, "").length > 0) return { kind: "no-match", query: query.trim() };
  if (list !== "inbox") return { kind: "list-message" };
  if (loaded.companies === "loading") return { kind: "loading" };
  const hiddenByFilter = jobs.filter((job) => job.status === "unseen" && !passesFilter(job, filter)).length;
  if (loaded.companies === "none" && hiddenByFilter === 0) return { kind: "no-company" };
  return { kind: "caught-up", hiddenByFilter };
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
