import { describe, expect, it } from "vitest";
import { createTestApp } from "../support/test-app.ts";

const LUMEN = "https://api.ashbyhq.com/posting-api/job-board/lumen";
const recorded = { [LUMEN]: { file: "tests/fixtures/sources/ashby/lumen.json", contentType: "application/json" } };

describe("discovering an Ashby Company from a link", () => {
  it("reports only the listed Jobs as found, saving nothing", async () => {
    const { request } = createTestApp({ sources: recorded });

    const res = await request("POST", "/api/companies/discover", { input: "https://jobs.ashbyhq.com/lumen" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidates: [
        {
          source: { type: "ashby", key: "lumen" },
          sourceLabel: "Ashby",
          suggestedName: "Lumen",
          jobCount: 2,
          alreadyFollowing: null,
        },
      ],
    });
    expect(await (await request("GET", "/api/jobs")).json()).toEqual({ jobs: [] });
  });

  it.each([
    "https://jobs.ashbyhq.com/lumen/",
    "https://jobs.ashbyhq.com/Lumen",
    "https://jobs.ashbyhq.com/lumen/1a2b3c4d-0000-4a00-8000-000000000001",
    "https://jobs.ashbyhq.com/lumen/1a2b3c4d-0000-4a00-8000-000000000001/application?utm_source=x",
    "https://jobs.ashbyhq.com/lumen/jobs",
    "https://api.ashbyhq.com/posting-api/job-board/lumen?includeCompensation=true",
    "jobs.ashbyhq.com/lumen",
  ])("recognises %s as the Ashby board lumen", async (input) => {
    const { request } = createTestApp({ sources: recorded });

    const res = await request("POST", "/api/companies/discover", { input });

    const body = await res.json();
    expect(body.candidates.map((c: { source: unknown }) => c.source)).toEqual([{ type: "ashby", key: "lumen" }]);
  });

  it("explains when the board doesn't exist", async () => {
    const { request, sources } = createTestApp();
    sources["https://api.ashbyhq.com/posting-api/job-board/nope"] = { status: 404, body: "Not Found" };

    const res = await request("POST", "/api/companies/discover", { input: "https://jobs.ashbyhq.com/nope" });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('The Ashby board "nope" doesn\'t exist (HTTP 404)');
  });

  it("refuses an answer in an unexpected format rather than reporting zero jobs", async () => {
    const { request, sources } = createTestApp();
    sources[LUMEN] = { body: { apiVersion: "1" } };

    const res = await request("POST", "/api/companies/discover", { input: "https://jobs.ashbyhq.com/lumen" });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/unexpected format/);
  });
});

describe("following an Ashby Company", () => {
  it("stores only the listed Jobs, with primary then secondary locations", async () => {
    const { request } = createTestApp({ sources: recorded });

    const res = await request("POST", "/api/companies", { source: { type: "ashby", key: "lumen" }, name: "Lumen" });

    expect(res.status).toBe(201);
    expect((await res.json()).jobCount).toBe(2);
    const { jobs } = await (await request("GET", "/api/jobs")).json();
    expect(
      jobs.map((j: Record<string, unknown>) => ({ title: j.title, url: j.url, locations: j.locations, publishedAt: j.publishedAt })),
    ).toEqual([
      {
        title: "Senior Data Engineer",
        url: "https://jobs.ashbyhq.com/lumen/1a2b3c4d-0000-4a00-8000-000000000001",
        locations: ["Zürich", "Bern", "Remote - Switzerland"],
        publishedAt: "2026-01-08T14:00:00.000Z",
      },
      {
        title: "Customer Success Manager",
        url: "https://jobs.ashbyhq.com/lumen/1a2b3c4d-0000-4a00-8000-000000000003",
        locations: ["Remote - Europe"],
        publishedAt: "2026-01-10T16:45:00.000Z",
      },
    ]);
  });
});
