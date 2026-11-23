// Export and import of everything Job Watch stores, as one JSON file, so a person can
// move their data between instances (Docker, npm start, another machine) or keep a backup.
// Routes live in routes/data.ts.
import type { ExportedJob, ExportFile, Filter, ImportSummary, JobStatus, SourceRef } from "../shared/types.ts";
import { isEmptyFilter } from "../shared/filter.ts";
import { isUnseenOrSeen, jobStatuses } from "../shared/job-lifecycle.ts";
import type { AppDeps } from "./app.ts";
import { companyFollowing } from "./companies.ts";
import { inTransaction, type Database } from "./db.ts";
import { RequestError } from "./errors.ts";
import { parseFilter, readFilter, saveFilter } from "./filter.ts";
import { addShortcut } from "./shortcuts.ts";
import { adapterFor } from "./sources/index.ts";

/** What to do with the file's Filter: replace the stored one, keep it, or replace it only if it is empty. */
export type FilterChoice = "replace" | "keep" | "auto";

/** Everything stored, as one export file. Unseen Jobs are left out: the next Refresh reads them again. */
export function exportData({ db, clock }: Pick<AppDeps, "db" | "clock">): ExportFile {
  const companies = db
    .prepare("SELECT name, source_type, source_key FROM company ORDER BY name COLLATE NOCASE, id")
    .all() as unknown as { name: string; source_type: SourceRef["type"]; source_key: string }[];
  const shortcuts = db
    .prepare("SELECT name, url, position FROM shortcut ORDER BY position, id")
    .all() as unknown as ExportFile["shortcuts"];
  const jobs = db
    .prepare(
      `SELECT COALESCE(c.source_type, j.source_type) AS source_type, COALESCE(c.source_key, j.source_key) AS source_key,
              j.source_job_id, COALESCE(c.name, j.company_name) AS company_name, j.title, j.url, j.locations,
              j.published_at, j.first_fetched_at, j.status, j.was_saved, j.outdated
       FROM job j LEFT JOIN company c ON c.id = j.company_id
       WHERE j.status <> 'unseen' ORDER BY j.id`,
    )
    .all() as unknown as JobRow[];
  return {
    format: "job-watch",
    version: 1,
    exportedAt: clock.now().toISOString(),
    companies: companies.map((c) => ({ name: c.name, source: { type: c.source_type, key: c.source_key } })),
    shortcuts,
    filter: readFilter(db),
    jobs: jobs.map(toExportedJob),
  };
}

interface JobRow {
  source_type: SourceRef["type"] | null;
  source_key: string | null;
  source_job_id: string;
  company_name: string;
  title: string;
  url: string;
  locations: string;
  published_at: string | null;
  first_fetched_at: string;
  status: JobStatus;
  was_saved: number;
  outdated: number;
}

