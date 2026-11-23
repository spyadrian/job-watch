// Filter storage: the single stored Filter. Routes live in routes/filter.ts.
import type { Filter } from "../shared/types.ts";
import type { Database } from "./db.ts";

export function readFilter(db: Database): Filter {
  const row = db
    .prepare("SELECT cities, required, boosted, excluded, include_remote FROM filter WHERE id = 1")
    .get() as unknown as Record<"cities" | "required" | "boosted" | "excluded", string> & { include_remote: number };
  return {
    cities: JSON.parse(row.cities) as string[][],
    required: JSON.parse(row.required) as string[],
    boosted: JSON.parse(row.boosted) as string[],
    excluded: JSON.parse(row.excluded) as string[],
    includeRemote: row.include_remote === 1,
  };
}

/** Replaces the stored Filter; returns it as stored. */
export function saveFilter(db: Database, filter: Filter): Filter {
  db.prepare(
    "UPDATE filter SET cities = ?, required = ?, boosted = ?, excluded = ?, include_remote = ? WHERE id = 1",
  ).run(
    JSON.stringify(filter.cities),
    JSON.stringify(filter.required),
    JSON.stringify(filter.boosted),
    JSON.stringify(filter.excluded),
    filter.includeRemote ? 1 : 0,
  );
  return readFilter(db);
}

/** A valid Filter with words trimmed and blank ones (and empty City filters) dropped, or null. */
export function parseFilter(body: Record<string, unknown>): Filter | null {
  const { cities, required, boosted, excluded, includeRemote } = body;
  if (!Array.isArray(cities) || !cities.every(isWordList)) return null;
  if (!isWordList(required) || !isWordList(boosted) || !isWordList(excluded)) return null;
  if (typeof includeRemote !== "boolean") return null;
  return {
    cities: cities.map(clean).filter((spellings) => spellings.length > 0),
    required: clean(required),
    boosted: clean(boosted),
    excluded: clean(excluded),
    includeRemote,
  };
}

function isWordList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((w) => typeof w === "string");
}

function clean(words: string[]): string[] {
  return words.map((w) => w.trim()).filter((w) => w !== "");
}
