import { describe, expect, it } from "vitest";
import type { RecordedSources } from "../../src/server/recorded-fetch.ts";
import { createTestApp } from "../support/test-app.ts";

const UBP = "iaadtu.fa.ocs.oraclecloud.eu";
const ELCA = "iaaras.fa.ocs.oraclecloud.com";
const ORACLE = "eeho.fa.us2.oraclecloud.com";

const json = (name: string) => ({ file: `tests/fixtures/sources/oracle-hcm/${name}.json`, contentType: "application/json" });
const siteUrl = (host: string, site: string) =>
  `https://${host}/hcmRestApi/resources/latest/recruitingCESites?onlyData=true&finder=SiteByNumberFinder;SiteNumber=${site}`;
const page = (host: string, site: string, offset: number) =>
  `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${site},limit=200,offset=${offset},sortBy=POSTING_DATES_DESC`;

const recorded: RecordedSources = {
  [siteUrl(UBP, "CX_1")]: json("ubp-site"),
  [page(UBP, "CX_1", 0)]: json("ubp-requisitions"),
  [siteUrl(ELCA, "CX_1")]: json("elca-site"),
  [page(ELCA, "CX_1", 0)]: json("elca-requisitions"),
  [siteUrl(ORACLE, "CX_45001")]: json("oracle-site"),
  [page(ORACLE, "CX_45001", 0)]: json("oracle-requisitions"),
};

const BIG = "bigco.fa.em2.oraclecloud.com";
const bigSite = { [siteUrl(BIG, "CX_7")]: { body: { items: [{ SiteNumber: "CX_7", SiteName: "BigCo Careers" }], count: 1 } } };

/** A recorded page of `count` minimal requisitions starting at `offset`, as the API answers. */
function requisitionsPage(offset: number, count: number, total: number) {
  return {
    body: {
      items: [
        {
          Offset: offset,
          Limit: 200,
          TotalJobsCount: total,
          SiteNumber: "CX_7",
          requisitionList: Array.from({ length: count }, (_, i) => ({
            Id: String(100000 + offset + i),
            Title: `Role ${offset + i + 1}`,
            PostedDate: "2026-01-05",
            PrimaryLocation: "Bern, Switzerland",
            secondaryLocations: [],
          })),
        },
      ],
      count: 1,
      hasMore: false,
    },
  };
}

/** A site whose API serves pages of `size` Jobs: `delivered` of `total` Jobs, from offset 0. */
function smallPages(total: number, size: number, delivered = total) {
  const sources: RecordedSources = { ...bigSite };
  for (let offset = 0; offset < total; offset += size) {
    sources[page(BIG, "CX_7", offset)] = requisitionsPage(offset, Math.max(0, Math.min(size, delivered - offset)), total);
  }
  return sources;
}

async function discover(sources: RecordedSources, input: string) {
  const { request, requested } = createTestApp({ sources });
  const res = await request("POST", "/api/companies/discover", { input });
  return { res, body: await res.json(), requested };
}

