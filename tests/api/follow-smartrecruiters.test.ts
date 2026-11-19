import { describe, expect, it } from "vitest";
import { createTestApp } from "../support/test-app.ts";

const API = "https://api.smartrecruiters.com/v1/companies";
const page = (company: string, offset: number) => `${API}/${company}/postings?limit=100&offset=${offset}`;
const recorded = {
  [page("helveticafoods", 0)]: {
    file: "tests/fixtures/sources/smartrecruiters/helvetica-foods.json",
    contentType: "application/json",
  },
};

/** A recorded page of `count` minimal postings starting at `offset`, as the API answers. */
function postingsPage(offset: number, count: number, totalFound: number) {
  return {
    body: {
      offset,
      limit: 100,
      totalFound,
      content: Array.from({ length: count }, (_, i) => ({
        id: String(744000200000000 + offset + i),
        name: `Role ${offset + i + 1}`,
        company: { identifier: "BigCo", name: "BigCo SA" },
        releasedDate: "2026-01-05T10:00:00.000Z",
        location: { city: "Bern", region: "BE", country: "ch", fullLocation: "Bern, BE, Switzerland" },
      })),
    },
  };
}

describe("discovering a SmartRecruiters Company from a link", () => {
  it("reads the postings and reports N jobs found with the Company's name, saving nothing", async () => {
    const { request } = createTestApp({ sources: recorded });

    const res = await request("POST", "/api/companies/discover", {
      input: "https://careers.smartrecruiters.com/HelveticaFoods",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidates: [
        {
          source: { type: "smartrecruiters", key: "helveticafoods" },
          sourceLabel: "SmartRecruiters",
          suggestedName: "Helvetica Foods AG",
          jobCount: 3,
          alreadyFollowing: null,
        },
      ],
    });
    expect(await (await request("GET", "/api/jobs")).json()).toEqual({ jobs: [] });
  });

  it.each([
    "https://careers.smartrecruiters.com/HelveticaFoods/",
    "https://careers.smartrecruiters.com/HelveticaFoods/research",
    "https://jobs.smartrecruiters.com/HelveticaFoods",
    "https://jobs.smartrecruiters.com/HelveticaFoods/744000100000001-food-scientist",
    "https://jobs.smartrecruiters.com/HelveticaFoods/744000100000001-food-scientist?trid=abc",
    "https://jobs.smartrecruiters.com/oneclick-ui/company/HelveticaFoods/publication/0b1c2d3e-0000-4000-8000-000000000001",
    "https://api.smartrecruiters.com/v1/companies/helveticafoods/postings",
    "careers.smartrecruiters.com/helveticafoods",
  ])("recognises %s as the SmartRecruiters Company helveticafoods", async (input) => {
    const { request } = createTestApp({ sources: recorded });

    const res = await request("POST", "/api/companies/discover", { input });

    const body = await res.json();
    expect(body.candidates.map((c: { source: unknown }) => c.source)).toEqual([
      { type: "smartrecruiters", key: "helveticafoods" },
    ]);
  });

  it("reads every page until the last one", async () => {
    const { request } = createTestApp({
      sources: { [page("bigco", 0)]: postingsPage(0, 100, 250), [page("bigco", 100)]: postingsPage(100, 100, 250), [page("bigco", 200)]: postingsPage(200, 50, 250) },
    });

    const res = await request("POST", "/api/companies/discover", { input: "https://careers.smartrecruiters.com/BigCo" });

    expect(res.status).toBe(200);
    expect((await res.json()).candidates[0].jobCount).toBe(250);
  });

  it("stops after a full last page without asking for an empty one", async () => {
    const { request } = createTestApp({ sources: { [page("bigco", 0)]: postingsPage(0, 100, 100) } });

    const res = await request("POST", "/api/companies/discover", { input: "https://careers.smartrecruiters.com/BigCo" });

    expect(res.status).toBe(200);
    expect((await res.json()).candidates[0].jobCount).toBe(100);
  });

  it("reads at most 10 pages of 100", async () => {
    const sources = Object.fromEntries(
      Array.from({ length: 12 }, (_, n) => [page("bigco", n * 100), postingsPage(n * 100, 100, 1200)]),
    );
    const { request } = createTestApp({ sources });

    const res = await request("POST", "/api/companies/discover", { input: "https://careers.smartrecruiters.com/BigCo" });

    expect(res.status).toBe(200);
    expect((await res.json()).candidates[0].jobCount).toBe(1000);
  });

  it("fails as a whole when a later page fails, never returning a partial list", async () => {
    const { request } = createTestApp({
      sources: { [page("bigco", 0)]: postingsPage(0, 100, 150), [page("bigco", 100)]: { status: 503, body: "busy" } },
    });

    const res = await request("POST", "/api/companies/discover", { input: "https://careers.smartrecruiters.com/BigCo" });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('The SmartRecruiters Company "bigco" answered with an error (HTTP 503)');
  });

  it("refuses an answer in an unexpected format rather than reporting zero jobs", async () => {
    const { request } = createTestApp({ sources: { [page("bigco", 0)]: { body: { message: "nope" } } } });

    const res = await request("POST", "/api/companies/discover", { input: "https://careers.smartrecruiters.com/BigCo" });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/unexpected format/);
  });
});

describe("following a SmartRecruiters Company", () => {
  it("stores its Jobs with their public page, raw location and release date", async () => {
    const { request } = createTestApp({ sources: recorded });

    const res = await request("POST", "/api/companies", {
      source: { type: "smartrecruiters", key: "helveticafoods" },
      name: "Helvetica Foods",
    });

    expect(res.status).toBe(201);
    const { jobs } = await (await request("GET", "/api/jobs")).json();
    expect(
      jobs.map((j: Record<string, unknown>) => ({ title: j.title, url: j.url, locations: j.locations, publishedAt: j.publishedAt })),
    ).toEqual([
      {
        title: "Food Scientist",
        url: "https://jobs.smartrecruiters.com/HelveticaFoods/744000100000001",
        locations: ["Vevey, Vaud, Switzerland"],
        publishedAt: "2026-01-08T14:00:00.000Z",
      },
      {
        title: "Supply Chain Planner",
        url: "https://jobs.smartrecruiters.com/HelveticaFoods/744000100000002",
        locations: ["Basel, BS, ch"],
        publishedAt: "2026-01-10T16:45:00.000Z",
      },
      {
        title: "Brand Manager",
        url: "https://jobs.smartrecruiters.com/HelveticaFoods/744000100000003",
        locations: ["Remote"],
        publishedAt: null,
      },
    ]);
  });
});
