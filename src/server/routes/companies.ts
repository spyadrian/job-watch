import type { Hono } from "hono";
import type { AppDeps } from "../app.ts";
import { CompanyNotFoundError, followCompany, FollowError, listCompanies, removeCompany, renameCompany } from "../companies.ts";
import { discover, DiscoveryError } from "../discovery.ts";
import type { SourceRef } from "../../shared/types.ts";

/** Registers the Companies routes on the /api sub-app. */
export function registerCompanyRoutes(api: Hono, deps: AppDeps): void {
  /** → { companies }, by name, each with its last read error (null when fine). */
  api.get("/companies", (c) => c.json({ companies: listCompanies(deps) }));

  /** { name } → { company }. The new name shows on all the Company's Jobs. */
  api.patch("/companies/:id", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null;
    const name = typeof body?.name === "string" ? body.name : "";
    try {
      return c.json({ company: renameCompany(Number(c.req.param("id")), name, deps) });
    } catch (err) {
      if (err instanceof FollowError) return c.json({ error: err.message }, err.status);
      if (err instanceof CompanyNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  /** → 204. Deletes its Unseen/Seen Jobs; keeps Saved/Applied ones, Outdated, with the Company's name. */
  api.delete("/companies/:id", (c) => {
    try {
      removeCompany(Number(c.req.param("id")), deps);
      return c.body(null, 204);
    } catch (err) {
      if (err instanceof CompanyNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  /** { input: link or name } → { candidates }. Reads Sources but saves nothing. */
  api.post("/companies/discover", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { input?: unknown } | null;
    if (typeof body?.input !== "string" || !body.input.trim()) {
      return c.json({ error: "Type a link or a Company name first." }, 400);
    }
    try {
      return c.json({ candidates: await discover(body.input, deps) });
    } catch (err) {
      if (err instanceof DiscoveryError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  });

  /** { source: { type, key }, name } → 201 { company, jobCount }. */
  api.post("/companies", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { source?: Partial<SourceRef>; name?: unknown } | null;
    const source = body?.source;
    if (typeof source?.type !== "string" || typeof source.key !== "string" || typeof body?.name !== "string") {
      return c.json({ error: "Expected { source: { type, key }, name }." }, 400);
    }
    try {
      return c.json(await followCompany({ type: source.type, key: source.key }, body.name, deps), 201);
    } catch (err) {
      if (err instanceof FollowError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  });
}
