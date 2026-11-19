import { Hono } from "hono";
import type { Clock } from "./clock.ts";
import type { Database } from "./db.ts";
import type { Job, JobStatus } from "../shared/types.ts";
import { companyRoutes } from "./routes/companies.ts";

/** Everything the app needs from the outside world; tests inject fakes. */
export interface AppDeps {
  db: Database;
  /** Used for every outgoing request (Sources, discovery). */
  fetch: typeof globalThis.fetch;
  clock: Clock;
}

/** The JSON HTTP API, mounted under /api. Static front-end serving is added in main.ts. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const api = new Hono();

  api.get("/jobs", (c) => {
    const rows = deps.db
      .prepare(
        `SELECT j.*, COALESCE(c.name, j.company_name) AS display_company
           FROM job j LEFT JOIN company c ON c.id = j.company_id
          ORDER BY j.id`,
      )
      .all() as unknown as JobRow[];
    return c.json({ jobs: rows.map(toJob) });
  });

  companyRoutes(api, deps);

  // Keep this catch-all last: unknown API routes answer JSON, never the SPA page.
  api.all("*", (c) => c.json({ error: `Not found: ${c.req.method} ${c.req.path}` }, 404));

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: err.message || "Unexpected server error" }, 500);
  });
  app.route("/api", api);
  return app;
}

interface JobRow {
  id: number;
  display_company: string;
  title: string;
  url: string;
  locations: string;
  published_at: string | null;
  first_fetched_at: string;
  status: JobStatus;
  was_saved: number;
  outdated: number;
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    companyName: row.display_company,
    title: row.title,
    url: row.url,
    locations: JSON.parse(row.locations) as string[],
    publishedAt: row.published_at,
    firstFetchedAt: row.first_fetched_at,
    status: row.status,
    wasSaved: row.was_saved === 1,
    outdated: row.outdated === 1,
  };
}
