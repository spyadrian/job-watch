import { describe, expect, it } from "vitest";
import type { RecordedSources } from "../../src/server/recorded-fetch.ts";
import { createTestApp } from "../support/test-app.ts";

const json = (path: string) => ({ file: `tests/fixtures/sources/${path}`, contentType: "application/json" });
const html = (name: string) => ({ file: `tests/fixtures/sources/careers/${name}.html`, contentType: "text/html; charset=utf-8" });

/** The recorded boards of every supported ATS, keyed by their API URL. */
const boards: RecordedSources = {
  "https://boards-api.greenhouse.io/v1/boards/acme/jobs": json("greenhouse/acme.json"),
  "https://api.lever.co/v0/postings/northwind?mode=json": json("lever/northwind.json"),
  "https://api.eu.lever.co/v0/postings/alpenbank?mode=json": json("lever/alpenbank-eu.json"),
  "https://api.ashbyhq.com/posting-api/job-board/lumen": json("ashby/lumen.json"),
  "https://api.smartrecruiters.com/v1/companies/helveticafoods/postings?limit=100&offset=0": json(
    "smartrecruiters/helvetica-foods.json",
  ),
  "https://acme.recruitee.com/api/offers/": json("recruitee/acme.json"),
  "https://apply.workable.com/api/v1/widget/accounts/acme": json("workable/acme.json"),
  "https://acme.jobs.personio.de/xml": { file: "tests/fixtures/sources/personio/acme.xml", contentType: "text/xml" },
};

const CAREERS = "https://www.acme.example/careers";

describe("discovering a Company from its own careers page", () => {
  it.each([
    ["greenhouse", { type: "greenhouse", key: "acme" }, "Greenhouse", "Acme Robotics", 3],
    ["lever", { type: "lever", key: "northwind" }, "Lever", "Northwind", 3],
    ["lever-eu", { type: "lever-eu", key: "alpenbank" }, "Lever (EU)", "Alpenbank", 1],
    ["ashby", { type: "ashby", key: "lumen" }, "Ashby", "Lumen", 2],
    ["smartrecruiters", { type: "smartrecruiters", key: "helveticafoods" }, "SmartRecruiters", "Helvetica Foods AG", 3],
    ["recruitee", { type: "recruitee", key: "acme" }, "Recruitee", "Acme Robotics", 3],
    ["workable", { type: "workable", key: "acme" }, "Workable", "Acme Robotics", 3],
    ["personio", { type: "personio", key: "acme" }, "Personio", "Acme Robotics AG", 3],
  ])("finds an embedded %s board in the page", async (page, source, sourceLabel, suggestedName, jobCount) => {
    const { request, requested } = createTestApp({ sources: { ...boards, [CAREERS]: html(page) } });

    const res = await request("POST", "/api/companies/discover", { input: CAREERS });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidates: [{ source, sourceLabel, suggestedName, jobCount, alreadyFollowing: null }],
    });
    expect(requested.filter((url) => url === CAREERS)).toHaveLength(1);
  });

  it("finds no candidate on a page with no board and no feed", async () => {
    const { request, requested } = createTestApp({ sources: { ...boards, [CAREERS]: html("nothing") } });

    const res = await request("POST", "/api/companies/discover", { input: CAREERS });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ candidates: [] });
    expect(requested).toEqual([CAREERS]);
  });

  it("finds no candidate when the page can't be fetched", async () => {
    const { request } = createTestApp({ sources: { [CAREERS]: { status: 403, body: "Forbidden" } } });

    const res = await request("POST", "/api/companies/discover", { input: CAREERS });

    expect(await res.json()).toEqual({ candidates: [] });
  });
});

