import type { Hono } from "hono";
import type { AppDeps } from "../app.ts";
import { addShortcut, listShortcuts, removeShortcut, renameShortcut } from "../shortcuts.ts";
import { jsonBody } from "./request.ts";

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
    return c.json({ shortcut: renameShortcut(db, Number(c.req.param("id")), name) });
  });

  api.delete("/shortcuts/:id", (c) => {
    removeShortcut(db, Number(c.req.param("id")));
    return c.body(null, 204);
  });
}
