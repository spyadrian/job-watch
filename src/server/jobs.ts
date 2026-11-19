// Job lifecycle storage: listing Jobs and applying status changes. The status
// rules themselves are the pure shared module; routes live in routes/jobs.ts.
import type { Database } from "./db.ts";
import { jobStatuses, restore, transition, type Transition } from "../shared/job-lifecycle.ts";
import type { Job, JobAction, JobStatus } from "../shared/types.ts";

export { jobActions, TransitionError } from "../shared/job-lifecycle.ts";

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
  return store(db, id, transition(job, action));
}

/** Stores the outcome of a status rule for one Job; returns the updated Job, or null when deleted. */
function store(db: Database, id: number, next: Transition): Job | null {
  if ("deleted" in next) {
    db.prepare("DELETE FROM job WHERE id = ?").run(id);
    return null;
  }
  db.prepare("UPDATE job SET status = ?, was_saved = ? WHERE id = ?").run(next.status, next.wasSaved ? 1 : 0, id);
  return getJob(db, id)!;
}

/** Mark all as seen: the given Jobs that are still Unseen become Seen, in one transaction; returns them. */
export function markAllSeen(db: Database, ids: number[]): Job[] {
  const update = db.prepare("UPDATE job SET status = 'seen', was_saved = 0 WHERE id = ? AND status = 'unseen'");
  const changed: number[] = [];
  db.exec("BEGIN");
  try {
    for (const id of new Set(ids)) if (update.run(id).changes > 0) changed.push(id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return changed.map((id) => getJob(db, id)!);
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

/**
 * Undo: puts the stored Job back in the status (and flag) it had before the last change;
 * returns it, or null when it was deleted (an Outdated Job going back to Unseen or Seen).
 */
export function restoreStatus(db: Database, id: number, status: JobStatus, wasSaved: boolean): Job | null {
  const job = getJob(db, id);
  if (!job) throw new JobNotFoundError();
  return store(db, id, restore(job, { status, wasSaved }));
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
