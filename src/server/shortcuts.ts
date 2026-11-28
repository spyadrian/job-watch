// Shortcuts storage: links to careers sites whose Jobs can't be read automatically.
// Routes live in routes/shortcuts.ts.
import type { Shortcut } from "../shared/types.ts";
import type { Database } from "./db.ts";
import { RequestError } from "./errors.ts";

export class ShortcutNotFoundError extends RequestError {
  constructor() {
    super("This Shortcut no longer exists.", 404);
    this.name = "ShortcutNotFoundError";
  }
}

/** Every Shortcut, in the order they were added. */
export function listShortcuts(db: Database): Shortcut[] {
  const rows = db.prepare("SELECT id, name, url FROM shortcut ORDER BY position, id").all() as unknown as Shortcut[];
  return rows.map(toShortcut);
}

/** Adds a Shortcut at the end of the list. Throws RequestError (400) on a blank name or a link that isn't http(s). */
export function addShortcut(db: Database, rawName: unknown, rawUrl: unknown): Shortcut {
  const name = parseName(rawName);
  const url = requireUrl(rawUrl);
  const row = db
    .prepare(
      `INSERT INTO shortcut (name, url, position)
       VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM shortcut))
       RETURNING id, name, url`,
    )
    .get(name, url) as unknown as Shortcut;
  return toShortcut(row);
}

/**
 * Changes a Shortcut's name, its link, or both; it keeps its place. Throws RequestError (400) when
 * neither is given, on a blank name or a link that isn't http(s), and 404 for an unknown id.
 */
export function updateShortcut(db: Database, id: number, changes: { name?: unknown; url?: unknown }): Shortcut {
  if (changes.name === undefined && changes.url === undefined) {
    throw new RequestError("Give the Shortcut a new name or link.", 400);
  }
  const name = changes.name === undefined ? null : parseName(changes.name);
  const url = changes.url === undefined ? null : requireUrl(changes.url);
  const row = db
    .prepare(
      `UPDATE shortcut SET name = COALESCE(?, name), url = COALESCE(?, url)
       WHERE id = ? RETURNING id, name, url`,
    )
    .get(name, url, id) as unknown as Shortcut | undefined;
  if (!row) throw new ShortcutNotFoundError();
  return toShortcut(row);
}

export function removeShortcut(db: Database, id: number): void {
  const { changes } = db.prepare("DELETE FROM shortcut WHERE id = ?").run(id);
  if (changes === 0) throw new ShortcutNotFoundError();
}

function toShortcut(row: Shortcut): Shortcut {
  return { id: row.id, name: row.name, url: row.url };
}

function parseName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new RequestError("Give the Shortcut a name.", 400);
  return name;
}

function requireUrl(value: unknown): string {
  const url = parseUrl(value);
  if (!url) throw new RequestError("Enter a valid web link, starting with https:// or http://.", 400);
  return url;
}

/** An absolute http(s) link, or null. */
function parseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!URL.canParse(text)) return null;
  const url = new URL(text);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return text;
}
