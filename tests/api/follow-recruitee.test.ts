import { describe, expect, it } from "vitest";
import { createTestApp } from "../support/test-app.ts";

const ACME_OFFERS = "https://acme.recruitee.com/api/offers/";
const acme = { [ACME_OFFERS]: { file: "tests/fixtures/sources/recruitee/acme.json", contentType: "application/json" } };

describe("discovering a Recruitee Company from a link", () => {
  it("reads the public offers API and reports N jobs found with the company's name", async () => {
    const { request } = createTestApp({ sources: acme });

    const res = await request("POST", "/api/companies/discover", { input: "https://acme.recruitee.com/" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidates: [
        {
          source: { type: "recruitee", key: "acme" },
          sourceLabel: "Recruitee",
          suggestedName: "Acme Robotics",
          jobCount: 3,
          alreadyFollowing: null,
        },
      ],
    });
  });

  it.each([
    "https://acme.recruitee.com/o/backend-engineer",
    "https://acme.recruitee.com/l/en/o/backend-engineer?source=linkedin",
    "https://acme.recruitee.com/api/offers/",
    "acme.recruitee.com",
    "https://ACME.recruitee.com/#jobs",
  ])("recognises %s as the Recruitee board acme", async (input) => {
    const { request } = createTestApp({ sources: acme });

    const res = await request("POST", "/api/companies/discover", { input });

    const body = await res.json();
    expect(body.candidates.map((c: { source: unknown }) => c.source)).toEqual([{ type: "recruitee", key: "acme" }]);
  });

  it.each(["https://recruitee.com/pricing", "https://www.recruitee.com/", "https://app.recruitee.com/"])(
    "doesn't take Recruitee's own site %s for a board",
    async (input) => {
      const { request } = createTestApp({ sources: acme });

      const res = await request("POST", "/api/companies/discover", { input });

      expect((await res.json()).candidates).toEqual([]);
    },
  );

  it("explains when the board doesn't exist", async () => {
    const { request, sources } = createTestApp();
    sources["https://nope.recruitee.com/api/offers/"] = { status: 404, body: "Not Found" };

    const res = await request("POST", "/api/companies/discover", { input: "https://nope.recruitee.com" });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('The Recruitee board "nope" doesn\'t exist (HTTP 404)');
  });

  it("refuses an answer in an unexpected format rather than reporting zero jobs", async () => {
    const { request, sources } = createTestApp();
    sources[ACME_OFFERS] = { body: { message: "maintenance" } };

    const res = await request("POST", "/api/companies/discover", { input: "https://acme.recruitee.com" });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/unexpected format/);
  });
});

describe("following a Recruitee Company", () => {
  it("stores its Jobs with every published location and the publication date", async () => {
    const { request } = createTestApp({ sources: acme, now: "2026-01-15T09:00:00Z" });

    const res = await request("POST", "/api/companies", { source: { type: "recruitee", key: "acme" }, name: "Acme" });

    expect(res.status).toBe(201);
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
        title: "Backend Engineer",
        url: "https://acme.recruitee.com/o/backend-engineer",
        locations: ["Zürich, Zürich, Switzerland", "Geneva, Geneva, Switzerland"],
        publishedAt: "2026-01-08T14:00:00.000Z",
        status: "unseen",
      },
      {
        title: "Support Agent (France)",
        url: "https://acme.recruitee.com/o/support-agent-france",
        locations: ["Remote job", "Paris, Île-de-France, France"],
        publishedAt: "2026-01-10T07:45:05.000Z",
        status: "unseen",
      },
      {
        title: "Office Manager",
        url: "https://acme.recruitee.com/o/office-manager",
        locations: [],
        publishedAt: null,
        status: "unseen",
      },
    ]);
  });
});
