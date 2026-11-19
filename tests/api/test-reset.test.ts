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

  it("forgets a running refresh: the next refresh starts afresh and the old one writes nothing", async () => {
    let release = () => {};
    let hold = false;
    const { request, app } = createTestApp({
      sources: acme,
      testReset: true,
      wrapFetch: (recorded) => async (input, init) => {
        if (hold) await new Promise<void>((go) => (release = go));
        return recorded(input, init);
      },
    });
    await request("POST", "/api/companies", { source: { type: "greenhouse", key: "acme" }, name: "Acme" });
    hold = true;
    const stale = app.request("/api/refresh", { method: "POST" });
    await new Promise((r) => setTimeout(r, 5));

    expect((await request("POST", "/api/test/reset")).status).toBe(204);
    hold = false;
    const fresh = await (await request("POST", "/api/refresh")).text();
    release();
    await (await stale).text();

    expect(fresh.trim().split("\n").map((line) => JSON.parse(line))).toEqual([
      { type: "start", total: 0 },
      { type: "done", summary: { new: 0, outdated: 0, failed: 0 } },
    ]);
    expect(await (await request("GET", "/api/jobs")).json()).toEqual({ jobs: [] });
  });

  it("stops the forgotten refresh from reading the Sources it hadn't reached yet", async () => {
    const GLOBEX_JOBS = "https://boards-api.greenhouse.io/v1/boards/globex/jobs";
    let release = () => {};
    let hold = false;
    const { request, app, requested } = createTestApp({
      sources: { ...acme, [GLOBEX_JOBS]: acme[ACME_JOBS] },
      testReset: true,
      refreshConcurrency: 1,
      wrapFetch: (recorded) => async (input, init) => {
        if (hold) await new Promise<void>((go) => (release = go));
        return recorded(input, init);
      },
    });
    await request("POST", "/api/companies", { source: { type: "greenhouse", key: "acme" }, name: "Acme" });
    await request("POST", "/api/companies", { source: { type: "greenhouse", key: "globex" }, name: "Globex" });
    hold = true;
    const stale = app.request("/api/refresh", { method: "POST" });
    await new Promise((r) => setTimeout(r, 5));
    const before = requested.length;

    expect((await request("POST", "/api/test/reset")).status).toBe(204);
    hold = false;
    release();
    await (await stale).text();

    expect(requested.slice(before)).toEqual([]);
  });
});