describe("discovering an Oracle Cloud HCM site from a link", () => {
  it("reads the site and reports N jobs found with the site's name, saving nothing", async () => {
    const { request } = createTestApp({ sources: recorded });

    const res = await request("POST", "/api/companies/discover", {
      input: `https://${UBP}/hcmUI/CandidateExperience/en/sites/CX_1/jobs?mode=location`,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidates: [
        {
          source: { type: "oracle-hcm", key: `${UBP}/CX_1` },
          sourceLabel: "Oracle Cloud HCM",
          suggestedName: "UBP",
          jobCount: 2,
          alreadyFollowing: null,
        },
      ],
    });
    expect(await (await request("GET", "/api/jobs")).json()).toEqual({ jobs: [] });
  });

  it.each([
    `https://${ELCA}/hcmUI/CandidateExperience/en/sites/CX_1/requisitions`,
    `https://${ELCA}/hcmUI/CandidateExperience/en/sites/CX_1/jobs`,
    `https://${ELCA}/hcmUI/CandidateExperience/fr/sites/CX_1/job/2793`,
    `https://${ELCA}/hcmUI/CandidateExperience/en/sites/CX_1/job/2793/?utm_medium=jobshare`,
    `https://${ELCA}:443/hcmUI/CandidateExperience/en/sites/CX_1/requisitions?keyword=java`,
    `https://${ELCA.toUpperCase()}/hcmUI/CandidateExperience/en/sites/CX_1`,
    `https://${ELCA}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&finder=findReqs;siteNumber=CX_1,limit=25`,
    `https://${ELCA}/hcmRestApi/CandidateExperience/siteFavicon/favicon-16x16.png?siteNumber=CX_1&size=16x16`,
    `${ELCA}/hcmUI/CandidateExperience/en/sites/CX_1/requisitions`,
  ])("recognises %s as the ELCA site", async (input) => {
    const { body } = await discover(recorded, input);

    expect(body.candidates.map((c: { source: unknown; suggestedName: string; jobCount: number }) => [c.source, c.suggestedName, c.jobCount])).toEqual([
      [{ type: "oracle-hcm", key: `${ELCA}/CX_1` }, "ELCA Switzerland and Europe", 3],
    ]);
  });

  it.each([
    "https://iaaras.fa.ocs.oraclecloud.example/hcmUI/CandidateExperience/en/sites/CX_1/requisitions",
    "https://evil-oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions",
  ])("doesn't take %s for an Oracle Cloud HCM site", async (input) => {
    const { requested } = await discover(recorded, input);

    expect(requested.some((url) => url.includes("/hcmRestApi/"))).toBe(false);
  });

  it("finds the site behind a careers page on the Company's own domain (careers.oracle.com)", async () => {
    const careers = "https://careers.oracle.com/en/sites/jobsearch";
    const { res, body } = await discover(
      { ...recorded, [careers]: { file: "tests/fixtures/sources/careers/oracle-hcm.html", contentType: "text/html; charset=utf-8" } },
      careers,
    );

    expect(res.status).toBe(200);
    expect(body).toEqual({
      candidates: [
        {
          source: { type: "oracle-hcm", key: `${ORACLE}/CX_45001` },
          sourceLabel: "Oracle Cloud HCM",
          suggestedName: "Oracle",
          jobCount: 2,
          alreadyFollowing: null,
        },
      ],
    });
  });

  it("finds the site number behind a site link that uses the site's name instead", async () => {
    const link = `https://${ORACLE}/hcmUI/CandidateExperience/en/sites/jobsearch/requisitions`;
    const { body } = await discover(
      { ...recorded, [link]: { file: "tests/fixtures/sources/careers/oracle-hcm.html", contentType: "text/html; charset=utf-8" } },
      link,
    );

    expect(body.candidates.map((c: { source: unknown }) => c.source)).toEqual([{ type: "oracle-hcm", key: `${ORACLE}/CX_45001` }]);
  });

  it("reads every page until the last one", async () => {
    const { res, body } = await discover(
      {
        ...bigSite,
        [page(BIG, "CX_7", 0)]: requisitionsPage(0, 200, 450),
        [page(BIG, "CX_7", 200)]: requisitionsPage(200, 200, 450),
        [page(BIG, "CX_7", 400)]: requisitionsPage(400, 50, 450),
      },
      `https://${BIG}/hcmUI/CandidateExperience/en/sites/CX_7/requisitions`,
    );

    expect(res.status).toBe(200);
    expect(body.candidates[0].jobCount).toBe(450);
    expect(body.candidates[0].suggestedName).toBe("BigCo Careers");
  });

  it("reads the pages after the first a few at a time, not one after another", async () => {
    const sources: RecordedSources = { ...bigSite };
    for (let n = 0; n < 10; n++) sources[page(BIG, "CX_7", n * 200)] = requisitionsPage(n * 200, n === 9 ? 47 : 200, 1847);
    let inFlight = 0;
    let mostInFlight = 0;
    const { request } = createTestApp({
      sources,
      wrapFetch: (recorded) => async (input, init) => {
        mostInFlight = Math.max(mostInFlight, ++inFlight);
        try {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return await recorded(input, init);
        } finally {
          inFlight--;
        }
      },
    });

    const res = await request("POST", "/api/companies/discover", { input: `https://${BIG}/hcmUI/CandidateExperience/en/sites/CX_7/requisitions` });

    expect((await res.json()).candidates[0].jobCount).toBe(1847);
    expect(mostInFlight).toBeGreaterThan(1);
    expect(mostInFlight).toBeLessThanOrEqual(4);
  });

  it("keeps the API's order and counts a Job repeated on the next page once", async () => {
    const first = requisitionsPage(0, 200, 400);
    const second = requisitionsPage(200, 200, 400);
    // A posting-date tie moved the last Job of page 1 onto page 2 as well.
    second.body.items[0]!.requisitionList[0] = { ...first.body.items[0]!.requisitionList[199]! };
    const { request } = createTestApp({ sources: { ...bigSite, [page(BIG, "CX_7", 0)]: first, [page(BIG, "CX_7", 200)]: second } });

    const res = await request("POST", "/api/companies", { source: { type: "oracle-hcm", key: `${BIG}/CX_7` }, name: "BigCo" });

    expect(res.status).toBe(201);
    const { jobs } = await (await request("GET", "/api/jobs")).json();
    expect(jobs).toHaveLength(399);
  });

  it("follows the API's own page size when it answers fewer Jobs than asked", async () => {
    const short = (offset: number, count: number) => requisitionsPage(offset, count, 60);
    const { body } = await discover(
      {
        ...bigSite,
        [page(BIG, "CX_7", 0)]: short(0, 25),
        [page(BIG, "CX_7", 25)]: short(25, 25),
        [page(BIG, "CX_7", 50)]: short(50, 10),
      },
      `https://${BIG}/hcmUI/CandidateExperience/en/sites/CX_7/requisitions`,
    );

    expect(body.candidates[0].jobCount).toBe(60);
  });

  it("reads at most 25 pages of 200", async () => {
    const sources: RecordedSources = { ...bigSite };
    for (let n = 0; n < 27; n++) sources[page(BIG, "CX_7", n * 200)] = requisitionsPage(n * 200, 200, 5400);

    const { res, body } = await discover(sources, `https://${BIG}/hcmUI/CandidateExperience/en/sites/CX_7/requisitions`);

    expect(res.status).toBe(200);
    expect(body.candidates[0].jobCount).toBe(5000);
    expect(body.candidates[0].capped).toEqual({ read: 5000, total: 5400 });
  });

  it("fails as a whole when a later page fails, never returning a partial list", async () => {
    const { res, body } = await discover(
      {
        ...bigSite,
        [page(BIG, "CX_7", 0)]: requisitionsPage(0, 200, 300),
        [page(BIG, "CX_7", 200)]: { status: 503, body: "busy" },
      },
      `https://${BIG}/hcmUI/CandidateExperience/en/sites/CX_7/requisitions`,
    );

    expect(res.status).toBe(502);
    expect(body.error).toBe(`The Oracle Cloud HCM site "${BIG}/CX_7" answered with an error (HTTP 503)`);
  });

  it("fails as a whole when a middle page fails, even if the pages after it are read", async () => {
    const { res, body } = await discover(
      {
        ...bigSite,
        [page(BIG, "CX_7", 0)]: requisitionsPage(0, 200, 700),
        [page(BIG, "CX_7", 200)]: requisitionsPage(200, 200, 700),
        [page(BIG, "CX_7", 400)]: { status: 500, body: "oops" },
        [page(BIG, "CX_7", 600)]: requisitionsPage(600, 100, 700),
      },
      `https://${BIG}/hcmUI/CandidateExperience/en/sites/CX_7/requisitions`,
    );

    expect(res.status).toBe(502);
    expect(body.error).toBe(`The Oracle Cloud HCM site "${BIG}/CX_7" answered with an error (HTTP 500)`);
  });

  // empty-requisitions.json is the API's real answer to a search that matches no Job.
  it.each([
    ["no requisitions (as recorded)", json("empty-requisitions")],
    ["no search result at all", { body: { items: [], count: 0, hasMore: false } }],
    ["a search result without a requisition list", { body: { items: [{ TotalJobsCount: 0, SiteNumber: "CX_7" }], count: 1 } }],
  ])("reads a site with %s as 0 Jobs, still giving the site's name", async (_, answer) => {
    const { res, body } = await discover(
      { ...bigSite, [page(BIG, "CX_7", 0)]: answer },
      `https://${BIG}/hcmUI/CandidateExperience/en/sites/CX_7/requisitions`,
    );

    expect(res.status).toBe(200);
    expect(body.candidates).toEqual([
      {
        source: { type: "oracle-hcm", key: `${BIG}/CX_7` },
        sourceLabel: "Oracle Cloud HCM",
        suggestedName: "BigCo Careers",
        jobCount: 0,
        alreadyFollowing: null,
      },
    ]);
  });

  it.each([
    ["not JSON", { body: "<html>maintenance</html>" }],
    ["no items", { body: { count: 0 } }],
    ["items that aren't a list", { body: { items: {} } }],
    ["a requisition list that isn't a list", { body: { items: [{ TotalJobsCount: 1, requisitionList: "none" }] } }],
    ["Jobs without a total count", { body: { items: [{ requisitionList: requisitionsPage(0, 1, 1).body.items[0]!.requisitionList }] } }],
    ["a total count that isn't a number", { body: { items: [{ TotalJobsCount: "0", requisitionList: [] }] } }],
  ])("refuses an answer with %s rather than reporting zero jobs", async (_, answer) => {
    const { res, body } = await discover(
      { ...bigSite, [page(BIG, "CX_7", 0)]: answer },
      `https://${BIG}/hcmUI/CandidateExperience/en/sites/CX_7/requisitions`,
    );

    expect(res.status).toBe(502);
    expect(body.error).toMatch(/unexpected format|valid JSON/);
  });

  it("reports a site number the instance doesn't have, instead of reading its default site", async () => {
    const { res, body, requested } = await discover(
      { [siteUrl(BIG, "CX_9")]: { body: { items: [], count: 0, hasMore: false } } },
      `https://${BIG}/hcmUI/CandidateExperience/en/sites/CX_9/requisitions`,
    );

    expect(res.status).toBe(502);
    expect(body.error).toBe(`The Oracle Cloud HCM site "${BIG}/CX_9" doesn't exist`);
    expect(requested.some((url) => url.includes("recruitingCEJobRequisitions"))).toBe(false);
  });

  it("isn't tried for a Company name, since its host can't be guessed", async () => {
    const { requested } = await discover({}, "Acme");

    expect(requested.some((url) => url.includes("oraclecloud"))).toBe(false);
  });
});

