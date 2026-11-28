import type { Context, Hono } from "hono";
import type { AppDeps } from "../app.ts";
import { changeStatus, isValidState, JobNotFoundError, jobActions, listJobs, markAllSeen, markAllUnseen, restoreStatus } from "../jobs.ts";
import type { JobAction } from "../../shared/types.ts";
import { idParam, jsonBody } from "./request.ts";

const jobId = (c: Context) => idParam(c, () => new JobNotFoundError());

/** The `ids` of a bulk request body, or null when it isn't a list of integers. */
const jobIds = (ids: unknown): number[] | null =>
  Array.isArray(ids) && ids.every((id) => Number.isInteger(id)) ? (ids as number[]) : null;

/** Jobs: list all, change one Job's status by action. */
export function registerJobRoutes(api: Hono, deps: Pick<AppDeps, "db">): void {
  const { db } = deps;

  api.get("/jobs", (c) => c.json({ jobs: listJobs(db) }));

  /** Mark all as seen: { ids } → { jobs } (those that were Unseen and are now Seen). */
  api.post("/jobs/seen", async (c) => {
    const ids = jobIds((await jsonBody(c)).ids);
    if (!ids) return c.json({ error: "Expected { ids } with the ids of the Jobs to mark Seen." }, 400);
    return c.json({ jobs: markAllSeen(db, ids) });
  });

  /** Undo Mark all as seen: { ids } → { jobs } (those that were still Seen and are now Unseen). */
  api.post("/jobs/unseen", async (c) => {
    const ids = jobIds((await jsonBody(c)).ids);
    if (!ids) return c.json({ error: "Expected { ids } with the ids of the Jobs to move back to Unseen." }, 400);
    return c.json({ jobs: markAllUnseen(db, ids) });
  });

  /** { action } → { job }, or { job: null, deleted: true } when an Outdated Job is deleted. */
  api.post("/jobs/:id/status", async (c) => {
    const { action } = await jsonBody(c);
    if (typeof action !== "string" || !jobActions.includes(action as JobAction)) {
      return c.json({ error: `Expected { action } with one of: ${jobActions.join(", ")}.` }, 400);
    }
    const job = changeStatus(db, jobId(c), action as JobAction);
    return c.json(job ? { job } : { job: null, deleted: true });
  });

  /**
   * Undo the last change: { status, wasSaved } (the Job's previous state) → { job },
   * or { job: null, deleted: true } when an Outdated Job would go back to Unseen or Seen.
   */
  api.post("/jobs/:id/undo", async (c) => {
    const { status, wasSaved } = await jsonBody(c);
    if (!isValidState(status, wasSaved)) {
      return c.json({ error: "Expected { status, wasSaved } with the Job's previous status." }, 400);
    }
    const job = restoreStatus(db, jobId(c), status, wasSaved as boolean);
    return c.json(job ? { job } : { job: null, deleted: true });
  });
}