describe("discovering a Company from a careers page that advertises a feed", () => {
  const PAGE = "https://careers.acme.example/";
  const FEED = "https://careers.acme.example/feed/";
  const rss = (name: string) => ({ file: `tests/fixtures/sources/feed/${name}.xml`, contentType: "application/rss+xml" });

  it('reads the page\'s <link rel="alternate"> RSS feed, resolved against the page URL', async () => {
    const { request } = createTestApp({
      sources: {
        [PAGE]: html("feed-link"),
        [FEED]: rss("acme-rss"),
        [`${FEED}?paged=2`]: rss("acme-rss-page2"),
        [`${FEED}?paged=3`]: rss("empty-rss"),
      },
    });

    const res = await request("POST", "/api/companies/discover", { input: PAGE });

    expect(await res.json()).toEqual({
      candidates: [
        {
          source: { type: "feed", key: FEED },
          sourceLabel: "RSS/Atom feed",
          suggestedName: "Acme Careers",
          jobCount: 3,
          alreadyFollowing: null,
        },
      ],
    });
  });
});

/** Every board URL a name's slug is tried at, one per supported ATS. */
const boardUrls = (slug: string) => [
  `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
  `https://api.lever.co/v0/postings/${slug}?mode=json`,
  `https://api.eu.lever.co/v0/postings/${slug}?mode=json`,
  `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
  `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100&offset=0`,
  `https://${slug}.recruitee.com/api/offers/`,
  `https://apply.workable.com/api/v1/widget/accounts/${slug}`,
  `https://${slug}.jobs.personio.de/xml`,
];

describe("discovering a Company from its name", () => {
  /** SmartRecruiters answers an unknown company with a valid, empty board. */
  const unknownOnSmartRecruiters = {
    "https://api.smartrecruiters.com/v1/companies/acme/postings?limit=100&offset=0": {
      body: { offset: 0, limit: 100, totalFound: 0, content: [] },
    },
  };

  it("lists every ATS that has a board for the name, with type, suggested name and job count", async () => {
    const { request, requested } = createTestApp({ sources: { ...boards, ...unknownOnSmartRecruiters } });

    const res = await request("POST", "/api/companies/discover", { input: "Acme" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidates: [
        { source: { type: "greenhouse", key: "acme" }, sourceLabel: "Greenhouse", suggestedName: "Acme Robotics", jobCount: 3, alreadyFollowing: null },
        { source: { type: "recruitee", key: "acme" }, sourceLabel: "Recruitee", suggestedName: "Acme Robotics", jobCount: 3, alreadyFollowing: null },
        { source: { type: "workable", key: "acme" }, sourceLabel: "Workable", suggestedName: "Acme Robotics", jobCount: 3, alreadyFollowing: null },
        { source: { type: "personio", key: "acme" }, sourceLabel: "Personio", suggestedName: "Acme Robotics AG", jobCount: 3, alreadyFollowing: null },
      ],
    });
    for (const url of boardUrls("acme")) expect(requested).toContain(url);
    expect(await (await request("GET", "/api/jobs")).json()).toEqual({ jobs: [] });
  });

  it("tries the name as one word and hyphenated, lowercased and without accents", async () => {
    const { request, requested } = createTestApp();

    await request("POST", "/api/companies/discover", { input: "  Café Zürich  " });

    for (const url of [...boardUrls("cafezurich"), ...boardUrls("cafe-zurich")]) expect(requested).toContain(url);
  });

  it("finds no candidate when no ATS knows the name", async () => {
    const { request } = createTestApp({ sources: unknownOnSmartRecruiters });

    const res = await request("POST", "/api/companies/discover", { input: "Acme" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ candidates: [] });
  });

  it("flags a candidate that is already followed", async () => {
    const { request } = createTestApp({ sources: boards });
    await request("POST", "/api/companies", { source: { type: "workable", key: "acme" }, name: "Acme (Workable)" });

    const res = await request("POST", "/api/companies/discover", { input: "acme" });

    const { candidates } = await res.json();
    expect(candidates.find((c: { source: { type: string } }) => c.source.type === "workable").alreadyFollowing).toBe(
      "Acme (Workable)",
    );
    expect(candidates.find((c: { source: { type: string } }) => c.source.type === "greenhouse").alreadyFollowing).toBe(
      null,
    );
  });

  it("doesn't mistake a link it can't open for a name", async () => {
    const { request } = createTestApp();

    const res = await request("POST", "/api/companies/discover", { input: "ftp://files.acme.example/jobs" });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/doesn't look like a link/);
  });
});
