import { describe, expect, it } from "vitest";
import { createTestApp } from "../support/test-app.ts";

// Every route that names a Job, Company or Shortcut by id in its path.
const routes: [method: string, path: (id: string) => string, body?: unknown][] = [
  ["POST", (id) => `/api/jobs/${id}/status`, { action: "seen" }],
  ["POST", (id) => `/api/jobs/${id}/undo`, { status: "unseen", wasSaved: false }],
  ["PATCH", (id) => `/api/companies/${id}`, { name: "Acme" }],
  ["DELETE", (id) => `/api/companies/${id}`],
  ["PATCH", (id) => `/api/shortcuts/${id}`, { name: "Jobs" }],
  ["DELETE", (id) => `/api/shortcuts/${id}`],
];

describe("an id that isn't a whole number", () => {
  it.each(routes.flatMap(([method, path, body]) => ["abc", "1.5", "1e0", "-1"].map((id) => [method, path(id), body] as const)))(
    "answers %s %s with 404",
    async (method, path, body) => {
      const { request } = createTestApp();

      const res = await request(method, path, body);

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: expect.any(String) });
    },
  );
});
