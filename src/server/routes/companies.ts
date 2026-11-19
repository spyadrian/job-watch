import type { Hono } from "hono";
import type { AppDeps } from "../app.ts";
import { followCompany, FollowError } from "../companies.ts";
import { discover, DiscoveryError } from "../discovery.ts";
import type { SourceRef } from "../../shared/types.ts";

/** Registers the Companies routes on the /api sub-app. */
export function registerCompanyRoutes(api: Hono, deps: AppDeps): void {
  /** { input } → { candidates }. Reads Sources but saves nothing. */
  api.post("/companies/discover", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { input?: unknown } | null;
    if (typeof body?.input !== "string" || !body.input.trim()) {
      return c.json({ error: "Paste a link first." }, 400);
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
