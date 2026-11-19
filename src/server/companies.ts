import type { Company, SourceRef } from "../shared/types.ts";
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
      company: { id, name, source: { type: source.type, key: source.key }, sourceLabel: adapter.label, createdAt: now },
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
