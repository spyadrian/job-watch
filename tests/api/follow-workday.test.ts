import { describe, expect, it } from "vitest";
import { createTestApp } from "../support/test-app.ts";

const ZUEHLKE = "https://zuehlke.wd3.myworkdayjobs.com/wday/cxs/zuehlke/Zuhlke-Careers/jobs";
const BIGCO = "https://bigco.wd5.myworkdayjobs.com/wday/cxs/bigco/BigCo_Careers/jobs";
/** The recorded-fetch key of one page of a Workday site's Jobs search. */
const page = (api: string, offset: number) =>
  `POST ${api} ${JSON.stringify({ limit: 20, offset, searchText: "", appliedFacets: {} })}`;
const recorded = {
  [page(ZUEHLKE, 0)]: { file: "tests/fixtures/sources/workday/zuehlke.json", contentType: "application/json" },
};

/**
 * A recorded page of `count` minimal Job postings starting at `offset`, as Workday
 * answers: `total` is only right on the first page, later pages say 0.
 */
function postingsPage(offset: number, count: number, total: number) {
  return {
    body: {
      total: offset === 0 ? total : 0,
      jobPostings: Array.from({ length: count }, (_, i) => ({
        title: `Role ${offset + i + 1}`,
        externalPath: `/job/Bern/Role-${offset + i + 1}_R${1000 + offset + i}`,
        locationsText: "Bern",
        postedOn: "Posted 30+ Days Ago",
        bulletFields: [`R${1000 + offset + i}`],
      })),
    },
  };
}

describe("discovering a Workday site from a link", () => {
  it("reads the site's Jobs and reports N jobs found, saving nothing", async () => {
    const { request } = createTestApp({ sources: recorded });

    const res = await request("POST", "/api/companies/discover", {
      input: "https://zuehlke.wd3.myworkdayjobs.com/Zuhlke-Careers",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidates: [
        {
          source: { type: "workday", key: "zuehlke.wd3/Zuhlke-Careers" },
          sourceLabel: "Workday",
          suggestedName: "Zuehlke",
          jobCount: 3,
          alreadyFollowing: null,
        },
      ],
    });
    expect(await (await request("GET", "/api/jobs")).json()).toEqual({ jobs: [] });
  });

  it.each([
    "https://zuehlke.wd3.myworkdayjobs.com/Zuhlke-Careers/",
    "https://zuehlke.wd3.myworkdayjobs.com/en-US/Zuhlke-Careers",
    "https://zuehlke.wd3.myworkdayjobs.com/de-CH/Zuhlke-Careers?locations=abc",
    "https://Zuehlke.WD3.myworkdayjobs.com/Zuhlke-Careers",
    "https://zuehlke.wd3.myworkdayjobs.com/Zuhlke-Careers/job/Belgrade/AI-Tooling---Governance-Lead_JR100971",
    "https://zuehlke.wd3.myworkdayjobs.com/en-US/Zuhlke-Careers/job/Belgrade/AI-Tooling---Governance-Lead_JR100971/apply",
    "https://zuehlke.wd3.myworkdayjobs.com/wday/cxs/zuehlke/Zuhlke-Careers/jobs",
    "zuehlke.wd3.myworkdayjobs.com/Zuhlke-Careers",
  ])("recognises %s as the Workday site zuehlke.wd3/Zuhlke-Careers", async (input) => {
    const { request } = createTestApp({ sources: recorded });

    const res = await request("POST", "/api/companies/discover", { input });

    const body = await res.json();
    expect(body.candidates.map((c: { source: unknown }) => c.source)).toEqual([
      { type: "workday", key: "zuehlke.wd3/Zuhlke-Careers" },
    ]);
  });

  it.each([
    ["https://temenos.wd103.myworkdayjobs.com/en-US/Temenoscareers", "temenos.wd103/Temenoscareers"],
    ["https://logitech.wd5.myworkdayjobs.com/Logitech", "logitech.wd5/Logitech"],
    ["https://lombardodier.wd3.myworkdayjobs.com/Lombard_Odier_Careers", "lombardodier.wd3/Lombard_Odier_Careers"],
  ])("recognises %s as the Workday site %s", async (input, key) => {
    const [tenant, site] = key.split("/") as [string, string];
    const api = `https://${tenant}.myworkdayjobs.com/wday/cxs/${tenant.split(".")[0]}/${site}/jobs`;
    const { request } = createTestApp({ sources: { [page(api, 0)]: postingsPage(0, 2, 2) } });

    const res = await request("POST", "/api/companies/discover", { input });

    expect(res.status).toBe(200);
    expect((await res.json()).candidates).toMatchObject([{ source: { type: "workday", key }, jobCount: 2 }]);
  });

  it.each([
    "https://zuehlke.wd3.myworkdayjobs.com/",
    "https://zuehlke.wd3.myworkdayjobs.com/en-US",
    "https://www.myworkdayjobs.com/Zuhlke-Careers",
  ])("doesn't take %s for a Workday site", async (input) => {
    const { request } = createTestApp({ sources: { ...recorded, [input]: { status: 404, body: "" } } });

    const res = await request("POST", "/api/companies/discover", { input });

    const body = await res.json();
    expect(body.candidates ?? []).not.toContainEqual(expect.objectContaining({ sourceLabel: "Workday" }));
  });

  it("reads every page of 20 until the total the first page announced", async () => {
    const { request } = createTestApp({
      sources: {
        [page(BIGCO, 0)]: postingsPage(0, 20, 43),
        [page(BIGCO, 20)]: postingsPage(20, 20, 43),
        [page(BIGCO, 40)]: postingsPage(40, 3, 43),
      },
    });

    const res = await request("POST", "/api/companies/discover", {
      input: "https://bigco.wd5.myworkdayjobs.com/BigCo_Careers",
    });

    expect(res.status).toBe(200);
    expect((await res.json()).candidates[0].jobCount).toBe(43);
  });

  it("stops after a full last page without asking for an empty one", async () => {
    const { request } = createTestApp({
      sources: { [page(BIGCO, 0)]: postingsPage(0, 20, 40), [page(BIGCO, 20)]: postingsPage(20, 20, 40) },
    });

    const res = await request("POST", "/api/companies/discover", {
      input: "https://bigco.wd5.myworkdayjobs.com/BigCo_Careers",
    });

    expect(res.status).toBe(200);
    expect((await res.json()).candidates[0].jobCount).toBe(40);
  });

  it("reads at most 50 pages of 20", async () => {
    const sources = Object.fromEntries(
      Array.from({ length: 52 }, (_, n) => [page(BIGCO, n * 20), postingsPage(n * 20, 20, 1040)]),
    );
    const { request } = createTestApp({ sources });

    const res = await request("POST", "/api/companies/discover", {
      input: "https://bigco.wd5.myworkdayjobs.com/BigCo_Careers",
    });

    expect(res.status).toBe(200);
    expect((await res.json()).candidates[0].jobCount).toBe(1000);
  });

  it("fails as a whole when a later page fails, never returning a partial list", async () => {
    const { request } = createTestApp({
      sources: { [page(BIGCO, 0)]: postingsPage(0, 20, 30), [page(BIGCO, 20)]: { status: 503, body: "busy" } },
    });

    const res = await request("POST", "/api/companies/discover", {
      input: "https://bigco.wd5.myworkdayjobs.com/BigCo_Careers",
    });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe(
      'The Workday site "bigco.wd5/BigCo_Careers" answered with an error (HTTP 503)',
    );
  });

  it("says the site doesn't exist when Workday doesn't know it", async () => {
    const { request } = createTestApp({
      sources: { [page(BIGCO, 0)]: { status: 404, body: { errorCode: "S21", httpStatus: 404 } } },
    });

    const res = await request("POST", "/api/companies/discover", {
      input: "https://bigco.wd5.myworkdayjobs.com/BigCo_Careers",
    });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('The Workday site "bigco.wd5/BigCo_Careers" doesn\'t exist (HTTP 404)');
  });

  it("refuses an answer in an unexpected format rather than reporting zero jobs", async () => {
    const { request } = createTestApp({ sources: { [page(BIGCO, 0)]: { body: { message: "nope" } } } });

    const res = await request("POST", "/api/companies/discover", {
      input: "https://bigco.wd5.myworkdayjobs.com/BigCo_Careers",
    });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/unexpected format/);
  });

  it("isn't tried for a Company name, since a name doesn't tell the Workday host and site", async () => {
    const { request, requested } = createTestApp();

    await request("POST", "/api/companies/discover", { input: "Zuehlke" });

    expect(requested.filter((url) => url.includes("myworkdayjobs.com"))).toEqual([]);
  });
});

