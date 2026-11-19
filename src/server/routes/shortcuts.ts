import type { Context, Hono } from "hono";
import type { AppDeps } from "../app.ts";
import type { Shortcut } from "../../shared/types.ts";

/** Shortcuts: list, create, rename, remove. */
export function registerShortcutRoutes(api: Hono, deps: Pick<AppDeps, "db">): void {
  const { db } = deps;

  api.get("/shortcuts", (c) => {
    const shortcuts = db
      .prepare("SELECT id, name, url FROM shortcut ORDER BY position, id")
      .all() as unknown as Shortcut[];
    return c.json({ shortcuts: shortcuts.map(toShortcut) });
  });

  api.post("/shortcuts", async (c) => {
    const body = await readBody(c);
    const name = parseName(body.name);
    if (!name) return c.json({ error: "Give the Shortcut a name." }, 400);
    const url = parseUrl(body.url);
    if (!url) return c.json({ error: "Enter a valid web link, starting with https:// or http://." }, 400);

    const row = db
      .prepare(
        `INSERT INTO shortcut (name, url, position)
         VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM shortcut))
         RETURNING id, name, url`,
      )
      .get(name, url) as unknown as Shortcut;
    return c.json({ shortcut: toShortcut(row) }, 201);
  });

  api.patch("/shortcuts/:id", async (c) => {
    const name = parseName((await readBody(c)).name);
    if (!name) return c.json({ error: "Give the Shortcut a name." }, 400);
    const row = db
      .prepare("UPDATE shortcut SET name = ? WHERE id = ? RETURNING id, name, url")
      .get(name, Number(c.req.param("id"))) as unknown as Shortcut | undefined;
    if (!row) return c.json({ error: "This Shortcut no longer exists." }, 404);
    return c.json({ shortcut: toShortcut(row) });
  });

  api.delete("/shortcuts/:id", (c) => {
    const { changes } = db.prepare("DELETE FROM shortcut WHERE id = ?").run(Number(c.req.param("id")));
    if (changes === 0) return c.json({ error: "This Shortcut no longer exists." }, 404);
    return c.body(null, 204);
  });
}

function toShortcut(row: Shortcut): Shortcut {
  return { id: row.id, name: row.name, url: row.url };
}

async function readBody(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => ({}));
  return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

function parseName(value: unknown): string | null {
  const name = typeof value === "string" ? value.trim() : "";
  return name || null;
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
