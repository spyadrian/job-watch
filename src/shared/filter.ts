// Facts about a Filter shared by the server and the front end.
import type { Filter } from "./types.ts";

/** No City filters and no keywords: what a first start has. An import replaces such a Filter by default. */
export function isEmptyFilter(filter: Filter): boolean {
  return filter.cities.length + filter.required.length + filter.boosted.length + filter.excluded.length === 0;
}
