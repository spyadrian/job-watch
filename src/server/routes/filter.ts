import type { Hono } from "hono";
import type { AppDeps } from "../app.ts";
import { readFilter, saveFilter } from "../filter.ts";
import type { Filter } from "../../shared/types.ts";
import { jsonBody } from "./request.ts";

/** Filter: read and replace the single stored Filter. */
export function registerFilterRoutes(api: Hono, deps: Pick<AppDeps, "db">): void {
  const { db } = deps;

  api.get("/filter", (c) => c.json({ filter: readFilter(db) }));

  api.put("/filter", async (c) => {
    const filter = parseFilter(await jsonBody(c));
    if (!filter) {
      return c.json(
        { error: "Expected a Filter: { cities: string[][], required: string[], boosted: string[], excluded: string[] }." },
        400,
      );
    }
    return c.json({ filter: saveFilter(db, filter) });
  });
}

/** A valid Filter with words trimmed and blank ones (and empty City filters) dropped, or null. */
function parseFilter(body: Record<string, unknown>): Filter | null {
  const { cities, required, boosted, excluded } = body;
  if (!Array.isArray(cities) || !cities.every(isWordList)) return null;
  if (!isWordList(required) || !isWordList(boosted) || !isWordList(excluded)) return null;
  return {
    cities: cities.map(clean).filter((spellings) => spellings.length > 0),
    required: clean(required),
    boosted: clean(boosted),
    excluded: clean(excluded),
  };
}

function isWordList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((w) => typeof w === "string");
}

function clean(words: string[]): string[] {
  return words.map((w) => w.trim()).filter((w) => w !== "");
}
