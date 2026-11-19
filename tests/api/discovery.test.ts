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

  it("finds no candidate on a page with no board and no feed, when no ATS knows the site's name", async () => {
    const { request, requested } = createTestApp({ sources: { [CAREERS]: html("nothing") } });

    const res = await request("POST", "/api/companies/discover", { input: CAREERS });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ candidates: [] });
    expect(requested.filter((url) => url === CAREERS)).toHaveLength(1);
    for (const url of boardUrls("acme")) expect(requested).toContain(url);
  });

  it("says why when the page answers with an error", async () => {
    const { request } = createTestApp({ sources: { [CAREERS]: { status: 403, body: "Forbidden" } } });

    const res = await request("POST", "/api/companies/discover", { input: CAREERS });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidates: [],
      unreachable: `The page ${CAREERS} answered with an error (HTTP 403)`,
    });
  });

  it("says so when the page can't be reached at all", async () => {
    const { request } = createTestApp();

    const res = await request("POST", "/api/companies/discover", { input: CAREERS });

    expect(await res.json()).toEqual({ candidates: [], unreachable: `Couldn't reach the page ${CAREERS}` });
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

  it("tries a name that contains a dot both as a site and as a name", async () => {
    const { request, requested } = createTestApp({
      sources: { [boardUrls("bookingcom")[0]!]: json("greenhouse/acme.json") },
    });

    const res = await request("POST", "/api/companies/discover", { input: "Booking.com" });

    expect(res.status).toBe(200);
    expect((await res.json()).candidates).toEqual([
      expect.objectContaining({ source: { type: "greenhouse", key: "bookingcom" }, jobCount: 3 }),
    ]);
    expect(requested).toContain("https://booking.com/");
  });

  it("doesn't open a dotted name that can't be a site", async () => {
    const { request, requested } = createTestApp();

    await request("POST", "/api/companies/discover", { input: "Acme.x1" });

    expect(requested.filter((url) => url.includes("acme.x1"))).toEqual([]);
    for (const url of boardUrls("acmex1")) expect(requested).toContain(url);
  });

  it("doesn't mistake a link it can't open for a name", async () => {
    const { request } = createTestApp();

    const res = await request("POST", "/api/companies/discover", { input: "ftp://files.acme.example/jobs" });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/doesn't look like a link/);
  });
});

describe("discovery against real-world boards", () => {
  const MISTRAL = "https://mistral.example/careers";

  it("doesn't take an empty Workable account as a match for a name", async () => {
    const { request } = createTestApp({
      sources: { [boardUrls("acme")[6]!]: { body: { name: "Acme", jobs: [] } } },
    });

    const res = await request("POST", "/api/companies/discover", { input: "Acme" });

    expect(await res.json()).toEqual({ candidates: [] });
  });

  it("offers a page's feed only when the page has no ATS board", async () => {
    const page = `<html><head><link rel="alternate" type="application/rss+xml" href="/news/rss"></head>
      <body><script src="https://jobs.ashbyhq.com/lumen/embed"></script></body></html>`;
    const { request, requested } = createTestApp({
      sources: {
        ...boards,
        [MISTRAL]: { body: page, contentType: "text/html" },
        "https://mistral.example/news/rss": { file: "tests/fixtures/sources/feed/acme-rss.xml", contentType: "application/rss+xml" },
        "https://mistral.example/news/rss?paged=2": { file: "tests/fixtures/sources/feed/empty-rss.xml", contentType: "application/rss+xml" },
      },
    });

    const res = await request("POST", "/api/companies/discover", { input: MISTRAL });

    expect((await res.json()).candidates.map((c: { source: unknown }) => c.source)).toEqual([
      { type: "ashby", key: "lumen" },
    ]);
    expect(requested).not.toContain("https://mistral.example/news/rss");
  });

  it("also tries the first word of a name", async () => {
    const { request } = createTestApp({ sources: { [boardUrls("northwind")[1]!]: json("lever/northwind.json") } });

    const res = await request("POST", "/api/companies/discover", { input: "Northwind Institute" });

    expect((await res.json()).candidates).toEqual([
      expect.objectContaining({ source: { type: "lever", key: "northwind" }, jobCount: 3 }),
    ]);
  });

  it("tries a dotted name as it is written", async () => {
    const { request, requested } = createTestApp();

    await request("POST", "/api/companies/discover", { input: "Lumen.ai" });

    expect(requested).toContain("https://api.ashbyhq.com/posting-api/job-board/lumen.ai");
  });

  it("suggests a Greenhouse board's own name, even when it has no Jobs", async () => {
    const { request } = createTestApp({
      sources: {
        "https://boards-api.greenhouse.io/v1/boards/idq/jobs": { body: { jobs: [], meta: { total: 0 } } },
        "https://boards-api.greenhouse.io/v1/boards/idq": { body: { name: "ID Quantique", content: "" } },
      },
    });

    const res = await request("POST", "/api/companies/discover", { input: "https://job-boards.greenhouse.io/idq" });

    expect((await res.json()).candidates).toEqual([
      expect.objectContaining({ suggestedName: "ID Quantique", jobCount: 0 }),
    ]);
  });

  it("tries the site's name when its careers page has no ATS board, instead of its news feed", async () => {
    const page = `<html><head><link rel="alternate" type="application/rss+xml" href="/feed/"></head><body>Join us</body></html>`;
    const { request, requested } = createTestApp({
      sources: {
        "https://www.acme.example/careers": { body: page, contentType: "text/html" },
        "https://www.acme.example/feed/": { file: "tests/fixtures/sources/feed/acme-rss.xml", contentType: "application/rss+xml" },
        "https://www.acme.example/feed/?paged=2": { file: "tests/fixtures/sources/feed/empty-rss.xml", contentType: "application/rss+xml" },
        [boardUrls("acme")[0]!]: json("greenhouse/acme.json"),
      },
    });

    const res = await request("POST", "/api/companies/discover", { input: "https://www.acme.example/careers" });

    expect((await res.json()).candidates.map((c: { source: unknown }) => c.source)).toEqual([
      { type: "greenhouse", key: "acme" },
    ]);
    expect(requested).not.toContain("https://www.acme.example/feed/");
  });

  it("keeps a page's feed when neither the page nor the site's name leads to a board", async () => {
    const page = `<html><head><link rel="alternate" type="application/rss+xml" href="/jobs.rss"></head><body></body></html>`;
    const { request } = createTestApp({
      sources: {
        "https://careers.globex.example/": { body: page, contentType: "text/html" },
        "https://careers.globex.example/jobs.rss": { file: "tests/fixtures/sources/feed/acme-rss.xml", contentType: "application/rss+xml" },
        "https://careers.globex.example/jobs.rss?paged=2": { file: "tests/fixtures/sources/feed/empty-rss.xml", contentType: "application/rss+xml" },
      },
    });

    const res = await request("POST", "/api/companies/discover", { input: "https://careers.globex.example/" });

    expect((await res.json()).candidates.map((c: { source: unknown }) => c.source)).toEqual([
      { type: "feed", key: "https://careers.globex.example/jobs.rss" },
    ]);
  });
});
