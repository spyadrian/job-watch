import type { Hono } from "hono";
import type { AppDeps } from "../app.ts";
import { followCompany, listCompanies, removeCompany, renameCompany } from "../companies.ts";
import { discover } from "../discovery.ts";
import type { SourceType } from "../../shared/types.ts";
import { jsonBody } from "./request.ts";

/** Registers the Companies routes on the /api sub-app. */
export function registerCompanyRoutes(api: Hono, deps: AppDeps): void {
  /** → { companies }, by name, each with its last read error (null when fine). */
  api.get("/companies", (c) => c.json({ companies: listCompanies(deps) }));

  /** { name } → { company }. The new name shows on all the Company's Jobs. */
  api.patch("/companies/:id", async (c) => {
    const { name } = await jsonBody(c);
    return c.json({ company: renameCompany(Number(c.req.param("id")), typeof name === "string" ? name : "", deps) });
  });

  /** → 204. Deletes its Unseen/Seen Jobs; keeps Saved/Applied ones, Outdated, with the Company's name. */
  api.delete("/companies/:id", (c) => {
    removeCompany(Number(c.req.param("id")), deps);
    return c.body(null, 204);
  });

  /** { input: link or name } → { candidates }. Reads Sources but saves nothing. */
  api.post("/companies/discover", async (c) => {
    const { input } = await jsonBody(c);
    if (typeof input !== "string" || !input.trim()) {
      return c.json({ error: "Type a link or a Company name first." }, 400);
    }
    return c.json({ candidates: await discover(input, deps) });
  });

  /** { source: { type, key }, name } → 201 { company, jobCount }. */
  api.post("/companies", async (c) => {
    const { source, name } = (await jsonBody(c)) as { source?: { type?: unknown; key?: unknown }; name?: unknown };
    if (typeof source?.type !== "string" || typeof source.key !== "string" || typeof name !== "string") {
      return c.json({ error: "Expected { source: { type, key }, name }." }, 400);
    }
    return c.json(await followCompany({ type: source.type as SourceType, key: source.key }, name, deps), 201);
  });
}
