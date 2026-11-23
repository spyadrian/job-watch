import type { Hono } from "hono";
import type { AppDeps } from "../app.ts";
import { exportData, importData, type FilterChoice } from "../data-transfer.ts";

/** Data: export everything to one JSON file, import such a file. */
export function registerDataRoutes(api: Hono, deps: Pick<AppDeps, "db" | "clock">): void {
  /** → the export file, as a download named after today's date. */
  api.get("/export", (c) => {
    const file = exportData(deps);
    const day = file.exportedAt.slice(0, 10);
    c.header("Content-Disposition", `attachment; filename="job-watch-${day}.json"`);
    return c.json(file);
  });

  /**
   * The export file as the body → ImportSummary. `?filter=replace|keep` decides whether the
   * file's Filter replaces the stored one; by default only an empty stored Filter is replaced.
   */
  api.post("/import", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const choice = c.req.query("filter");
    const filterChoice: FilterChoice = choice === "replace" || choice === "keep" ? choice : "auto";
    return c.json(importData(body, filterChoice, deps));
  });
}
