// Job lifecycle: the spec's status table as a pure transition function, plus
// the storage of status changes. Routes live in routes/jobs.ts.
import type { Database } from "./db.ts";
import type { Job, JobAction, JobStatus } from "../shared/types.ts";

/** The part of a Job the status rules look at. */
export interface JobState {
  status: JobStatus;
  wasSaved: boolean;
  outdated: boolean;
}

/** What an action does to a Job: its new status and flag, or deletion. */
export type Transition = { status: JobStatus; wasSaved: boolean } | { deleted: true };

/** The action is not allowed from the Job's current status. */
export class TransitionError extends Error {}

/** Applies one action of the spec's status table, or throws TransitionError. */
export function transition(from: JobState, action: JobAction): Transition {
  const { status, wasSaved, outdated } = from;
  // An Outdated Job that would fall back to Seen is deleted instead.
  const toSeen: Transition = outdated ? { deleted: true } : { status: "seen", wasSaved: false };
  switch (action) {
    case "seen":
      if (status === "unseen") return { status: "seen", wasSaved: false };
      break;
    case "unseen":
      if (status === "seen") return { status: "unseen", wasSaved: false };
      break;
    case "save":
      if (status === "unseen" || status === "seen") return { status: "saved", wasSaved: false };
      break;
    case "unsave":
      if (status === "saved") return toSeen;
      break;
    case "apply":
      if (status === "unseen" || status === "seen") return { status: "applied", wasSaved: false };
      if (status === "saved") return { status: "applied", wasSaved: true };
      break;
    case "unapply":
      if (status === "applied") return wasSaved ? { status: "saved", wasSaved: false } : toSeen;
      break;
  }
  throw new TransitionError(`Can't ${actionLabel[action]} a Job that is ${status[0]!.toUpperCase()}${status.slice(1)}.`);
}

const actionLabel: Record<JobAction, string> = {
  seen: "mark Seen",
  unseen: "un-mark Seen",
  save: "save",
  unsave: "un-save",
  apply: "mark Applied",
  unapply: "un-mark Applied",
};

export const jobActions = Object.keys(actionLabel) as JobAction[];

/** Every stored Job, with the live Company name (or the kept one). */
export function listJobs(db: Database): Job[] {
  const rows = db.prepare(`${selectJob} ORDER BY j.id`).all() as unknown as JobRow[];
  return rows.map(toJob);
}

export function getJob(db: Database, id: number): Job | undefined {
  const row = db.prepare(`${selectJob} WHERE j.id = ?`).get(id) as unknown as JobRow | undefined;
  return row && toJob(row);
}

export class JobNotFoundError extends Error {
  constructor() {
    super("This Job no longer exists.");
  }
}

/** Applies `action` to the stored Job; returns the updated Job, or null when it was deleted. */
export function changeStatus(db: Database, id: number, action: JobAction): Job | null {
  const job = getJob(db, id);
  if (!job) throw new JobNotFoundError();
  const next = transition(job, action);
  if ("deleted" in next) {
    db.prepare("DELETE FROM job WHERE id = ?").run(id);
    return null;
  }
  db.prepare("UPDATE job SET status = ?, was_saved = ? WHERE id = ?").run(next.status, next.wasSaved ? 1 : 0, id);
  return getJob(db, id)!;
}

/** A status and flag a Job can be in: the flag only ever goes with Applied. */
export function isValidState(status: unknown, wasSaved: unknown): status is JobStatus {
  return (
    typeof status === "string" &&
    (jobStatuses as string[]).includes(status) &&
    typeof wasSaved === "boolean" &&
    (!wasSaved || status === "applied")
  );
}

const jobStatuses: JobStatus[] = ["unseen", "seen", "saved", "applied"];

/** Undo: puts the stored Job back in the status (and flag) it had before the last change. */
export function restoreStatus(db: Database, id: number, status: JobStatus, wasSaved: boolean): Job {
  const { changes } = db.prepare("UPDATE job SET status = ?, was_saved = ? WHERE id = ?").run(status, wasSaved ? 1 : 0, id);
  if (changes === 0) throw new JobNotFoundError();
  return getJob(db, id)!;
}

const selectJob =`SELECT j.*, COALESCE(c.name, j.company_name) AS display_company
                     FROM job j LEFT JOIN company c ON c.id = j.company_id`;

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
