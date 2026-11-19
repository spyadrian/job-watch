import { describe, expect, it } from "vitest";
import { createTestApp } from "../support/test-app.ts";

const ACME_JOBS = "https://boards-api.greenhouse.io/v1/boards/acme/jobs";
const acme = { [ACME_JOBS]: { file: "tests/fixtures/sources/greenhouse/acme.json", contentType: "application/json" } };

describe("discovering a Greenhouse Company from a link", () => {
  it("reads the board and reports N jobs found with a suggested name, saving nothing", async () => {
    const { request } = createTestApp({ sources: acme });

    const res = await request("POST", "/api/companies/discover", { input: "https://job-boards.greenhouse.io/acme" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidates: [
        {
          source: { type: "greenhouse", key: "acme" },
          sourceLabel: "Greenhouse",
          suggestedName: "Acme Robotics",
          jobCount: 3,
          alreadyFollowing: null,
        },
      ],
    });
    expect(await (await request("GET", "/api/jobs")).json()).toEqual({ jobs: [] });
  });

  it.each([
    "https://job-boards.greenhouse.io/acme/jobs/4012001",
    "https://job-boards.greenhouse.io/acme/jobs/4012001?gh_src=abc",
    "https://boards.greenhouse.io/acme",
    "https://boards.greenhouse.io/acme/jobs/4012002#app",
    "https://boards.greenhouse.io/embed/job_board?for=acme",
    "https://boards.greenhouse.io/embed/job_app?for=acme&token=4012001",
    "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
    "job-boards.greenhouse.io/acme",
    "  https://job-boards.greenhouse.io/Acme  ",
  ])("recognises %s as the Greenhouse board acme", async (input) => {
    const { request } = createTestApp({ sources: acme });

    const res = await request("POST", "/api/companies/discover", { input });

    const body = await res.json();
    expect(body.candidates.map((c: { source: unknown }) => c.source)).toEqual([{ type: "greenhouse", key: "acme" }]);
  });

  it("finds no candidate for a link no adapter recognises", async () => {
    const { request } = createTestApp({ sources: acme });

    const res = await request("POST", "/api/companies/discover", { input: "https://greenhouse.io/blog" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ candidates: [] });
  });

  it("rejects a link it can't open with a clear message", async () => {
    const { request } = createTestApp({ sources: acme });

    const res = await request("POST", "/api/companies/discover", { input: "mailto://jobs@acme.example" });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/doesn't look like a link/);
  });

  it("explains when the board doesn't exist", async () => {
    const { request, sources } = createTestApp();
    sources["https://boards-api.greenhouse.io/v1/boards/nope/jobs"] = { status: 404, body: { status: 404, error: "Job not found" } };

    const res = await request("POST", "/api/companies/discover", { input: "https://job-boards.greenhouse.io/nope" });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('The Greenhouse board "nope" doesn\'t exist (HTTP 404)');
  });

  it("explains when the board can't be reached", async () => {
    const { request } = createTestApp(); // nothing recorded: fetch fails like a network error

    const res = await request("POST", "/api/companies/discover", { input: "https://job-boards.greenhouse.io/acme" });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('Couldn\'t reach the Greenhouse board "acme"');
  });

  it("refuses an answer in an unexpected format rather than reporting zero jobs", async () => {
    const { request, sources } = createTestApp();
    sources[ACME_JOBS] = { body: "<html>maintenance</html>", contentType: "text/html" };

    const res = await request("POST", "/api/companies/discover", { input: "https://job-boards.greenhouse.io/acme" });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/valid JSON/);
  });
});

describe("following a Greenhouse Company", () => {
  it("stores its Jobs as Unseen, first fetched now, with the normalized Source data", async () => {
    const { request } = createTestApp({ sources: acme, now: "2026-01-15T09:00:00Z" });

    const res = await request("POST", "/api/companies", {
      source: { type: "greenhouse", key: "acme" },
      name: "  Acme  ",
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      company: {
        id: expect.any(Number),
        name: "Acme",
        source: { type: "greenhouse", key: "acme" },
        sourceLabel: "Greenhouse",
        createdAt: "2026-01-15T09:00:00.000Z",
        lastError: null,
      },
      jobCount: 3,
    });
    const { jobs } = await (await request("GET", "/api/jobs")).json();
    const common = {
      companyName: "Acme",
      firstFetchedAt: "2026-01-15T09:00:00.000Z",
      status: "unseen",
      wasSaved: false,
      outdated: false,
    };
    expect(jobs).toEqual([
      {
        ...common,
        id: expect.any(Number),
        title: "Senior Backend Engineer",
        url: "https://job-boards.greenhouse.io/acme/jobs/4012001",
        locations: ["Zürich, Switzerland"],
        publishedAt: "2026-01-08T14:00:00.000Z",
      },
      {
        ...common,
        id: expect.any(Number),
        title: "Product Designer",
        url: "https://job-boards.greenhouse.io/acme/jobs/4012002",
        locations: ["Geneva; Lausanne; Remote - Switzerland"],
        publishedAt: "2026-01-10T17:30:00.000Z",
      },
      {
        ...common,
        id: expect.any(Number),
        title: "Office Manager",
        url: "https://job-boards.greenhouse.io/acme/jobs/4012003",
        locations: [],
        publishedAt: null,
      },
    ]);
  });

  it("requires a name", async () => {
    const { request } = createTestApp({ sources: acme });

    const res = await request("POST", "/api/companies", { source: { type: "greenhouse", key: "acme" }, name: "  " });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/name/i);
  });

  it("rejects an unknown Source type", async () => {
    const { request } = createTestApp({ sources: acme });

    const res = await request("POST", "/api/companies", { source: { type: "myspace", key: "acme" }, name: "Acme" });

    expect(res.status).toBe(400);
  });

  it("saves nothing when the Source can't be read", async () => {
    const { request } = createTestApp();

    const res = await request("POST", "/api/companies", { source: { type: "greenhouse", key: "acme" }, name: "Acme" });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Couldn't reach/);
    expect(await (await request("GET", "/api/jobs")).json()).toEqual({ jobs: [] });
  });

  it("refuses a Source already followed, and discovery flags it", async () => {
    const { request } = createTestApp({ sources: acme });
    await request("POST", "/api/companies", { source: { type: "greenhouse", key: "acme" }, name: "Acme" });

    const again = await request("POST", "/api/companies", { source: { type: "greenhouse", key: "acme" }, name: "Other" });
    const discovered = await request("POST", "/api/companies/discover", {
      input: "https://job-boards.greenhouse.io/acme",
    });

    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("Already following Acme");
    expect((await discovered.json()).candidates[0].alreadyFollowing).toBe("Acme");
    expect((await (await request("GET", "/api/jobs")).json()).jobs).toHaveLength(3);
  });
});