describe("following a Workday site", () => {
  it("stores its Jobs with their public page and locations as published, without a guessed date", async () => {
    const { request } = createTestApp({ sources: recorded });

    const res = await request("POST", "/api/companies", {
      source: { type: "workday", key: "zuehlke.wd3/Zuhlke-Careers" },
      name: "Zühlke",
    });

    expect(res.status).toBe(201);
    const { jobs } = await (await request("GET", "/api/jobs")).json();
    expect(
      jobs.map((j: Record<string, unknown>) => ({
        title: j.title,
        url: j.url,
        locations: j.locations,
        publishedAt: j.publishedAt,
      })),
    ).toEqual([
      {
        title: "Junior AI Tooling & Governance Specialist",
        url: "https://zuehlke.wd3.myworkdayjobs.com/Zuhlke-Careers/job/Belgrade/AI-Tooling---Governance-Lead_JR100971",
        locations: ["Belgrade"],
        publishedAt: null,
      },
      {
        title: "Advanced Payable Accountant Specialist",
        url: "https://zuehlke.wd3.myworkdayjobs.com/Zuhlke-Careers/job/Belgrade/Advanced-Payable-Accountant-Specialist_JR101015-1",
        locations: ["Belgrade"],
        publishedAt: null,
      },
      {
        title: "Senior/Lead Enterprise Architecture Consultant",
        url: "https://zuehlke.wd3.myworkdayjobs.com/Zuhlke-Careers/job/Schlieren/Lead-Enterprise-Architecture-Consultant_JR100999",
        locations: ["2 Locations"],
        publishedAt: null,
      },
    ]);
  });

  it("keeps two postings of the same requisition as two Jobs", async () => {
    const posting = (path: string) => ({
      title: "Engineer",
      externalPath: path,
      locationsText: "Bern",
      postedOn: "Posted Today",
      bulletFields: ["R1"],
    });
    const { request } = createTestApp({
      sources: {
        [page(BIGCO, 0)]: {
          body: { total: 2, jobPostings: [posting("/job/Bern/Engineer_R1"), posting("/job/Zurich/Engineer_R1-1")] },
        },
      },
    });

    const res = await request("POST", "/api/companies", {
      source: { type: "workday", key: "bigco.wd5/BigCo_Careers" },
      name: "BigCo",
    });

    expect(res.status).toBe(201);
    const { jobs } = await (await request("GET", "/api/jobs")).json();
    expect(jobs.map((j: { url: string }) => j.url).sort()).toEqual([
      "https://bigco.wd5.myworkdayjobs.com/BigCo_Careers/job/Bern/Engineer_R1",
      "https://bigco.wd5.myworkdayjobs.com/BigCo_Careers/job/Zurich/Engineer_R1-1",
    ]);
  });
});
