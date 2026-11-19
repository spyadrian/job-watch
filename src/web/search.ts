// Full-text search: every word of the query must match the title, Company or a location.
import type { Job } from "../shared/types.ts";
import type { Highlight, RowHighlights } from "./job-list.ts";
import { findRanges } from "./text-match.ts";

/** The words of a search query (empty query → no words → every Job matches). */
export function searchWords(query: string): string[] {
  return query.split(/\s+/).filter((w) => w !== "");
}

/** Whether every word appears somewhere in the Job's title, Company or locations. */
export function matchesSearch(job: Job, words: readonly string[]): boolean {
  const fields = [job.title, job.companyName, ...job.locations];
  return words.every((word) => fields.some((field) => findRanges(field, word).length > 0));
}

/** "search" highlights for every occurrence of every word, field by field. */
export function searchHighlights(job: Job, words: readonly string[]): RowHighlights {
  return {
    title: fieldHighlights(job.title, words),
    company: fieldHighlights(job.companyName, words),
    locations: job.locations.map((location) => fieldHighlights(location, words)),
  };
}

function fieldHighlights(text: string, words: readonly string[]): Highlight[] {
  return words
    .flatMap((word) => findRanges(text, word))
    .map(([start, end]): Highlight => ({ start, end, kind: "search" }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
}
