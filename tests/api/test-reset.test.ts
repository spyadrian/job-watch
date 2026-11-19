import { describe, expect, it } from "vitest";
import { createTestApp } from "../support/test-app.ts";

const ACME_JOBS = "https://boards-api.greenhouse.io/v1/boards/acme/jobs";
const acme = { [ACME_JOBS]: { file: "tests/fixtures/sources/greenhouse/acme.json", contentType: "application/json" } };

// The e2e suite resets the server between tests; the endpoint only exists in that mode.
describe("test-only reset", () => {
  it("is not available by default", async () => {
    const { request } = createTestApp();

    const res = await request("POST", "/api/test/reset");

    expect(res.status).toBe(404);
  });

  it("brings the database back to a fresh first start when enabled", async () => {
    const { request } = createTestApp({ sources: acme, testReset: true });
    const fresh = await (await request("GET", "/api/shortcuts")).json();
    await request("POST", "/api/companies", { source: { type: "greenhouse", key: "acme" }, name: "Acme" });
    await request("POST", "/api/shortcuts", { name: "Extra", url: "https://extra.example" });

    const res = await request("POST", "/api/test/reset");

    expect(res.status).toBe(204);
    expect(await (await request("GET", "/api/jobs")).json()).toEqual({ jobs: [] });
    expect(await (await request("GET", "/api/shortcuts")).json()).toEqual(fresh);
    // The Company is gone too: following it again succeeds.
    const again = await request("POST", "/api/companies", { source: { type: "greenhouse", key: "acme" }, name: "Acme" });
    expect(again.status).toBe(201);
  });
});