describe("an Oracle Cloud HCM site with more Jobs than one read takes", () => {
  const link = `https://${BIG}/hcmUI/CandidateExperience/en/sites/CX_7/requisitions`;

  it("says it stopped at 25 pages and how many Jobs the site has", async () => {
    const { body, requested } = await discover(smallPages(60, 2), link);

    expect(body.candidates[0]).toMatchObject({ jobCount: 50, capped: { read: 50, total: 60 } });
    expect(requested.some((url) => url.includes("offset=50,"))).toBe(false);
  });

  it.each([
    ["has exactly as many Jobs as 25 pages hold", smallPages(50, 2)],
    ["delivers a couple fewer Jobs than it reports (as Oracle's own site: 2847 vs 2845)", smallPages(47, 2, 45)],
    ["delivers fewer Jobs than it reports on its last allowed page", smallPages(50, 2, 49)],
  ])("says nothing more when the site %s", async (_, sources) => {
    const { body } = await discover(sources, link);

    expect(body.candidates[0]).not.toHaveProperty("capped");
  });

  it("says so on the Company after each read", async () => {
    const { request, sources } = createTestApp({ sources: smallPages(60, 2) });
    const companies = async () => (await (await request("GET", "/api/companies")).json()).companies;

    const res = await request("POST", "/api/companies", { source: { type: "oracle-hcm", key: `${BIG}/CX_7` }, name: "BigCo" });
    expect((await res.json()).company.capped).toEqual({ read: 50, total: 60 });
    expect((await companies())[0].capped).toEqual({ read: 50, total: 60 });

    Object.assign(sources, smallPages(40, 2));
    await (await request("POST", "/api/refresh")).text();
    expect((await companies())[0]).not.toHaveProperty("capped");
  });
});

