import type { Context, Hono } from "hono";
import type { AppDeps } from "../app.ts";
import { addShortcut, listShortcuts, removeShortcut, renameShortcut, ShortcutNotFoundError } from "../shortcuts.ts";
import { idParam, jsonBody } from "./request.ts";

const shortcutId = (c: Context) => idParam(c, () => new ShortcutNotFoundError());

/** Shortcuts: list, create, rename, remove. */
export function registerShortcutRoutes(api: Hono, deps: Pick<AppDeps, "db">): void {
  const { db } = deps;

  api.get("/shortcuts", (c) => c.json({ shortcuts: listShortcuts(db) }));

  /** { name, url } → 201 { shortcut }, added at the end. */
  api.post("/shortcuts", async (c) => {
    const body = await jsonBody(c);
    return c.json({ shortcut: addShortcut(db, body.name, body.url) }, 201);
  });

  /** { name } → { shortcut }. */
  api.patch("/shortcuts/:id", async (c) => {
    const { name } = await jsonBody(c);
    return c.json({ shortcut: renameShortcut(db, shortcutId(c), name) });
  });

  api.delete("/shortcuts/:id", (c) => {
    removeShortcut(db, shortcutId(c));
    return c.body(null, 204);
  });
}
