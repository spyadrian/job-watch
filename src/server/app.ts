import { Hono } from "hono";
import type { Clock } from "./clock.ts";
import { resetDatabase, type Database } from "./db.ts";
import { registerCompanyRoutes } from "./routes/companies.ts";
import { registerJobRoutes } from "./routes/jobs.ts";
import { registerShortcutRoutes } from "./routes/shortcuts.ts";

/** Everything the app needs from the outside world; tests inject fakes. */
export interface AppDeps {
  db: Database;
  /** Used for every outgoing request (Sources, discovery). */
  fetch: typeof globalThis.fetch;
  clock: Clock;
  /**
   * Adds POST /api/test/reset, which wipes the database back to a first start.
   * Only for the e2e suite (recorded-Sources mode); never enabled otherwise.
   */
  testReset?: boolean;
}

/** The JSON HTTP API, mounted under /api. Static front-end serving is added in main.ts. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const api = new Hono();

  registerJobRoutes(api, deps);
  registerCompanyRoutes(api, deps);
  registerShortcutRoutes(api, deps);
  if (deps.testReset) {
    api.post("/test/reset", (c) => {
      resetDatabase(deps.db);
      return c.body(null, 204);
    });
  }

  // Keep this catch-all last: unknown API routes answer JSON, never the SPA page.
  api.all("*", (c) => c.json({ error: `Not found: ${c.req.method} ${c.req.path}` }, 404));

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: err.message || "Unexpected server error" }, 500);
  });
  app.route("/api", api);
  return app;
}
