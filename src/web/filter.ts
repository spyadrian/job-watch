// The Filter rules of the job-list module: City filters and keywords.
import type { Filter, Job } from "../shared/types.ts";
import type { Highlight } from "./job-list.ts";
import { byPosition, findRanges, fold } from "./text-match.ts";

/** Whether the Job may reach the Inbox. */
export function passesFilter(job: Job, filter: Filter): boolean {
  const title = fold(job.title);
  return (
    passesCities(job, filter) &&
    (words(filter.required).length === 0 || containsAny(title, filter.required)) &&
    !containsAny(title, filter.excluded)
  );
}

/** Whether a Boosted keyword is in the Job's title. */
export function isBoosted(job: Job, filter: Filter): boolean {
  return containsAny(fold(job.title), filter.boosted);
}

/** Required (green) and Boosted (yellow) keyword ranges in a title. */
export function keywordHighlights(title: string, filter: Filter): Highlight[] {
  const ranges = (keywords: string[], kind: Highlight["kind"]): Highlight[] =>
    keywords
      .filter((k) => k.trim() !== "")
      .flatMap((k) => findRanges(title, k.trim()).map(([start, end]) => ({ start, end, kind })));
  return [...ranges(filter.required, "required"), ...ranges(filter.boosted, "boosted")].sort(byPosition);
}

/** The keywords, folded, without blank ones. */
function words(keywords: string[]): string[] {
  return keywords.map((k) => fold(k.trim())).filter((k) => k !== "");
}

function containsAny(foldedText: string, keywords: string[]): boolean {
  return words(keywords).some((k) => foldedText.includes(k));
}

/** A location that says the Job can be done remotely, e.g. "Remote - Europe". */
const remote = /\bremote\b/;

function passesCities(job: Job, filter: Filter): boolean {
  if (filter.cities.length === 0) return true;
  const locations = job.locations.map(fold);
  if (locations.length === 0) return true;
  if (filter.includeRemote && locations.some((location) => remote.test(location))) return true;
  return filter.cities.some((spellings) =>
    locations.some((location) => words(spellings).some((spelling) => containsWholeWords(location, spelling))),
  );
}

/** A letter or digit, accented or not: what a word is made of. */
const wordChar = /[\p{L}\p{N}]/u;

/**
 * Whether `spelling` occurs in `location` (both folded) starting and ending on a word
 * boundary: "ge" is in "carouge, ge" but not in "germany". Unicode-aware, unlike `\b`.
 */
function containsWholeWords(location: string, spelling: string): boolean {
  for (let at = location.indexOf(spelling); at !== -1; at = location.indexOf(spelling, at + 1)) {
    const before = location.slice(0, at);
    const after = location.slice(at + spelling.length);
    const startsWord = !wordChar.test(firstChar(spelling)) || !wordChar.test(lastChar(before));
    const endsWord = !wordChar.test(lastChar(spelling)) || !wordChar.test(firstChar(after));
    if (startsWord && endsWord) return true;
  }
  return false;
}

function firstChar(s: string): string {
  return [...s][0] ?? "";
}

function lastChar(s: string): string {
  return [...s].at(-1) ?? "";
}
