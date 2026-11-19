import { describe, expect, it } from "vitest";
import { emptyFilter, jobRows, type Job } from "../../src/web/job-list.ts";

function job(overrides: Partial<Job> & Pick<Job, "id">): Job {
  return {
    companyName: "Acme",
    title: "Software Engineer",
    url: `https://example.com/jobs/${overrides.id}`,
    locations: ["Geneva"],
    publishedAt: null,
    firstFetchedAt: "2026-01-15T09:00:00Z",
    status: "unseen",
    wasSaved: false,
    outdated: false,
    ...overrides,
  };
}

describe("job list", () => {
  it("the Inbox shows Unseen Jobs and the Seen list shows Seen Jobs", () => {
    const jobs = [job({ id: 1, status: "unseen" }), job({ id: 2, status: "seen" }), job({ id: 3, status: "saved" })];

    expect(jobRows(jobs, "inbox", emptyFilter, "").map((r) => r.job.id)).toEqual([1]);
    expect(jobRows(jobs, "seen", emptyFilter, "").map((r) => r.job.id)).toEqual([2]);
  });

  describe("sort order", () => {
    const ids = (jobs: Job[]) => jobRows(jobs, "inbox", emptyFilter, "").map((r) => r.job.id);

    it("puts the most recently first-fetched Jobs first", () => {
      const jobs = [
        job({ id: 1, firstFetchedAt: "2026-01-10T09:00:00Z" }),
        job({ id: 2, firstFetchedAt: "2026-01-12T09:00:00Z" }),
        job({ id: 3, firstFetchedAt: "2026-01-11T09:00:00Z" }),
      ];

      expect(ids(jobs)).toEqual([2, 3, 1]);
    });

    it("orders Jobs first fetched together by publication date, newest first, missing last", () => {
      const jobs = [
        job({ id: 1, publishedAt: null }),
        job({ id: 2, publishedAt: "2026-01-01T00:00:00Z" }),
        job({ id: 3, publishedAt: "2026-01-09T00:00:00Z" }),
        job({ id: 4, publishedAt: "2026-01-05T00:00:00Z" }),
      ];

      expect(ids(jobs)).toEqual([3, 4, 2, 1]);
    });

    it("breaks remaining ties by title", () => {
      const jobs = [
        job({ id: 1, title: "Product Designer", publishedAt: null }),
        job({ id: 2, title: "Data Engineer", publishedAt: null }),
        job({ id: 3, title: "backend Engineer", publishedAt: null }),
        job({ id: 4, title: "Zeta", publishedAt: "2026-01-01T00:00:00Z" }),
      ];

      expect(ids(jobs)).toEqual([4, 3, 2, 1]);
    });

    it("compares instants, not strings, whatever the time zone offset", () => {
      const jobs = [
        job({ id: 1, firstFetchedAt: "2026-01-10T10:00:00+02:00" }), // 08:00Z
        job({ id: 2, firstFetchedAt: "2026-01-10T09:00:00Z" }),
      ];

      expect(ids(jobs)).toEqual([2, 1]);
    });
  });
});

describe("search", () => {
  const ids = (jobs: Job[], query: string, list: "inbox" | "saved" | "applied" | "seen" = "inbox") =>
    jobRows(jobs, list, emptyFilter, query).map((r) => r.job.id);

  it("finds Jobs by title, Company or location, ignoring accents and case", () => {
    const jobs = [
      job({ id: 1, title: "Backend Engineer" }),
      job({ id: 2, title: "Designer", companyName: "Globex" }),
      job({ id: 3, title: "Designer", locations: ["Zürich", "Genève, Switzerland"] }),
    ];

    expect(ids(jobs, "BACKEND")).toEqual([1]);
    expect(ids(jobs, "globex")).toEqual([2]);
    expect(ids(jobs, "geneve")).toEqual([3]);
    expect(ids(jobs, "ZURICH")).toEqual([3]);
  });

  it("requires every word to match, each in any field", () => {
    const jobs = [
      job({ id: 1, title: "Backend Engineer", companyName: "Acme", locations: ["Geneva"] }),
      job({ id: 2, title: "Backend Engineer", companyName: "Globex", locations: ["Zurich"] }),
      job({ id: 3, title: "Frontend Engineer", companyName: "Acme", locations: ["Geneva"] }),
    ];

    expect(ids(jobs, "  backend   acme ")).toEqual([1]);
    expect(ids(jobs, "engineer geneva")).toEqual([1, 3]);
    expect(ids(jobs, "backend lausanne")).toEqual([]);
    expect(ids(jobs, "")).toEqual([1, 2, 3]);
  });

  it("searches the list being viewed", () => {
    const jobs = [
      job({ id: 1, title: "Designer", status: "unseen" }),
      job({ id: 2, title: "Designer", status: "saved" }),
      job({ id: 3, title: "Engineer", status: "saved" }),
      job({ id: 4, title: "Designer", status: "applied" }),
      job({ id: 5, title: "Designer", status: "seen" }),
    ];

    expect(ids(jobs, "designer", "saved")).toEqual([2]);
    expect(ids(jobs, "designer", "applied")).toEqual([4]);
    expect(ids(jobs, "designer", "seen")).toEqual([5]);
  });

  it("highlights every matching word in title, Company and locations", () => {
    const [row] = jobRows(
      [job({ id: 1, title: "Senior Engineer, Engine team", companyName: "Acmé", locations: ["Zürich", "Genève"] })],
      "inbox",
      emptyFilter,
      "engine ACME geneve",
    );

    expect(row!.highlights).toEqual({
      title: [
        { start: 7, end: 13, kind: "search" },
        { start: 17, end: 23, kind: "search" },
      ],
      company: [{ start: 0, end: 4, kind: "search" }],
      locations: [[], [{ start: 0, end: 6, kind: "search" }]],
    });
  });

  it("keeps highlight ranges on the original text when it holds decomposed accents", () => {
    const title = "Génève office"; // "Genève" written with combining marks
    const [row] = jobRows([job({ id: 1, title })], "inbox", emptyFilter, "geneve");

    expect(row!.highlights.title).toEqual([{ start: 0, end: 8, kind: "search" }]);
  });

  it("highlights nothing without a query", () => {
    const [row] = jobRows([job({ id: 1, locations: ["Geneva"] })], "inbox", emptyFilter, "");

    expect(row!.highlights).toEqual({ title: [], company: [], locations: [[]] });
  });
});
