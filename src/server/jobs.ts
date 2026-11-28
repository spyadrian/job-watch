// Job lifecycle storage: listing Jobs and applying status changes. The status
// rules themselves are the pure shared module; routes live in routes/jobs.ts.
import { inTransaction, type Database } from "./db.ts";
import { RequestError } from "./errors.ts";
import { jobStatuses, restore, transition, type Transition } from "../shared/job-lifecycle.ts";
import type { Job, JobAction, JobStatus, SourceRef } from "../shared/types.ts";
import type { NormalizedJob } from "./sources/index.ts";

export { jobActions } from "../shared/job-lifecycle.ts";

/** Every stored Job, with the live Company name (or the kept one). */
export function listJobs(db: Database): Job[] {
  const rows = db.prepare(`${selectJob} ORDER BY j.id`).all() as unknown as JobRow[];
  return rows.map(toJob);
}

export function getJob(db: Database, id: number): Job | undefined {
  const row = db.prepare(`${selectJob} WHERE j.id = ?`).get(id) as unknown as JobRow | undefined;
  return row && toJob(row);
}

export class JobNotFoundError extends RequestError {
  constructor() {
    super("This Job no longer exists.", 404);
    this.name = "JobNotFoundError";
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
  return actOnAll(db, ids, "unseen", "seen");
}

/** Undo Mark all as seen: the given Jobs that are still Seen go back to Unseen, in one transaction; returns them. */
export function markAllUnseen(db: Database, ids: number[]): Job[] {
  return actOnAll(db, ids, "seen", "unseen");
}

/** Applies `action` to each given Job currently in status `from`, in one transaction; skips the others. */
function actOnAll(db: Database, ids: number[], from: JobStatus, action: JobAction): Job[] {
  return inTransaction(db, () =>
    [...new Set(ids)].flatMap((id) => {
      const job = getJob(db, id);
      if (job?.status !== from) return [];
      const changed = store(db, id, transition(job, action));
      return changed ? [changed] : [];
    }),
  );
}

/** The Company a Job is stored under: its id, current name and Source. */
export interface JobOwner {
  id: number;
  name: string;
  source: SourceRef;
}

/**
 * Stores a Job read from the Company's Source that the Company doesn't have yet.
 * A Job kept from an earlier, removed Company following the same Source is taken
 * back (status kept, current again); otherwise the Job is new: Unseen, first fetched
 * `now`. Returns whether it is new.
 */
export function insertJob(db: Database, owner: JobOwner, job: NormalizedJob, now: string): boolean {
  const locations = JSON.stringify(job.locations);
  const { changes: takenBack } = db
    .prepare(
      `UPDATE job SET company_id = ?, company_name = ?, title = ?, url = ?, locations = ?, published_at = ?, outdated = 0
       WHERE id = (SELECT id FROM job
                   WHERE company_id IS NULL AND source_type = ? AND source_key = ? AND source_job_id = ?
                   ORDER BY id LIMIT 1)`,
    )
    .run(owner.id, owner.name, job.title, job.url, locations, job.publishedAt, owner.source.type, owner.source.key, job.sourceJobId);
  if (takenBack > 0) return false;
  const { changes } = db
    .prepare(
      `INSERT INTO job (company_id, company_name, source_type, source_key, source_job_id, title, url, locations,
                        published_at, first_fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (company_id, source_job_id) DO NOTHING`,
    )
    .run(owner.id, owner.name, owner.source.type, owner.source.key, job.sourceJobId, job.title, job.url, locations, job.publishedAt, now);
  return changes > 0;
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
