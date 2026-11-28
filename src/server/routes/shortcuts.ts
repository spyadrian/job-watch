import type { Context, Hono } from "hono";
import type { AppDeps } from "../app.ts";
import { addShortcut, listShortcuts, removeShortcut, ShortcutNotFoundError, updateShortcut } from "../shortcuts.ts";
import { idParam, jsonBody } from "./request.ts";

const shortcutId = (c: Context) => idParam(c, () => new ShortcutNotFoundError());

/** Shortcuts: list, create, edit (name and link), remove. */
export function registerShortcutRoutes(api: Hono, deps: Pick<AppDeps, "db">): void {
  const { db } = deps;

  api.get("/shortcuts", (c) => c.json({ shortcuts: listShortcuts(db) }));

  /** { name, url } → 201 { shortcut }, added at the end. */
  api.post("/shortcuts", async (c) => {
    const body = await jsonBody(c);
    return c.json({ shortcut: addShortcut(db, body.name, body.url) }, 201);
  });

  /** { name?, url? } (at least one) → { shortcut }, in the same place. */
  api.patch("/shortcuts/:id", async (c) => {
    const { name, url } = await jsonBody(c);
    return c.json({ shortcut: updateShortcut(db, shortcutId(c), { name, url }) });
  });

  api.delete("/shortcuts/:id", (c) => {
    removeShortcut(db, shortcutId(c));
    return c.body(null, 204);
  });
}