function toExportedJob(row: JobRow): ExportedJob {
  return {
    source: row.source_type === null || row.source_key === null ? null : { type: row.source_type, key: row.source_key },
    sourceJobId: row.source_job_id,
    companyName: row.company_name,
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

/** The file can't be imported; nothing was changed. */
export class ImportError extends RequestError {
  constructor(message: string) {
    super(message, 400);
    this.name = "ImportError";
  }
}

/**
 * Merges an export file into what is stored, in one transaction, without reading any
 * Source: follows the Companies not followed yet (the next Refresh reads them), adds the
 * Shortcuts whose link is new, replaces the Filter as chosen, and stores the Jobs or moves
 * their status forward. Throws ImportError, changing nothing, when the file is invalid.
 */
export function importData(raw: unknown, filterChoice: FilterChoice, { db, clock }: Pick<AppDeps, "db" | "clock">): ImportSummary {
  const file = parseExportFile(raw);
  const now = clock.now().toISOString();
  return inTransaction(db, () => ({
    companies: importCompanies(db, file.companies, now),
    shortcuts: importShortcuts(db, file.shortcuts),
    filter: importFilter(db, file.filter, filterChoice),
    jobs: importJobs(db, file.jobs),
  }));
}

function importCompanies(db: Database, companies: ExportFile["companies"], now: string): ImportSummary["companies"] {
  const summary = { added: 0, alreadyFollowed: 0 };
  const insert = db.prepare("INSERT INTO company (name, source_type, source_key, created_at) VALUES (?, ?, ?, ?)");
  for (const { name, source } of companies) {
    if (companyFollowing(db, source)) {
      summary.alreadyFollowed++;
    } else {
      insert.run(name, source.type, source.key, now);
      summary.added++;
    }
  }
  return summary;
}

function importShortcuts(db: Database, shortcuts: ExportFile["shortcuts"]): ImportSummary["shortcuts"] {
  const summary = { added: 0, skipped: 0 };
  const stored = new Set((db.prepare("SELECT url FROM shortcut").all() as { url: string }[]).map((s) => s.url));
  // New Shortcuts go at the end in file order (an export lists them in their order).
  for (const { name, url } of shortcuts) {
    if (stored.has(url.trim())) {
      summary.skipped++;
      continue;
    }
    try {
      stored.add(addShortcut(db, name, url).url);
    } catch (err) {
      if (err instanceof RequestError) throw new ImportError(`Shortcut "${name}" can't be imported: ${err.message}`);
      throw err;
    }
    summary.added++;
  }
  return summary;
}

/** "replaced" only when the stored Filter actually changed. */
function importFilter(db: Database, filter: Filter, choice: FilterChoice): ImportSummary["filter"] {
  const stored = readFilter(db);
  const replace = choice === "replace" || (choice === "auto" && isEmptyFilter(stored));
  // Both are tidied the same way (parseFilter), with the same key order.
  if (!replace || JSON.stringify(filter) === JSON.stringify(stored)) return "kept";
  saveFilter(db, filter);
  return "replaced";
}

const rank = (status: JobStatus) => jobStatuses.indexOf(status);

function importJobs(db: Database, jobs: ExportedJob[]): ImportSummary["jobs"] {
  const summary = { added: 0, statusesRestored: 0, skipped: 0 };
  const bySource = db.prepare(
    `SELECT id, status FROM job WHERE source_type = ? AND source_key = ? AND source_job_id = ?
     ORDER BY company_id IS NULL, id LIMIT 1`,
  );
  const bySourceless = db.prepare(
    `SELECT id, status FROM job WHERE company_id IS NULL AND source_type IS NULL AND company_name = ? AND source_job_id = ?
     ORDER BY id LIMIT 1`,
  );
  const setStatus = db.prepare("UPDATE job SET status = ?, was_saved = ? WHERE id = ?");
  const insert = db.prepare(
    `INSERT INTO job (company_id, company_name, source_type, source_key, source_job_id, title, url, locations,
                      published_at, first_fetched_at, status, was_saved, outdated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const job of jobs) {
    const stored = (
      job.source
        ? bySource.get(job.source.type, job.source.key, job.sourceJobId)
        : bySourceless.get(job.companyName, job.sourceJobId)
    ) as { id: number; status: JobStatus } | undefined;

    if (stored) {
      // Only ever move a status forward: Unseen < Seen < Saved < Applied.
      if (rank(job.status) <= rank(stored.status)) {
        summary.skipped++;
        continue;
      }
      // Applied keeps "was Saved before" when either side had the Job Saved.
      const wasSaved = job.status === "applied" && (job.wasSaved || stored.status === "saved");
      setStatus.run(job.status, wasSaved ? 1 : 0, stored.id);
      summary.statusesRestored++;
      continue;
    }

    const owner = job.source ? companyFollowing(db, job.source) : undefined;
    // Without a followed Company, only Saved and Applied Jobs are kept (as when a Company is removed).
    if (!owner && isUnseenOrSeen(job.status)) {
      summary.skipped++;
      continue;
    }
    insert.run(
      owner?.id ?? null,
      owner?.name ?? job.companyName,
      job.source?.type ?? null,
      job.source?.key ?? null,
      job.sourceJobId,
      job.title,
      job.url,
      JSON.stringify(job.locations),
      job.publishedAt,
      job.firstFetchedAt,
      job.status,
      job.wasSaved ? 1 : 0,
      job.outdated ? 1 : 0,
    );
    summary.added++;
  }
  return summary;
}

// --- Reading the file -------------------------------------------------------------

const notAnExport = "This file isn't a Job Watch export.";

/** The file as an ExportFile, or throws ImportError saying what is wrong with it. */
function parseExportFile(raw: unknown): ExportFile {
  if (!isRecord(raw) || raw.format !== "job-watch") throw new ImportError(notAnExport);
  if (raw.version !== 1) {
    throw new ImportError(`This file is a Job Watch export version ${String(raw.version)}; this Job Watch reads version 1.`);
  }
  const { companies, shortcuts, filter, jobs } = raw;
  if (!Array.isArray(companies)) throw damaged("its Companies are missing");
  if (!Array.isArray(shortcuts)) throw damaged("its Shortcuts are missing");
  if (!Array.isArray(jobs)) throw damaged("its Jobs are missing");
  const parsedFilter = isRecord(filter) ? parseFilter(filter) : null;
  if (!parsedFilter) throw damaged("its Filter is malformed");
  return {
    format: "job-watch",
    version: 1,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
    companies: companies.map(parseCompany),
    shortcuts: shortcuts.map(parseShortcut),
    filter: parsedFilter,
    jobs: jobs.map(parseJob),
  };
}

function damaged(why: string): ImportError {
  return new ImportError(`This Job Watch export can't be imported: ${why}. Nothing was changed.`);
}

function parseCompany(value: unknown, i: number): ExportFile["companies"][number] {
  const where = `Company ${i + 1}`;
  if (!isRecord(value) || !isText(value.name) || !value.name.trim()) throw damaged(`${where} has no name`);
  return { name: value.name.trim(), source: parseSource(value.source, `${where} (${value.name})`) };
}

function parseSource(value: unknown, where: string): SourceRef {
  if (!isRecord(value) || !isText(value.type) || !isText(value.key) || !value.key) throw damaged(`${where} has no Source`);
  const adapter = adapterFor(value.type);
  if (!adapter) throw damaged(`${where} has an unknown Source type "${value.type}"`);
  return { type: adapter.type, key: value.key };
}

function parseShortcut(value: unknown, i: number): ExportFile["shortcuts"][number] {
  if (!isRecord(value) || !isText(value.name) || !isText(value.url) || typeof value.position !== "number") {
    throw damaged(`Shortcut ${i + 1} is malformed`);
  }
  return { name: value.name, url: value.url, position: value.position };
}

function parseJob(value: unknown, i: number): ExportedJob {
  const where = `Job ${i + 1}`;
  if (!isRecord(value)) throw damaged(`${where} is malformed`);
  const { sourceJobId, companyName, title, url, locations, publishedAt, firstFetchedAt, status, wasSaved, outdated } = value;
  const source = value.source === null ? null : parseSource(value.source, where);
  if (!isText(sourceJobId) || !sourceJobId || !isText(companyName) || !isText(title) || !isText(url)) {
    throw damaged(`${where} is malformed`);
  }
  if (!Array.isArray(locations) || !locations.every(isText)) throw damaged(`${where} (${title}) has malformed locations`);
  if (publishedAt !== null && !isText(publishedAt)) throw damaged(`${where} (${title}) has a malformed publication date`);
  if (!isText(firstFetchedAt)) throw damaged(`${where} (${title}) has no first fetch date`);
  if (!isText(status) || !(jobStatuses as string[]).includes(status)) throw damaged(`${where} (${title}) has an unknown status`);
  if (typeof wasSaved !== "boolean" || typeof outdated !== "boolean") throw damaged(`${where} (${title}) is malformed`);
  const jobStatus = status as JobStatus;
  // The same rules as the status table: only Applied carries "was Saved", only Saved and Applied can be Outdated.
  if (wasSaved && jobStatus !== "applied") throw damaged(`${where} (${title}) is marked was Saved without being Applied`);
  if (outdated && isUnseenOrSeen(jobStatus)) throw damaged(`${where} (${title}) is Outdated but not Saved or Applied`);
  if (!source && isUnseenOrSeen(jobStatus)) throw damaged(`${where} (${title}) has no Source`);
  return {
    source,
    sourceJobId,
    companyName,
    title,
    url,
    locations,
    publishedAt,
    firstFetchedAt,
    status: jobStatus,
    wasSaved,
    outdated,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}