describe("following an Oracle Cloud HCM site", () => {
  it("stores its Jobs with their public page, primary and secondary locations and posting date", async () => {
    const { request } = createTestApp({ sources: recorded });

    const res = await request("POST", "/api/companies", {
      source: { type: "oracle-hcm", key: `${ELCA}/CX_1` },
      name: "ELCA",
    });

    expect(res.status).toBe(201);
    const { jobs } = await (await request("GET", "/api/jobs")).json();
    expect(
      jobs
        .map((j: Record<string, unknown>) => ({ title: j.title, url: j.url, locations: j.locations, publishedAt: j.publishedAt }))
        .sort((a: { url: string }, b: { url: string }) => a.url.localeCompare(b.url)),
    ).toEqual([
      {
        title: "Junior Java Engineer",
        url: `https://${ELCA}/hcmUI/CandidateExperience/en/sites/CX_1/job/2793`,
        locations: ["Zurich, Switzerland", "Bern, Switzerland"],
        publishedAt: "2026-11-18T00:00:00.000Z",
      },
      {
        title: "Data Engineer",
        url: `https://${ELCA}/hcmUI/CandidateExperience/en/sites/CX_1/job/2943`,
        locations: ["Palermo, Italy"],
        publishedAt: "2026-10-21T00:00:00.000Z",
      },
      {
        title: "Consultant, ELCA Advisory",
        url: `https://${ELCA}/hcmUI/CandidateExperience/en/sites/CX_1/job/2969`,
        locations: ["Pully, Switzerland", "Geneva, Switzerland"],
        publishedAt: "2026-11-04T00:00:00.000Z",
      },
    ]);
  });

  it("marks its Jobs Outdated when the site no longer has any open Job", async () => {
    const { request, sources } = createTestApp({ sources: recorded });
    await request("POST", "/api/companies", { source: { type: "oracle-hcm", key: `${ELCA}/CX_1` }, name: "ELCA" });

    sources[page(ELCA, "CX_1", 0)] = json("empty-requisitions");
    const refresh = await (await request("POST", "/api/refresh")).text();

    expect(refresh).toContain(`"summary":{"new":0,"outdated":3,"failed":0}`);
  });
});
