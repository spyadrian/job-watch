// The Filter rules of the job-list module: City filters and keywords.
import type { Filter, Job } from "../shared/types.ts";
import type { Highlight } from "./job-list.ts";
import { byPosition, findRanges, fold } from "./text-match.ts";

/** Whether the Job may reach the Inbox. */
export function passesFilter(job: Job, filter: Filter): boolean {
  const title = fold(job.title);
  return (
    passesCities(job, filter.cities) &&
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

function passesCities(job: Job, cities: string[][]): boolean {
  if (cities.length === 0) return true;
  const locations = job.locations.map(fold);
  if (locations.length === 0 || locations.some((location) => remote.test(location))) return true;
  return cities.some((spellings) => locations.some((location) => containsAny(location, spellings)));
}
