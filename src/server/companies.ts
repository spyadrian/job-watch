import type { Company, JobStatus, SourceRef, SourceType } from "../shared/types.ts";
import { becomeOutdated } from "../shared/job-lifecycle.ts";
import type { AppDeps } from "./app.ts";
import { inTransaction, type Database } from "./db.ts";
import { RequestError } from "./errors.ts";
import { insertJob } from "./jobs.ts";
import { adapterFor, type NormalizedJob } from "./sources/index.ts";

/** Following or renaming a Company was refused: blank name, already followed, unreadable Source… */
export class CompanyRequestError extends RequestError {
  constructor(message: string, status: 400 | 409 | 502) {
    super(message, status);
    this.name = "CompanyRequestError";
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
  if (!adapter) throw new CompanyRequestError(`Unsupported Source type "${source.type}"`, 400);
  const name = rawName.trim();
  if (!name) throw new CompanyRequestError("Give the Company a name.", 400);
  refuseIfFollowed(source, deps);

  let jobs: NormalizedJob[];
  try {
    jobs = (await adapter.read(source.key, deps)).jobs;
  } catch (err) {
    throw new CompanyRequestError(err instanceof Error ? err.message : String(err), 502);
  }

  const { db } = deps;
  const now = deps.clock.now().toISOString();
  return inTransaction(db, () => {
    refuseIfFollowed(source, deps); // the read was async: check again inside the transaction
    const { id } = db
      .prepare("INSERT INTO company (name, source_type, source_key, created_at) VALUES (?, ?, ?, ?) RETURNING id")
      .get(name, source.type, source.key, now) as { id: number };
    for (const job of jobs) insertJob(db, { id, name }, job, now);
    return {
      company: { id, name, source: { type: source.type, key: source.key }, sourceLabel: adapter.label, createdAt: now, lastError: null },
      jobCount: jobs.length,
    };
  });
}

/** The Company that follows this Source, if any. */
export function companyFollowing(db: Database, source: SourceRef): { id: number; name: string } | undefined {
  return db
    .prepare("SELECT id, name FROM company WHERE source_type = ? AND source_key = ?")
    .get(source.type, source.key) as { id: number; name: string } | undefined;
}

function refuseIfFollowed(source: SourceRef, { db }: AppDeps): void {
  const followed = companyFollowing(db, source);
  if (followed) throw new CompanyRequestError(`Already following ${followed.name}`, 409);
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
export class CompanyNotFoundError extends RequestError {
  constructor() {
    super("This Company is no longer followed.", 404);
    this.name = "CompanyNotFoundError";
  }
}

/** Renames a Company; its Jobs show the new name. Throws CompanyRequestError (400) on an empty name. */
export function renameCompany(id: number, rawName: string, { db }: Pick<AppDeps, "db">): Company {
  const name = rawName.trim();
  if (!name) throw new CompanyRequestError("Give the Company a name.", 400);
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
    // Its Jobs are no longer in a followed Source: the same rule as a Job gone from its Source.
    const jobs = db.prepare("SELECT id, status FROM job WHERE company_id = ?").all(id) as unknown as {
      id: number;
      status: JobStatus;
    }[];
    const remove = db.prepare("DELETE FROM job WHERE id = ?");
    const keep = db.prepare("UPDATE job SET outdated = 1, company_name = ? WHERE id = ?");
    for (const job of jobs) {
      if ("deleted" in becomeOutdated({ status: job.status, wasSaved: false, outdated: false })) remove.run(job.id);
      else keep.run(company.name, job.id);
    }
    db.prepare("DELETE FROM company WHERE id = ?").run(id); // ON DELETE SET NULL detaches the kept Jobs
  });
}
