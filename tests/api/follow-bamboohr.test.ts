import { describe, expect, it } from "vitest";
import type { RecordedSources } from "../../src/server/recorded-fetch.ts";
import { createTestApp } from "../support/test-app.ts";

const LIST = "https://giottoai.bamboohr.com/careers/list";
const INFO = "https://giottoai.bamboohr.com/careers/company-info";
const json = (name: string) => ({ file: `tests/fixtures/sources/bamboohr/${name}.json`, contentType: "application/json" });
const giotto: RecordedSources = { [LIST]: json("giottoai-list"), [INFO]: json("giottoai-company-info") };

/** What BambooHR serves for a subdomain it doesn't know: a redirect to its own home page. */
const BAMBOOHR_HOME = { body: "<!DOCTYPE html><html><head><title>BambooHR</title></head><body></body></html>", contentType: "text/html" };

const sourcesOf = (body: { candidates: { source: unknown }[] }) => body.candidates.map((c) => c.source);

describe("discovering a BambooHR Company from a link", () => {
  it("reads the public careers list and reports N jobs found with the company's name", async () => {
    const { request } = createTestApp({ sources: giotto });

    const res = await request("POST", "/api/companies/discover", { input: "https://giottoai.bamboohr.com/careers" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidates: [
        {
          source: { type: "bamboohr", key: "giottoai" },
          sourceLabel: "BambooHR",
          suggestedName: "Giotto.ai",
          jobCount: 3,
          alreadyFollowing: null,
        },
      ],
    });
  });

  it.each([
    "https://giottoai.bamboohr.com/careers/36",
    "https://giottoai.bamboohr.com/careers/",
    "https://giottoai.bamboohr.com/jobs/",
    "https://giottoai.bamboohr.com/jobs/view.php?id=36",
    "https://giottoai.bamboohr.com/jobs/embed2.php?version=1.0.0&format=json",
    "https://giottoai.bamboohr.com/js/embed.js",
    "giottoai.bamboohr.com",
    "https://GiottoAI.bamboohr.com/careers",
  ])("recognises %s as the BambooHR site giottoai", async (input) => {
    const { request } = createTestApp({ sources: giotto });

    const res = await request("POST", "/api/companies/discover", { input });

    expect(sourcesOf(await res.json())).toEqual([{ type: "bamboohr", key: "giottoai" }]);
  });

  it.each([
    ["the jobs widget", `<iframe src="https://giottoai.bamboohr.com/jobs/embed2.php?version=1.0.0&amp;format=json"></iframe>`],
    ["the embed script", `<div id="BambooHR" data-domain="giottoai.bamboohr.com"></div>\n<script src="https://giottoai.bamboohr.com/js/embed.js" async></script>`],
  ])("finds a BambooHR site a careers page embeds with %s", async (_, embed) => {
    const page = "https://www.giotto.example/careers";
    const { request } = createTestApp({
      sources: { ...giotto, [page]: { body: `<html><body><h1>Careers</h1>${embed}</body></html>`, contentType: "text/html" } },
    });

    const res = await request("POST", "/api/companies/discover", { input: page });

    expect(sourcesOf(await res.json())).toEqual([{ type: "bamboohr", key: "giottoai" }]);
  });

  it.each(["https://www.bamboohr.com/", "https://bamboohr.com/careers", "https://api.bamboohr.com/api/gateway.php/acme/v1/employees"])(
    "doesn't take BambooHR's own site %s for a Company's",
    async (input) => {
      const { request } = createTestApp({ sources: giotto });

      const res = await request("POST", "/api/companies/discover", { input });

      expect(sourcesOf(await res.json())).toEqual([]);
    },
  );

  it("explains when the site doesn't exist (BambooHR redirects unknown subdomains to its home page)", async () => {
    const { request, sources } = createTestApp();
    sources["https://nope.bamboohr.com/careers/list"] = BAMBOOHR_HOME;

    const res = await request("POST", "/api/companies/discover", { input: "https://nope.bamboohr.com/careers" });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('The BambooHR site "nope" doesn\'t exist');
  });

  it("refuses an answer in an unexpected format rather than reporting zero jobs", async () => {
    const { request, sources } = createTestApp();
    sources[LIST] = { body: { message: "maintenance" } };

    const res = await request("POST", "/api/companies/discover", { input: "https://giottoai.bamboohr.com/careers" });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('The BambooHR site "giottoai" answered in an unexpected format');
  });

  it("names the Company after its subdomain when BambooHR doesn't state its name", async () => {
    const { request } = createTestApp({ sources: { [LIST]: json("giottoai-list") } });

    const res = await request("POST", "/api/companies/discover", { input: "https://giottoai.bamboohr.com/careers" });

    expect((await res.json()).candidates).toEqual([expect.objectContaining({ suggestedName: "Giottoai", jobCount: 3 })]);
  });
});

