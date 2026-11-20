import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordedSources } from "../../src/server/recorded-fetch.ts";
import { createTestApp } from "../support/test-app.ts";

const search = (host: string, domain: string, start: number) =>
  `https://${host}/api/pcsx/search?domain=${domain}&query=&location=&start=${start}&sort_by=relevance`;
const nvidia: RecordedSources = {
  "https://jobs.nvidia.com/careers": { file: "tests/fixtures/sources/careers/eightfold-nvidia.html", contentType: "text/html" },
  "https://jobs.nvidia.com/careers/job/893398806259": {
    file: "tests/fixtures/sources/careers/eightfold-nvidia.html",
    contentType: "text/html",
  },
  [search("jobs.nvidia.com", "nvidia.com", 0)]: { file: "tests/fixtures/sources/eightfold/nvidia.json", contentType: "application/json" },
};
const vodafone = (start: number) => search("vodafone.eightfold.ai", "vodafone.com", start);

/** A recorded search page of `size` minimal positions from `start`, as the API answers. */
function searchPage(start: number, size: number, count: number) {
  return {
    body: {
      status: 200,
      data: {
        count,
        positions: Array.from({ length: size }, (_, i) => ({
          id: 563018698400000 + start + i,
          name: `Role ${start + i + 1}`,
          locations: ["Germany, Düsseldorf"],
          standardizedLocations: ["Düsseldorf, NW, DE"],
          postedTs: 1795132800,
          positionUrl: `/careers/job/${563018698400000 + start + i}`,
        })),
      },
    },
  };
}

/** The first 100 recorded pages of a Vodafone site that reports `count` Jobs. */
const pagesOf = (count: number): RecordedSources =>
  Object.fromEntries(Array.from({ length: 100 }, (_, n) => [vodafone(n * 10), searchPage(n * 10, 10, count)]));

describe("discovering an Eightfold careers site from a link", () => {
  it("recognises the careers site on the employer's domain and reads its Jobs, saving nothing", async () => {
    const { request } = createTestApp({ sources: nvidia });

    const res = await request("POST", "/api/companies/discover", { input: "https://jobs.nvidia.com/careers" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidates: [
        {
          source: { type: "eightfold", key: "jobs.nvidia.com/nvidia.com" },
          sourceLabel: "Eightfold",
          suggestedName: "Nvidia",
          jobCount: 3,
          alreadyFollowing: null,
        },
      ],
    });
    expect(await (await request("GET", "/api/jobs")).json()).toEqual({ jobs: [] });
  });

  it.each<[string, string, RecordedSources]>([
    ["https://jobs.nvidia.com/careers/job/893398806259", "jobs.nvidia.com/nvidia.com", nvidia],
    [
      "https://vodafone.eightfold.ai/careers?domain=vodafone.com&query=&location=",
      "vodafone.eightfold.ai/vodafone.com",
      { [vodafone(0)]: searchPage(0, 2, 2) },
    ],
    [
      "https://vodafone.eightfold.ai/careers",
      "vodafone.eightfold.ai/vodafone.com",
      {
        "https://vodafone.eightfold.ai/careers": {
          body: '<html><body><code id="pcsx-data" style="display:none;">{"domain": "vodafone.com"}</code></body></html>',
          contentType: "text/html",
        },
        [vodafone(0)]: searchPage(0, 2, 2),
      },
    ],
  ])("recognises %s as the Eightfold site %s", async (input, key, sources) => {
    const { request } = createTestApp({ sources });

    const res = await request("POST", "/api/companies/discover", { input });

    expect(res.status).toBe(200);
    expect((await res.json()).candidates.map((c: { source: unknown }) => c.source)).toEqual([{ type: "eightfold", key }]);
  });

  it("finds Microsoft's careers site, where its usual link redirects", async () => {
    const { request } = createTestApp({
      sources: {
        "https://jobs.careers.microsoft.com/": { status: 301, location: "https://apply.careers.microsoft.com/careers" },
        "https://apply.careers.microsoft.com/careers": {
          file: "tests/fixtures/sources/careers/eightfold-microsoft.html",
          contentType: "text/html",
        },
        [search("apply.careers.microsoft.com", "microsoft.com", 0)]: {
          file: "tests/fixtures/sources/eightfold/microsoft.json",
          contentType: "application/json",
        },
      },
    });

    const res = await request("POST", "/api/companies/discover", { input: "https://jobs.careers.microsoft.com" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidates: [
        {
          source: { type: "eightfold", key: "apply.careers.microsoft.com/microsoft.com" },
          sourceLabel: "Eightfold",
          suggestedName: "Microsoft",
          jobCount: 2,
          alreadyFollowing: null,
        },
      ],
    });
  });

  it("never tries Eightfold for a Company name, since a name doesn't give the site's host", async () => {
    const { request, requested } = createTestApp();

    await request("POST", "/api/companies/discover", { input: "Nvidia" });

    expect(requested.filter((url) => url.includes("/api/pcsx/"))).toEqual([]);
  });
});

