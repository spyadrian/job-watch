// Refresh: reads every followed Company's Source and stores what changed.
// One refresh runs at a time; a second request joins the running one and
// gets every event so far, then the rest as they happen.
import { becomeOutdated } from "../shared/job-lifecycle.ts";
import type { JobStatus, RefreshEvent, RefreshSummary, SourceType } from "../shared/types.ts";
import type { AppDeps } from "./app.ts";
import type { Database } from "./db.ts";
import { adapterFor, type NormalizedJob } from "./sources/index.ts";

/** How many Sources are read at the same time. */
export const REFRESH_CONCURRENCY = 4;

type Listener = (event: RefreshEvent) => void;

/** One refresh, as a replayable stream of events. */
export interface RefreshRun {
  /** Calls `listener` with every event so far, then each new one; returns an unsubscribe function. */
  subscribe(listener: Listener): () => void;
  /** Settles once the summary has been emitted. */
  finished: Promise<RefreshSummary>;
}

export interface Refresher {
  /** Starts a refresh, or returns the running one. */
  start(): RefreshRun;
  /** Forgets the running refresh (test reset): its remaining reads write nothing. */
  reset(): void;
}

interface CompanyToRead {
  id: number;
  name: string;
  source_type: SourceType;
  source_key: string;
}

export function createRefresher(deps: AppDeps): Refresher {
  let running: (RefreshRun & { cancel(): void }) | null = null;
  return {
    start() {
      if (!running) {
        const run = startRun(deps);
        running = run;
        void run.finished.finally(() => {
          if (running === run) running = null;
        });
      }
      return running;
    },
    reset() {
      running?.cancel();
      running = null;
    },
  };
}

function startRun(deps: AppDeps): RefreshRun & { cancel(): void } {
  const events: RefreshEvent[] = [];
  const listeners = new Set<Listener>();
  let cancelled = false;
  const emit = (event: RefreshEvent) => {
    events.push(event);
    for (const listener of listeners) listener(event);
  };

  const finished = (async (): Promise<RefreshSummary> => {
    const summary: RefreshSummary = { new: 0, outdated: 0, failed: 0 };
    try {
      const companies = deps.db
        .prepare("SELECT id, name, source_type, source_key FROM company ORDER BY id")
        .all() as unknown as CompanyToRead[];
      const total = companies.length;
      emit({ type: "start", total });

      let next = 0;
      let done = 0;
      const worker = async () => {
        // A cancelled refresh (test reset) starts no further reads.
        while (!cancelled && next < companies.length) {
          const company = companies[next++]!;
          const error = await refreshCompany(company, deps, summary, () => cancelled);
          if (error !== null) summary.failed++;
          done++;
          emit({ type: "progress", done, total, companyId: company.id, companyName: company.name, error });
        }
      };
      const concurrency = deps.refreshConcurrency ?? REFRESH_CONCURRENCY;
      await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
    } catch (err) {
      console.error(err); // e.g. the database can't be read: still end the stream
    } finally {
      emit({ type: "done", summary: { ...summary } });
    }
    return summary;
  })();

  return {
    finished,
    cancel: () => {
      cancelled = true;
    },
    subscribe(listener) {
      for (const event of events) listener(event);
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Reads one Source and stores the result; returns the error message, or null on success.
 * Any failure, reading or storing, fails this Source only and is recorded on its Company.
 */
async function refreshCompany(
  company: CompanyToRead,
  deps: AppDeps,
  summary: RefreshSummary,
  isCancelled: () => boolean,
): Promise<string | null> {
  try {
    const adapter = adapterFor(company.source_type);
    if (!adapter) throw new Error(`Unsupported Source type "${company.source_type}"`);
    const { jobs } = await adapter.read(company.source_key, deps);
    if (isCancelled()) return null;
    const changes = storeRead(deps.db, company.id, jobs, deps.clock.now().toISOString());
    summary.new += changes.new;
    summary.outdated += changes.outdated;
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!isCancelled()) recordError(deps, company.id, message);
    return message;
  }
}

/** Remembers why the Company's Source failed; a failure to do so only loses that note. */
function recordError(deps: AppDeps, companyId: number, message: string): void {
  try {
    deps.db
      .prepare("UPDATE company SET last_error = ?, last_error_at = ? WHERE id = ?")
      .run(message, deps.clock.now().toISOString(), companyId);
  } catch (err) {
    console.error(err);
  }
}

interface StoredJob {
  id: number;
  source_job_id: string;
  status: JobStatus;
  was_saved: number;
  outdated: number;
}

/**
 * Stores a successful read of a Company's Source in one transaction: inserts new
 * Jobs (Unseen, first fetched now), updates stored ones (status kept, current again),
 * makes absent ones Outdated, and clears the Company's error.
 * Does nothing if the Company was removed meanwhile.
 */
function storeRead(db: Database, companyId: number, jobs: NormalizedJob[], now: string): { new: number; outdated: number } {
  const changes = { new: 0, outdated: 0 };
  db.exec("BEGIN");
  try {
    const company = db.prepare("SELECT name FROM company WHERE id = ?").get(companyId) as { name: string } | undefined;
    if (!company) {
      db.exec("ROLLBACK");
      return changes;
    }
    const stored = new Map(
      (
        db
          .prepare("SELECT id, source_job_id, status, was_saved, outdated FROM job WHERE company_id = ?")
          .all(companyId) as unknown as StoredJob[]
      ).map((job) => [job.source_job_id, job]),
    );
    const read = new Map(jobs.map((job) => [job.sourceJobId, job]));

    const update = db.prepare(
      "UPDATE job SET title = ?, url = ?, locations = ?, published_at = ?, outdated = 0 WHERE id = ?",
    );
    const insert = db.prepare(
      `INSERT INTO job (company_id, company_name, source_job_id, title, url, locations, published_at, first_fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const job of read.values()) {
      const locations = JSON.stringify(job.locations);
      const existing = stored.get(job.sourceJobId);
      if (existing) {
        update.run(job.title, job.url, locations, job.publishedAt, existing.id);
      } else {
        insert.run(companyId, company.name, job.sourceJobId, job.title, job.url, locations, job.publishedAt, now);
        changes.new++;
      }
    }

    const remove = db.prepare("DELETE FROM job WHERE id = ?");
    const flag = db.prepare("UPDATE job SET outdated = 1 WHERE id = ?");
    for (const job of stored.values()) {
      if (read.has(job.source_job_id) || job.outdated === 1) continue;
      const next = becomeOutdated({ status: job.status, wasSaved: job.was_saved === 1, outdated: false });
      if ("deleted" in next) remove.run(job.id);
      else flag.run(job.id);
      changes.outdated++;
    }

    db.prepare("UPDATE company SET last_error = NULL, last_error_at = NULL WHERE id = ?").run(companyId);
    db.exec("COMMIT");
    return changes;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
