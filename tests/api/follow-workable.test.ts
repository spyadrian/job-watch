import { describe, expect, it } from "vitest";
import { createTestApp } from "../support/test-app.ts";

const ACME_WIDGET = "https://apply.workable.com/api/v1/widget/accounts/acme";
const acme = { [ACME_WIDGET]: { file: "tests/fixtures/sources/workable/acme.json", contentType: "application/json" } };

describe("discovering a Workable Company from a link", () => {
  it("reads the public widget API and reports N jobs found with the account's name", async () => {
    const { request } = createTestApp({ sources: acme });

    const res = await request("POST", "/api/companies/discover", { input: "https://apply.workable.com/acme/" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidates: [
        {
          source: { type: "workable", key: "acme" },
          sourceLabel: "Workable",
          suggestedName: "Acme Robotics",
          jobCount: 3,
          alreadyFollowing: null,
        },
      ],
    });
  });

  it.each([
    "https://apply.workable.com/acme",
    "https://apply.workable.com/acme/j/81B46579FE/",
    "https://apply.workable.com/acme/j/81B46579FE/apply/?utm_source=x",
    "https://apply.workable.com/api/v1/widget/accounts/acme",
    "https://apply.workable.com/api/v3/accounts/acme/jobs",
    "https://acme.workable.com/",
    "https://acme.workable.com/jobs/1234567",
    "apply.workable.com/Acme",
  ])("recognises %s as the Workable account acme", async (input) => {
    const { request } = createTestApp({ sources: acme });

    const res = await request("POST", "/api/companies/discover", { input });

    const body = await res.json();
    expect(body.candidates.map((c: { source: unknown }) => c.source)).toEqual([{ type: "workable", key: "acme" }]);
  });

  it.each([
    "https://apply.workable.com/j/81B46579FE",
    "https://www.workable.com/pricing",
    "https://apply.workable.com/",
  ])("doesn't guess an account from %s", async (input) => {
    const { request } = createTestApp({ sources: acme });

    const res = await request("POST", "/api/companies/discover", { input });

    expect((await res.json()).candidates).toEqual([]);
  });

  it("explains when the account doesn't exist", async () => {
    const { request, sources } = createTestApp();
    sources["https://apply.workable.com/api/v1/widget/accounts/nope"] = { status: 404, body: "Not Found" };

    const res = await request("POST", "/api/companies/discover", { input: "https://apply.workable.com/nope/" });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('The Workable account "nope" doesn\'t exist (HTTP 404)');
  });

  it("refuses an answer in an unexpected format rather than reporting zero jobs", async () => {
    const { request, sources } = createTestApp();
    sources[ACME_WIDGET] = { body: { name: "Acme" } };

    const res = await request("POST", "/api/companies/discover", { input: "https://apply.workable.com/acme/" });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/unexpected format/);
  });
});

describe("following a Workable Company", () => {
  it("stores its Jobs with their visible locations, remote flag and publication date", async () => {
    const { request } = createTestApp({ sources: acme, now: "2026-01-15T09:00:00Z" });

    const res = await request("POST", "/api/companies", { source: { type: "workable", key: "acme" }, name: "Acme" });

    expect(res.status).toBe(201);
    const { jobs } = await (await request("GET", "/api/jobs")).json();
    const pick = (job: Record<string, unknown>) => ({
      title: job.title,
      url: job.url,
      locations: job.locations,
      publishedAt: job.publishedAt,
    });
    expect(jobs.map(pick)).toEqual([
      {
        title: "Machine Learning Engineer - EMEA Remote",
        url: "https://apply.workable.com/j/81B46579FE",
        locations: ["Zürich, Zürich, Switzerland", "Paris, Île-de-France, France", "Remote"],
        publishedAt: "2026-01-08T00:00:00.000Z",
      },
      {
        title: "Product Designer",
        url: "https://apply.workable.com/j/19A136F8E2",
        locations: ["Geneva, Switzerland"],
        publishedAt: "2026-01-10T00:00:00.000Z",
      },
      {
        title: "Wild Card",
        url: "https://apply.workable.com/j/5C2D7E91AB",
        locations: [],
        publishedAt: null,
      },
    ]);
  });
});
