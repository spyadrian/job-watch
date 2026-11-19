import { describe, expect, it } from "vitest";
import { createTestApp } from "../support/test-app.ts";

const ACME_XML = "https://acme.jobs.personio.de/xml";
const acme = { [ACME_XML]: { file: "tests/fixtures/sources/personio/acme.xml", contentType: "text/xml" } };

describe("discovering a Personio Company from a link", () => {
  it("reads the public XML feed and reports N jobs found with the company's name", async () => {
    const { request } = createTestApp({ sources: acme });

    const res = await request("POST", "/api/companies/discover", { input: "https://acme.jobs.personio.de/" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidates: [
        {
          source: { type: "personio", key: "acme" },
          sourceLabel: "Personio",
          suggestedName: "Acme Robotics AG",
          jobCount: 3,
          alreadyFollowing: null,
        },
      ],
    });
  });

  it.each([
    "https://acme.jobs.personio.de/job/2885178?language=en",
    "https://acme.jobs.personio.de/xml",
    "https://acme.jobs.personio.com/",
    "https://acme.jobs.personio.com/job/2885178?display=en#apply",
    "https://acme.jobs.personio.com/xml?language=de",
    "acme.jobs.personio.de",
    "https://ACME.jobs.personio.com",
  ])("recognises %s as the Personio feed acme", async (input) => {
    const { request } = createTestApp({ sources: acme });

    const res = await request("POST", "/api/companies/discover", { input });

    const body = await res.json();
    expect(body.candidates.map((c: { source: unknown }) => c.source)).toEqual([{ type: "personio", key: "acme" }]);
  });

  it.each(["https://www.personio.de/", "https://www.personio.com/careers/", "https://jobs.personio.de/"])(
    "doesn't take Personio's own site %s for a feed",
    async (input) => {
      const { request } = createTestApp({ sources: acme });

      const res = await request("POST", "/api/companies/discover", { input });

      expect(await res.json()).toEqual({ candidates: [] });
    },
  );

  it("suggests a name from the link when the feed doesn't state one, and accepts an empty feed", async () => {
    const { request, sources } = createTestApp();
    sources["https://quiet-co.jobs.personio.de/xml"] = {
      body: '<?xml version="1.0" encoding="UTF-8"?>\n<workzag-jobs>\n</workzag-jobs>',
      contentType: "text/xml",
    };

    const res = await request("POST", "/api/companies/discover", { input: "https://quiet-co.jobs.personio.com" });

    expect(res.status).toBe(200);
    const [candidate] = (await res.json()).candidates;
    expect(candidate.source).toEqual({ type: "personio", key: "quiet-co" });
    expect(candidate.jobCount).toBe(0);
    expect(candidate.suggestedName).toBeTruthy();
  });

  it("explains when the feed doesn't exist", async () => {
    const { request, sources } = createTestApp();
    sources["https://nope.jobs.personio.de/xml"] = { status: 404, body: "Not Found" };

    const res = await request("POST", "/api/companies/discover", { input: "https://nope.jobs.personio.de" });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('The Personio feed "nope" doesn\'t exist (HTTP 404)');
  });

  it.each([
    ["an HTML page", "<!DOCTYPE html><html><body><p>Maintenance</p></body></html>", "text/html"],
    ["broken XML", '<?xml version="1.0"?><workzag-jobs><position><id>1</id>', "text/xml"],
    ["another XML document", '<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>', "text/xml"],
  ])("refuses %s rather than reporting zero jobs", async (_label, body, contentType) => {
    const { request, sources } = createTestApp();
    sources[ACME_XML] = { body, contentType };

    const res = await request("POST", "/api/companies/discover", { input: "https://acme.jobs.personio.de" });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/^The Personio feed "acme" (didn't answer with valid XML|answered in an unexpected format)$/);
  });
});

describe("following a Personio Company", () => {
  it("stores its Jobs with the main and additional offices and the publication date", async () => {
    const { request } = createTestApp({ sources: acme, now: "2026-01-15T09:00:00Z" });

    const res = await request("POST", "/api/companies", { source: { type: "personio", key: "acme" }, name: "Acme" });

    expect(res.status).toBe(201);
    expect((await res.json()).jobCount).toBe(3);
    const { jobs } = await (await request("GET", "/api/jobs")).json();
    const pick = (job: Record<string, unknown>) => ({
      title: job.title,
      url: job.url,
      locations: job.locations,
      publishedAt: job.publishedAt,
      status: job.status,
    });
    expect(jobs.map(pick)).toEqual([
      {
        title: "Senior Backend Engineer (m/f/d)",
        url: "https://acme.jobs.personio.de/job/2885178",
        locations: ["Zürich", "Bern", "Remote"],
        publishedAt: "2026-01-08T14:00:00.000Z",
        status: "unseen",
      },
      {
        title: "Sales & Partnerships Lead",
        url: "https://acme.jobs.personio.de/job/2884392",
        locations: ["Lausanne"],
        publishedAt: "2026-01-10T17:30:00.000Z",
        status: "unseen",
      },
      {
        title: "Working Student",
        url: "https://acme.jobs.personio.de/job/2880001",
        locations: [],
        publishedAt: null,
        status: "unseen",
      },
    ]);
  });
});
