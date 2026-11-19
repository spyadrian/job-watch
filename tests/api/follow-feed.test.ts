import { describe, expect, it } from "vitest";
import { createTestApp } from "../support/test-app.ts";

const ACME_FEED = "https://careers.acme.example/feed/";
const rss = (name: string) => ({ file: `tests/fixtures/sources/feed/${name}.xml`, contentType: "application/rss+xml" });

/** Acme's feed: two Jobs on page 1, one on page 2, then an empty page. */
const acme = {
  [ACME_FEED]: rss("acme-rss"),
  [`${ACME_FEED}?paged=2`]: rss("acme-rss-page2"),
  [`${ACME_FEED}?paged=3`]: rss("empty-rss"),
};

describe("discovering a Company from an RSS or Atom feed link", () => {
  it("accepts a link that returns an RSS feed and reports N jobs found, saving nothing", async () => {
    const { request } = createTestApp({ sources: acme });

    const res = await request("POST", "/api/companies/discover", { input: ACME_FEED });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidates: [
        {
          source: { type: "feed", key: ACME_FEED },
          sourceLabel: "RSS/Atom feed",
          suggestedName: "Acme Careers",
          jobCount: 3,
          alreadyFollowing: null,
        },
      ],
    });
    expect(await (await request("GET", "/api/jobs")).json()).toEqual({ jobs: [] });
  });

  it("accepts a link that returns an Atom feed", async () => {
    const { request } = createTestApp({
      sources: {
        [GLOBEX_FEED]: atom,
        [`${GLOBEX_FEED}?paged=2`]: { status: 404, body: "Not found", contentType: "text/html" },
      },
    });

    const res = await request("POST", "/api/companies/discover", { input: GLOBEX_FEED });

    expect((await res.json()).candidates).toEqual([
      {
        source: { type: "feed", key: GLOBEX_FEED },
        sourceLabel: "RSS/Atom feed",
        suggestedName: "Globex jobs",
        jobCount: 2,
        alreadyFollowing: null,
      },
    ]);
  });

  it.each([
    ["https://careers.initech.example/feed/", "<title></title>"],
    ["https://www.initech.example/jobs.rss", ""],
  ])("suggests the site's name for %s, a feed without a title", async (feedUrl, title) => {
    const { request } = createTestApp({
      sources: {
        [feedUrl]: {
          contentType: "application/rss+xml",
          body: `<?xml version="1.0"?><rss version="2.0"><channel>${title}
            <item><title>Engineer</title><link>https://initech.example/jobs/1</link></item>
          </channel></rss>`,
        },
        [`${feedUrl}?paged=2`]: { status: 404, body: "Not found" },
      },
    });

    const res = await request("POST", "/api/companies/discover", { input: feedUrl });

    expect((await res.json()).candidates).toEqual([expect.objectContaining({ suggestedName: "Initech", jobCount: 1 })]);
  });

  it("keys the feed by its URL without fragment, cache-buster or page number", async () => {
    const { request } = createTestApp({ sources: acme });

    const res = await request("POST", "/api/companies/discover", { input: `${ACME_FEED}?paged=2&_=123#top` });

    expect((await res.json()).candidates.map((c: { source: unknown }) => c.source)).toEqual([
      { type: "feed", key: ACME_FEED },
    ]);
  });

  it("finds no feed behind a link that returns an HTML page", async () => {
    const { request } = createTestApp({
      sources: { "https://acme.example/careers": { body: "<html><body>Jobs</body></html>", contentType: "text/html" } },
    });

    const res = await request("POST", "/api/companies/discover", { input: "https://acme.example/careers" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ candidates: [] });
  });
});

describe("following a feed Company", () => {
  it("stores the RSS items as Jobs, keyed by guid or, without one, by link", async () => {
    const { request } = createTestApp({ sources: acme, now: "2026-01-15T09:00:00Z" });

    const res = await request("POST", "/api/companies", { source: { type: "feed", key: ACME_FEED }, name: "Acme" });

    expect(res.status).toBe(201);
    expect((await res.json()).jobCount).toBe(3);
    const { jobs } = await (await request("GET", "/api/jobs")).json();
    expect(jobs.map(pick)).toEqual([
      {
        title: "Data Engineer",
        url: "https://careers.acme.example/jobs/data-engineer/",
        locations: ["Geneva, Switzerland"],
        publishedAt: "2026-01-12T07:30:00.000Z",
      },
      {
        title: "Support & Success Lead",
        url: "https://careers.acme.example/jobs/support-lead/",
        locations: [],
        publishedAt: null,
      },
      {
        title: "Office Manager",
        url: "https://careers.acme.example/jobs/office-manager/",
        locations: [],
        publishedAt: "2026-01-02T10:00:00.000Z",
      },
    ]);
  });

  it("stores the Atom entries as Jobs, using the alternate link and published (else updated) date", async () => {
    const { request } = createTestApp({ sources: { [GLOBEX_FEED]: atom, [`${GLOBEX_FEED}?paged=2`]: atom } });

    await request("POST", "/api/companies", { source: { type: "feed", key: GLOBEX_FEED }, name: "Globex" });

    const { jobs } = await (await request("GET", "/api/jobs")).json();
    expect(jobs.map(pick)).toEqual([
      {
        title: "Platform Engineer",
        url: "https://globex.example/jobs/7001",
        locations: [],
        publishedAt: "2026-01-13T08:15:00.000Z",
      },
      {
        title: "Recruiter",
        url: "https://globex.example/jobs/7002",
        locations: [],
        publishedAt: "2026-01-11T16:00:00.000Z",
      },
    ]);
  });
});