describe("discovering a BambooHR Company from its name", () => {
  it("tries {name}.bamboohr.com", async () => {
    const { request, requested } = createTestApp({ sources: giotto });

    const res = await request("POST", "/api/companies/discover", { input: "Giotto AI" });

    expect(requested).toContain("https://giottoai.bamboohr.com/careers/list");
    expect(requested).toContain("https://giotto-ai.bamboohr.com/careers/list");
    expect((await res.json()).candidates).toEqual([
      expect.objectContaining({ source: { type: "bamboohr", key: "giottoai" }, suggestedName: "Giotto.ai", jobCount: 3 }),
    ]);
  });

  it("doesn't try a dotted name as a subdomain", async () => {
    const { request, requested } = createTestApp();

    await request("POST", "/api/companies/discover", { input: "Lumen.ai" });

    expect(requested).toContain("https://lumenai.bamboohr.com/careers/list");
    expect(requested.filter((url) => url.includes("lumen.ai.bamboohr"))).toEqual([]);
  });
});

describe("following a BambooHR Company", () => {
  it("stores its Jobs with their own page and the locations as published, remote ones as Remote", async () => {
    const { request } = createTestApp({ sources: giotto });

    const res = await request("POST", "/api/companies", { source: { type: "bamboohr", key: "giottoai" }, name: "Giotto.ai" });

    expect(res.status).toBe(201);
    expect((await res.json()).jobCount).toBe(3);
    const { jobs } = await (await request("GET", "/api/jobs")).json();
    const pick = (job: Record<string, unknown>) => ({
      title: job.title,
      url: job.url,
      locations: job.locations,
      publishedAt: job.publishedAt,
    });
    expect(jobs.map(pick)).toEqual([
      {
        title: "Spontaneous Application – Engineering Talent (Future Opportunities)",
        url: "https://giottoai.bamboohr.com/careers/32",
        locations: ["Remote", "Lausanne, Vaud, Switzerland"],
        publishedAt: null,
      },
      {
        title: "LLM Research Scientist",
        url: "https://giottoai.bamboohr.com/careers/36",
        locations: ["Lausanne, Vaud"],
        publishedAt: null,
      },
      {
        title: "Machine Learning Engineer",
        url: "https://giottoai.bamboohr.com/careers/39",
        locations: ["Remote", "Lausanne, Vaud, Switzerland"],
        publishedAt: null,
      },
    ]);
  });

  it("reads numeric location types, the isRemote flag, and Jobs with no location", async () => {
    const { request, sources } = createTestApp();
    sources["https://acme.bamboohr.com/careers/list"] = {
      body: {
        meta: { totalCount: 4 },
        result: [
          { id: "1", jobOpeningName: "Office Job", location: { city: "Amsterdam", state: "North Holland" }, atsLocation: { country: null, state: null, province: null, city: null }, isRemote: null, locationType: 0 },
          { id: "2", jobOpeningName: "Country Remote", location: { city: null, state: null }, atsLocation: { country: "Latvia", state: null, province: null, city: null }, isRemote: null, locationType: 1 },
          { id: "3", jobOpeningName: "Flagged Remote", location: { city: null, state: null }, atsLocation: { country: null, state: null, province: null, city: null }, isRemote: true, locationType: null },
          { id: "4", jobOpeningName: "Anywhere", location: { city: null, state: null }, atsLocation: { country: null, state: null, province: null, city: null }, isRemote: null, locationType: "0" },
        ],
      },
    };

    await request("POST", "/api/companies", { source: { type: "bamboohr", key: "acme" }, name: "Acme" });

    const { jobs } = await (await request("GET", "/api/jobs")).json();
    expect(jobs.map((job: { title: string; locations: string[] }) => [job.title, job.locations])).toEqual([
      ["Office Job", ["Amsterdam, North Holland"]],
      ["Country Remote", ["Remote", "Latvia"]],
      ["Flagged Remote", ["Remote"]],
      ["Anywhere", []],
    ]);
  });

  it("fails the read rather than storing a partial list when the site can't be read", async () => {
    const { request, sources } = createTestApp();
    sources["https://acme.bamboohr.com/careers/list"] = { status: 500, body: "oops" };

    const res = await request("POST", "/api/companies", { source: { type: "bamboohr", key: "acme" }, name: "Acme" });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('The BambooHR site "acme" answered with an error (HTTP 500)');
  });
});
