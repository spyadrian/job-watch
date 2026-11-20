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
});
