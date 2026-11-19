import type { Company, SourceRef, SourceType } from "../shared/types.ts";
import type { AppDeps } from "./app.ts";
import { adapterFor, type NormalizedJob } from "./sources/index.ts";

/** Following a Company was refused; `status` is the HTTP status to answer with. */
export class FollowError extends Error {
  status: 400 | 409 | 502;
  constructor(message: string, status: 400 | 409 | 502) {
    super(message);
    this.name = "FollowError";
    this.status = status;
  }
}

/**
 * Follows a Source under the given name: reads it once and stores the Company
 * with all its Jobs as Unseen, first fetched now. Saves nothing on failure.
 */
export async function followCompany(
  source: SourceRef,
  rawName: string,
  deps: AppDeps,
): Promise<{ company: Company; jobCount: number }> {
  const adapter = adapterFor(source.type);
  if (!adapter) throw new FollowError(`Unsupported Source type "${source.type}"`, 400);
  const name = rawName.trim();
  if (!name) throw new FollowError("Give the Company a name.", 400);
  refuseIfFollowed(source, deps);

  let jobs: NormalizedJob[];
  try {
    jobs = (await adapter.read(source.key, deps)).jobs;
  } catch (err) {
    throw new FollowError(err instanceof Error ? err.message : String(err), 502);
  }

  const { db } = deps;
  const now = deps.clock.now().toISOString();
  db.exec("BEGIN");
  try {
    refuseIfFollowed(source, deps); // the read was async: check again inside the transaction
    const { id } = db
      .prepare("INSERT INTO company (name, source_type, source_key, created_at) VALUES (?, ?, ?, ?) RETURNING id")
      .get(name, source.type, source.key, now) as { id: number };
    const insertJob = db.prepare(
      `INSERT INTO job (company_id, company_name, source_job_id, title, url, locations, published_at, first_fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (company_id, source_job_id) DO NOTHING`,
    );
    for (const job of jobs) {
      insertJob.run(id, name, job.sourceJobId, job.title, job.url, JSON.stringify(job.locations), job.publishedAt, now);
    }
    db.exec("COMMIT");
    return {
      company: { id, name, source: { type: source.type, key: source.key }, sourceLabel: adapter.label, createdAt: now, lastError: null },
      jobCount: jobs.length,
    };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function refuseIfFollowed(source: SourceRef, { db }: AppDeps): void {
  const followed = db
    .prepare("SELECT name FROM company WHERE source_type = ? AND source_key = ?")
    .get(source.type, source.key) as { name: string } | undefined;
  if (followed) throw new FollowError(`Already following ${followed.name}`, 409);
}

interface CompanyRow {
  id: number;
  name: string;
  source_type: SourceType;
  source_key: string;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
}

const selectCompany = "SELECT id, name, source_type, source_key, last_error, last_error_at, created_at FROM company";

function toCompany(row: CompanyRow): Company {
  return {
    id: row.id,
    name: row.name,
    source: { type: row.source_type, key: row.source_key },
    sourceLabel: adapterFor(row.source_type)?.label ?? row.source_type,
    createdAt: row.created_at,
    lastError: row.last_error === null ? null : { message: row.last_error, at: row.last_error_at ?? row.created_at },
  };
}

/** Every followed Company, by name (ignoring case), with its last read error if any. */
export function listCompanies({ db }: Pick<AppDeps, "db">): Company[] {
  const rows = db.prepare(`${selectCompany} ORDER BY name COLLATE NOCASE, id`).all() as unknown as CompanyRow[];
  return rows.map(toCompany);
}

/** The Company is not (or no longer) followed. */
export class CompanyNotFoundError extends Error {
  constructor() {
    super("This Company is no longer followed.");
    this.name = "CompanyNotFoundError";
  }
}

/** Renames a Company; its Jobs show the new name. Throws FollowError (400) on an empty name. */
export function renameCompany(id: number, rawName: string, { db }: Pick<AppDeps, "db">): Company {
  const name = rawName.trim();
  if (!name) throw new FollowError("Give the Company a name.", 400);
  return inTransaction(db, () => {
    const row = db.prepare("UPDATE company SET name = ? WHERE id = ? RETURNING *").get(name, id) as unknown as
      | CompanyRow
      | undefined;
    if (!row) throw new CompanyNotFoundError();
    // Keep the stored name in step, so it is the current one if the Company is removed later.
    db.prepare("UPDATE job SET company_name = ? WHERE company_id = ?").run(name, id);
    return toCompany(row);
  });
}

/**
 * Stops following a Company: deletes its Unseen and Seen Jobs; its Saved and
 * Applied Jobs stay, marked Outdated, keeping the Company's name for display.
 */
export function removeCompany(id: number, { db }: Pick<AppDeps, "db">): void {
  inTransaction(db, () => {
    const company = db.prepare("SELECT name FROM company WHERE id = ?").get(id) as { name: string } | undefined;
    if (!company) throw new CompanyNotFoundError();
    db.prepare("DELETE FROM job WHERE company_id = ? AND status IN ('unseen', 'seen')").run(id);
    db.prepare("UPDATE job SET outdated = 1, company_name = ? WHERE company_id = ?").run(company.name, id);
    db.prepare("DELETE FROM company WHERE id = ?").run(id); // ON DELETE SET NULL detaches the kept Jobs
  });
}

function inTransaction<T>(db: AppDeps["db"], work: () => T): T {
  db.exec("BEGIN");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
