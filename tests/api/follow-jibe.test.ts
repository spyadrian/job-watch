import { describe, expect, it } from "vitest";
import { createTestApp } from "../support/test-app.ts";

const HOST = "careers.sita.aero";
const HOME = `https://${HOST}/`;
const page = (n: number, host = HOST) => `https://${host}/api/jobs?page=${n}&limit=100`;
const careersPage = { file: "tests/fixtures/sources/careers/jibe.html", contentType: "text/html; charset=utf-8" };
const recorded = {
  [HOME]: careersPage,
  [page(1)]: { file: "tests/fixtures/sources/jibe/sita.json", contentType: "application/json" },
};

describe("discovering a Jibe careers site from a link", () => {
  it("recognises the careers site from its page and reads its Jobs from the API, saving nothing", async () => {
    const { request } = createTestApp({ sources: recorded });

    const res = await request("POST", "/api/companies/discover", { input: HOME });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidates: [
        {
          source: { type: "jibe", key: HOST },
          sourceLabel: "iCIMS (Jibe)",
          suggestedName: "SITA Switzerland Sarl",
          jobCount: 3,
          alreadyFollowing: null,
        },
      ],
    });
    expect(await (await request("GET", "/api/jobs")).json()).toEqual({ jobs: [] });
  });

  it("suggests the site's name when the Jobs don't name their hiring organization", async () => {
    const { request } = createTestApp({
      sources: { [HOME]: careersPage, [page(1)]: { body: { totalCount: 1, jobs: [{ data: { slug: "1", title: "Analyst" } }] } } },
    });

    const res = await request("POST", "/api/companies/discover", { input: HOME });

    expect((await res.json()).candidates[0]).toMatchObject({ suggestedName: "Sita", jobCount: 1 });
  });

  it("recognises a Job link on the careers site", async () => {
    const JOB = `https://${HOST}/jobs/11705?lang=en-us`;
    const { request } = createTestApp({ sources: { ...recorded, [JOB]: careersPage } });

    const res = await request("POST", "/api/companies/discover", { input: JOB });

    expect((await res.json()).candidates.map((c: { source: unknown }) => c.source)).toEqual([{ type: "jibe", key: HOST }]);
  });

  it("recognises the site typed without a scheme", async () => {
    const { request } = createTestApp({ sources: recorded });

    const res = await request("POST", "/api/companies/discover", { input: HOST });

    expect((await res.json()).candidates.map((c: { source: unknown }) => c.source)).toEqual([{ type: "jibe", key: HOST }]);
  });

  it("reads every page until the last one", async () => {
    const { request } = createTestApp({
      sources: { [HOME]: careersPage, [page(1)]: jobsPage(0, 100, 156), [page(2)]: jobsPage(100, 56, 156) },
    });

    const res = await request("POST", "/api/companies/discover", { input: HOME });

    expect((await res.json()).candidates[0]).toMatchObject({ suggestedName: "BigCo SA", jobCount: 156 });
  });

  it("stops after a full last page without asking for an empty one", async () => {
    const { request, requested } = createTestApp({ sources: { [HOME]: careersPage, [page(1)]: jobsPage(0, 100, 100) } });

    const res = await request("POST", "/api/companies/discover", { input: HOME });

    expect((await res.json()).candidates[0].jobCount).toBe(100);
    expect(requested).not.toContain(page(2));
  });

  it("reads at most 10 pages of 100", async () => {
    const pages = Object.fromEntries(Array.from({ length: 12 }, (_, n) => [page(n + 1), jobsPage(n * 100, 100, 1200)]));
    const { request } = createTestApp({ sources: { [HOME]: careersPage, ...pages } });

    const res = await request("POST", "/api/companies/discover", { input: HOME });

    expect((await res.json()).candidates[0].jobCount).toBe(1000);
  });

  it("fails as a whole when a later page fails, never returning a partial list", async () => {
    const { request } = createTestApp({
      sources: { [HOME]: careersPage, [page(1)]: jobsPage(0, 100, 150), [page(2)]: { status: 503, body: "busy" } },
    });

    const res = await request("POST", "/api/companies/discover", { input: HOME });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe(`The Jibe careers site ${HOST} answered with an error (HTTP 503)`);
  });

  it("refuses an answer in an unexpected format rather than reporting zero jobs", async () => {
    const { request } = createTestApp({ sources: { [HOME]: careersPage, [page(1)]: { body: { message: "nope" } } } });

    const res = await request("POST", "/api/companies/discover", { input: HOME });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/unexpected format/);
  });

  it("doesn't take a page that merely mentions Jibe's CDN in its text for a Jibe site", async () => {
    const PAGE = "https://www.acme.example/careers";
    const { request, requested } = createTestApp({
      sources: { [PAGE]: { body: "<html><body>We use jibecdn.com</body></html>", contentType: "text/html" } },
    });

    await request("POST", "/api/companies/discover", { input: PAGE });

    expect(requested).not.toContain(page(1, "www.acme.example"));
  });

  it("is never guessed from a Company name", async () => {
    const { request, requested } = createTestApp();

    await request("POST", "/api/companies/discover", { input: "Sita.aero" });

    expect(requested.filter((url) => url.includes("/api/jobs"))).toEqual([]);
  });
});

describe("following a Jibe careers site", () => {
  it("stores its Jobs with their page on the careers site, every location and the posting date", async () => {
    const { request } = createTestApp({ sources: recorded });

    const res = await request("POST", "/api/companies", { source: { type: "jibe", key: HOST }, name: "SITA" });

    expect(res.status).toBe(201);
    const { jobs } = await (await request("GET", "/api/jobs")).json();
    expect(
      jobs.map((j: Record<string, unknown>) => ({ title: j.title, url: j.url, locations: j.locations, publishedAt: j.publishedAt })),
    ).toEqual([
      {
        title: "Reward Manager",
        url: "https://careers.sita.aero/jobs/11705",
        locations: ["Prague, Czech Republic"],
        publishedAt: "2026-11-04T14:24:00.000Z",
      },
      {
        title: "Senior Software Developer",
        url: "https://careers.sita.aero/jobs/10799",
        locations: ["Sydney, Australia"],
        publishedAt: "2026-08-12T09:52:00.000Z",
      },
      {
        title: "Senior Manager Business Operations",
        url: "https://careers.sita.aero/jobs/11537",
        locations: ["Delhi, India", "Amman, Jordan"],
        publishedAt: "2026-10-12T12:15:00.000Z",
      },
    ]);
  });
});

/** A recorded page of `count` minimal Jobs, numbered from `first`, as the API answers. */
function jobsPage(first: number, count: number, totalCount: number) {
  return {
    body: {
      totalCount,
      jobs: Array.from({ length: count }, (_, i) => ({
        data: {
          slug: String(20000 + first + i),
          title: `Role ${first + i + 1}`,
          full_location: "Geneva, Switzerland",
          posted_date: "2026-11-01T08:00:00+0000",
          hiring_organization: "BigCo SA",
        },
      })),
    },
  };
}