describe("reading a paginated feed", () => {
  const follow = { source: { type: "feed", key: ACME_FEED }, name: "Acme" };

  it("reads ?paged=N pages until an empty page, each request with a _= cache-buster", async () => {
    const { request, requested } = createTestApp({ sources: acme });

    await request("POST", "/api/companies", follow);

    expect(requested.map(withoutCacheBuster)).toEqual([ACME_FEED, `${ACME_FEED}?paged=2`, `${ACME_FEED}?paged=3`]);
    for (const url of requested) expect(new URL(url).searchParams.get("_")).toMatch(/.+/);
  });

  it("stops at a page that brings no new items (a feed that ignores ?paged)", async () => {
    const { request, requested } = createTestApp({
      sources: { [ACME_FEED]: rss("acme-rss"), [`${ACME_FEED}?paged=2`]: rss("acme-rss") },
    });

    const res = await request("POST", "/api/companies", follow);

    expect((await res.json()).jobCount).toBe(2);
    expect(requested).toHaveLength(2);
  });

  it("reads at most 10 pages", async () => {
    const sources: Record<string, { body: string; contentType: string }> = {};
    for (let page = 1; page <= 12; page++) {
      sources[page === 1 ? ACME_FEED : `${ACME_FEED}?paged=${page}`] = {
        body: `<rss version="2.0"><channel><title>Acme</title><item><title>Role ${page}</title><link>https://careers.acme.example/jobs/${page}</link></item></channel></rss>`,
        contentType: "application/rss+xml",
      };
    }
    const { request, requested } = createTestApp({ sources });

    const res = await request("POST", "/api/companies", follow);

    expect((await res.json()).jobCount).toBe(10);
    expect(requested).toHaveLength(10);
  });

  it("treats a 404 past the first page as the end of the feed", async () => {
    const { request } = createTestApp({
      sources: { [ACME_FEED]: rss("acme-rss"), [`${ACME_FEED}?paged=2`]: { status: 404, body: "Not found" } },
    });

    const res = await request("POST", "/api/companies", follow);

    expect((await res.json()).jobCount).toBe(2);
  });

  it("fails as a whole, saving nothing, when a later page fails", async () => {
    const { request } = createTestApp({
      sources: { [ACME_FEED]: rss("acme-rss"), [`${ACME_FEED}?paged=2`]: { status: 500, body: "boom" } },
    });

    const res = await request("POST", "/api/companies", follow);

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe(`The feed ${ACME_FEED} answered with an error (HTTP 500)`);
    expect(await (await request("GET", "/api/jobs")).json()).toEqual({ jobs: [] });
  });

  it("refuses a feed that stopped being RSS/Atom rather than reporting zero jobs", async () => {
    const { request } = createTestApp({
      sources: { [ACME_FEED]: { body: "<html>maintenance</html>", contentType: "text/html" } },
    });

    const res = await request("POST", "/api/companies", follow);

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe(`The feed ${ACME_FEED} isn't a readable RSS or Atom feed`);
  });
});

describe("a feed with an unreadable item", () => {
  it("is found by discovery but reported as unreadable instead of dropping the item", async () => {
    const { request } = createTestApp({
      sources: {
        [ACME_FEED]: {
          body: `<rss version="2.0"><channel><title>Acme</title><item><title>No link</title></item></channel></rss>`,
          contentType: "application/rss+xml",
        },
      },
    });

    const res = await request("POST", "/api/companies/discover", { input: ACME_FEED });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe(`The feed ${ACME_FEED} isn't a readable RSS or Atom feed`);
  });
});

function withoutCacheBuster(raw: string): string {
  const url = new URL(raw);
  url.searchParams.delete("_");
  return url.href;
}

const GLOBEX_FEED ="https://globex.example/jobs.atom";
const atom = { file: "tests/fixtures/sources/feed/globex-atom.xml", contentType: "application/atom+xml" };

function pick(job: { title: string; url: string; locations: string[]; publishedAt: string | null }) {
  return { title: job.title, url: job.url, locations: job.locations, publishedAt: job.publishedAt };
}