describe("reading every page of an Eightfold site", () => {
  const discoverVodafone = (sources: RecordedSources) =>
    createTestApp({ sources }).request("POST", "/api/companies/discover", {
      input: "https://vodafone.eightfold.ai/careers?domain=vodafone.com",
    });

  it("reads pages of 10 until the count is reached", async () => {
    const res = await discoverVodafone({
      [vodafone(0)]: searchPage(0, 10, 25),
      [vodafone(10)]: searchPage(10, 10, 25),
      [vodafone(20)]: searchPage(20, 5, 25),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).candidates[0].jobCount).toBe(25);
  });

  it("reads at most 100 pages", async () => {
    const sources = Object.fromEntries(Array.from({ length: 102 }, (_, n) => [vodafone(n * 10), searchPage(n * 10, 10, 1020)]));

    const res = await discoverVodafone(sources);

    expect(res.status).toBe(200);
    expect((await res.json()).candidates[0].jobCount).toBe(1000);
  });

  it("says when it stopped at 1000 Jobs while the site has more", async () => {
    const res = await discoverVodafone(pagesOf(2626));

    expect((await res.json()).candidates[0]).toMatchObject({ jobCount: 1000, capped: { read: 1000, total: 2626 } });
  });

  it("says nothing more when the site has exactly 1000 Jobs", async () => {
    const res = await discoverVodafone(pagesOf(1000));

    const [candidate] = (await res.json()).candidates;
    expect(candidate.jobCount).toBe(1000);
    expect(candidate).not.toHaveProperty("capped");
  });

  describe("when the site asks to slow down (HTTP 429)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("waits and asks for the page again", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout"] });
      let throttled = 1;
      const { request } = createTestApp({
        sources: { [vodafone(0)]: searchPage(0, 10, 15), [vodafone(10)]: searchPage(10, 5, 15) },
        wrapFetch: (recorded) => async (input, init) =>
          String(input) === vodafone(10) && throttled-- > 0 ? new Response("Please try again later", { status: 429 }) : recorded(input, init),
      });

      const pending = request("POST", "/api/companies/discover", { input: "https://vodafone.eightfold.ai/careers?domain=vodafone.com" });
      await vi.advanceTimersByTimeAsync(60_000);
      const res = await pending;

      expect(res.status).toBe(200);
      expect((await res.json()).candidates[0].jobCount).toBe(15);
    });

    it("gives up after a few tries, failing the whole read", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout"] });
      const { request } = createTestApp({
        sources: { [vodafone(0)]: searchPage(0, 10, 15), [vodafone(10)]: { status: 429, body: "Please try again later" } },
      });

      const pending = request("POST", "/api/companies/discover", { input: "https://vodafone.eightfold.ai/careers?domain=vodafone.com" });
      await vi.advanceTimersByTimeAsync(600_000);
      const res = await pending;

      expect(res.status).toBe(502);
      expect((await res.json()).error).toBe("The Eightfold careers site vodafone.eightfold.ai answered with an error (HTTP 429)");
    });
  });

  it("counts a Job once when a new posting shifts it onto the next page", async () => {
    const res = await discoverVodafone({ [vodafone(0)]: searchPage(0, 10, 20), [vodafone(10)]: searchPage(9, 10, 20) });

    expect((await res.json()).candidates[0].jobCount).toBe(19);
  });

  it("fails as a whole when a later page fails, naming the site", async () => {
    const res = await discoverVodafone({ [vodafone(0)]: searchPage(0, 10, 15), [vodafone(10)]: { status: 503, body: "busy" } });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("The Eightfold careers site vodafone.eightfold.ai answered with an error (HTTP 503)");
  });

  it("refuses an answer that isn't the search JSON rather than reporting zero jobs", async () => {
    const res = await discoverVodafone({ [vodafone(0)]: { body: "<!DOCTYPE html><html></html>", contentType: "text/html" } });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("The Eightfold careers site vodafone.eightfold.ai didn't answer with valid JSON");
  });
});

