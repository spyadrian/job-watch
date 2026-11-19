import { describe, expect, it } from "vitest";
import { createTestApp } from "../support/test-app.ts";

describe("HTTP API", () => {
  it("lists no Jobs on a fresh database", async () => {
    const { request } = createTestApp();

    const res = await request("GET", "/api/jobs");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobs: [] });
  });

  it("answers unknown API routes with a JSON error message", async () => {
    const { request } = createTestApp();

    const res = await request("GET", "/api/nope");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });
});
