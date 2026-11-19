import type { Hono } from "hono";
import type { AppDeps } from "../app.ts";
import {
  changeStatus,
  isValidState,
  JobNotFoundError,
  jobActions,
  listJobs,
  restoreStatus,
  TransitionError,
} from "../jobs.ts";
import type { JobAction } from "../../shared/types.ts";

/** Jobs: list all, change one Job's status by action. */
export function registerJobRoutes(api: Hono, deps: Pick<AppDeps, "db">): void {
  const { db } = deps;

  api.get("/jobs", (c) => c.json({ jobs: listJobs(db) }));

  /** { action } → { job }, or { job: null, deleted: true } when an Outdated Job is deleted. */
  api.post("/jobs/:id/status", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { action?: unknown } | null;
    const action = body?.action;
    if (typeof action !== "string" || !jobActions.includes(action as JobAction)) {
      return c.json({ error: `Expected { action } with one of: ${jobActions.join(", ")}.` }, 400);
    }
    try {
      const job = changeStatus(db, Number(c.req.param("id")), action as JobAction);
      return c.json(job ? { job } : { job: null, deleted: true });
    } catch (err) {
      if (err instanceof JobNotFoundError) return c.json({ error: err.message }, 404);
      if (err instanceof TransitionError) return c.json({ error: err.message }, 409);
      throw err;
    }
  });

  /** Undo the last change: { status, wasSaved } (the Job's previous state) → { job }. */
  api.post("/jobs/:id/undo", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { status?: unknown; wasSaved?: unknown } | null;
    if (!isValidState(body?.status, body?.wasSaved)) {
      return c.json({ error: "Expected { status, wasSaved } with the Job's previous status." }, 400);
    }
    try {
      return c.json({ job: restoreStatus(db, Number(c.req.param("id")), body.status, body.wasSaved as boolean) });
    } catch (err) {
      if (err instanceof JobNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });
}