describe("following an Eightfold Company", () => {
  it("stores its Jobs with their public page, locations as published and posting date", async () => {
    const { request } = createTestApp({ sources: nvidia });

    const res = await request("POST", "/api/companies", {
      source: { type: "eightfold", key: "jobs.nvidia.com/nvidia.com" },
      name: "NVIDIA",
    });

    expect(res.status).toBe(201);
    const { jobs } = await (await request("GET", "/api/jobs")).json();
    const shown = jobs.map((j: Record<string, unknown>) => ({ title: j.title, url: j.url, locations: j.locations, publishedAt: j.publishedAt }));
    expect(shown).toEqual(
      expect.arrayContaining([
        {
          title: "Senior DevOps and Infrastructure Engineer",
          url: "https://jobs.nvidia.com/careers/job/893398806259",
          locations: ["US, CA, Santa Clara"],
          publishedAt: "2026-11-20T00:00:00.000Z",
        },
        {
          title: "Senior Production Engineer  - DGX Cloud",
          url: "https://jobs.nvidia.com/careers/job/893398023834",
          locations: ["Remote - Switzerland", "Switzerland, Zurich"],
          publishedAt: "2026-11-20T00:00:00.000Z",
        },
        {
          title: "Datacenter Technician",
          url: "https://jobs.nvidia.com/careers/job/893398741548",
          locations: ["India, Bengaluru"],
          publishedAt: "2026-11-20T00:00:00.000Z",
        },
      ]),
    );
    expect(shown).toHaveLength(3);
  });

  it("says on the Company, after each read, whether it stopped at 1000 Jobs while the site has more", async () => {
    const { request, sources } = createTestApp({ sources: pagesOf(2626) });
    const companies = async () => (await (await request("GET", "/api/companies")).json()).companies;
    const refresh = async () => (await request("POST", "/api/refresh")).text();

    const res = await request("POST", "/api/companies", {
      source: { type: "eightfold", key: "vodafone.eightfold.ai/vodafone.com" },
      name: "Vodafone",
    });
    expect((await res.json()).company.capped).toEqual({ read: 1000, total: 2626 });
    expect((await companies())[0].capped).toEqual({ read: 1000, total: 2626 });

    Object.assign(sources, { [vodafone(0)]: searchPage(0, 10, 10) });
    await refresh();
    expect((await companies())[0]).not.toHaveProperty("capped");

    Object.assign(sources, pagesOf(1500));
    await refresh();
    expect((await companies())[0].capped).toEqual({ read: 1000, total: 1500 });
  });

  it("keeps saying so when a later read fails", async () => {
    const { request, sources } = createTestApp({ sources: pagesOf(2626) });
    await request("POST", "/api/companies", { source: { type: "eightfold", key: "vodafone.eightfold.ai/vodafone.com" }, name: "Vodafone" });

    sources[vodafone(0)] = { status: 503, body: "busy" };
    await (await request("POST", "/api/refresh")).text();

    const [company] = (await (await request("GET", "/api/companies")).json()).companies;
    expect(company.lastError.message).toContain("HTTP 503");
    expect(company.capped).toEqual({ read: 1000, total: 2626 });
  });
});

describe("narrowing an Eightfold site to one location", () => {
  const nvidiaIn = (location: string, start: number) =>
    `https://jobs.nvidia.com/api/pcsx/search?domain=nvidia.com&query=&location=${location}&start=${start}&sort_by=relevance`;
  const switzerland: RecordedSources = {
    "https://jobs.nvidia.com/careers?location=Switzerland": {
      file: "tests/fixtures/sources/careers/eightfold-nvidia.html",
      contentType: "text/html",
    },
    [nvidiaIn("Switzerland", 0)]: { file: "tests/fixtures/sources/eightfold/nvidia-switzerland.json", contentType: "application/json" },
  };

  it("keeps the location of a careers link on the employer's domain, and reads only that location's Jobs", async () => {
    const { request, requested } = createTestApp({ sources: switzerland });

    const res = await request("POST", "/api/companies/discover", { input: "https://jobs.nvidia.com/careers?location=Switzerland" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidates: [
        {
          source: { type: "eightfold", key: "jobs.nvidia.com/nvidia.com?location=Switzerland" },
          sourceLabel: "Eightfold",
          suggestedName: "Nvidia",
          jobCount: 2,
          alreadyFollowing: null,
        },
      ],
    });
    expect(requested).toContain(nvidiaIn("Switzerland", 0));
  });

  it("keeps the location of an eightfold.ai link", async () => {
    const { request } = createTestApp({
      sources: {
        "https://vodafone.eightfold.ai/api/pcsx/search?domain=vodafone.com&query=&location=Germany&start=0&sort_by=relevance":
          searchPage(0, 2, 2),
      },
    });

    const res = await request("POST", "/api/companies/discover", {
      input: "https://vodafone.eightfold.ai/careers?domain=vodafone.com&location=Germany",
    });

    expect((await res.json()).candidates.map((c: { source: unknown }) => c.source)).toEqual([
      { type: "eightfold", key: "vodafone.eightfold.ai/vodafone.com?location=Germany" },
    ]);
  });

  it("passes a location with spaces and commas to the site as given", async () => {
    const { request, requested } = createTestApp({
      sources: { [nvidiaIn("Switzerland%2C%20Zurich", 0)]: searchPage(0, 2, 2) },
    });

    const res = await request("POST", "/api/companies", {
      source: { type: "eightfold", key: "jobs.nvidia.com/nvidia.com?location=Switzerland, Zurich" },
      name: "NVIDIA Zurich",
    });

    expect(res.status).toBe(201);
    expect(requested).toEqual([nvidiaIn("Switzerland%2C%20Zurich", 0)]);
  });

  it("lets the same site be followed both whole and for one location", async () => {
    const { request } = createTestApp({ sources: { ...nvidia, ...switzerland } });

    const whole = await request("POST", "/api/companies", {
      source: { type: "eightfold", key: "jobs.nvidia.com/nvidia.com" },
      name: "NVIDIA",
    });
    const swiss = await request("POST", "/api/companies", {
      source: { type: "eightfold", key: "jobs.nvidia.com/nvidia.com?location=Switzerland" },
      name: "NVIDIA Switzerland",
    });

    expect(whole.status).toBe(201);
    expect(swiss.status).toBe(201);
    expect((await swiss.json()).jobCount).toBe(2);
  });
});
