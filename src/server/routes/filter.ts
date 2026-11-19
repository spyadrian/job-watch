import type { Hono } from "hono";
import type { AppDeps } from "../app.ts";
import type { Database } from "../db.ts";
import type { Filter } from "../../shared/types.ts";

/** Filter: read and replace the single stored Filter. */
export function registerFilterRoutes(api: Hono, deps: Pick<AppDeps, "db">): void {
  const { db } = deps;

  api.get("/filter", (c) => c.json({ filter: readFilter(db) }));

  api.put("/filter", async (c) => {
    const filter = parseFilter(await c.req.json().catch(() => null));
    if (!filter) {
      return c.json(
        { error: "Expected a Filter: { cities: string[][], required: string[], boosted: string[], excluded: string[] }." },
        400,
      );
    }
    db.prepare("UPDATE filter SET cities = ?, required = ?, boosted = ?, excluded = ? WHERE id = 1").run(
      JSON.stringify(filter.cities),
      JSON.stringify(filter.required),
      JSON.stringify(filter.boosted),
      JSON.stringify(filter.excluded),
    );
    return c.json({ filter: readFilter(db) });
  });
}

function readFilter(db: Database): Filter {
  const row = db.prepare("SELECT cities, required, boosted, excluded FROM filter WHERE id = 1").get() as unknown as Record<
    keyof Filter,
    string
  >;
  return {
    cities: JSON.parse(row.cities) as string[][],
    required: JSON.parse(row.required) as string[],
    boosted: JSON.parse(row.boosted) as string[],
    excluded: JSON.parse(row.excluded) as string[],
  };
}

/** A valid Filter with words trimmed and blank ones (and empty City filters) dropped, or null. */
function parseFilter(body: unknown): Filter | null {
  if (body === null || typeof body !== "object") return null;
  const { cities, required, boosted, excluded } = body as Record<string, unknown>;
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
