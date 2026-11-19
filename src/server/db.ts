import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Database = DatabaseSync;

/**
 * Opens the SQLite database at `path` (":memory:" for tests) and brings its
 * schema up to date. Migrations are append-only: add a new entry at the end.
 */
export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  migrate(db);
  return db;
}

// Dates are ISO 8601 strings; lists are JSON arrays in TEXT columns.
const migrations: string[] = [
  `CREATE TABLE company (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     source_type TEXT NOT NULL,
     -- slug for ATS Sources, feed URL for RSS/Atom
     source_key TEXT NOT NULL,
     last_error TEXT,
     last_error_at TEXT,
     created_at TEXT NOT NULL,
     UNIQUE (source_type, source_key)
   );
   CREATE TABLE shortcut (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     url TEXT NOT NULL,
     position INTEGER NOT NULL
   );
   CREATE TABLE job (
     id INTEGER PRIMARY KEY,
     -- NULL once the Company is removed; company_name keeps the name for display
     company_id INTEGER REFERENCES company(id) ON DELETE SET NULL,
     company_name TEXT NOT NULL,
     source_job_id TEXT NOT NULL,
     title TEXT NOT NULL,
     url TEXT NOT NULL,
     locations TEXT NOT NULL DEFAULT '[]',
     published_at TEXT,
     first_fetched_at TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'unseen' CHECK (status IN ('unseen', 'seen', 'saved', 'applied')),
     was_saved INTEGER NOT NULL DEFAULT 0,
     outdated INTEGER NOT NULL DEFAULT 0,
     UNIQUE (company_id, source_job_id)
   );
   CREATE TABLE filter (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     cities TEXT NOT NULL DEFAULT '[]',
     required TEXT NOT NULL DEFAULT '[]',
     boosted TEXT NOT NULL DEFAULT '[]',
     excluded TEXT NOT NULL DEFAULT '[]'
   );
   INSERT INTO filter (id) VALUES (1);`,
  // Default Shortcuts, inserted once on first start; removing them later is final.
  `INSERT INTO shortcut (name, url, position) VALUES
     ('Jobup', 'https://www.jobup.ch', 0),
     ('Indeed Switzerland', 'https://ch.indeed.com', 1);`,
];

function migrate(db: Database): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = row.user_version; v < migrations.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(migrations[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
