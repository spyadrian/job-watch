import type { Hono } from "hono";
import type { AppDeps } from "../app.ts";
import { parseFilter, readFilter, saveFilter } from "../filter.ts";
import { jsonBody } from "./request.ts";

/** Filter: read and replace the single stored Filter. */
export function registerFilterRoutes(api: Hono, deps: Pick<AppDeps, "db">): void {
  const { db } = deps;

  api.get("/filter", (c) => c.json({ filter: readFilter(db) }));

  api.put("/filter", async (c) => {
    const filter = parseFilter(await jsonBody(c));
    if (!filter) {
      return c.json(
        { error: "Expected a Filter: { cities: string[][], required: string[], boosted: string[], excluded: string[], includeRemote: boolean }." },
        400,
      );
    }
    return c.json({ filter: saveFilter(db, filter) });
  });
}
