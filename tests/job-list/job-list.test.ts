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
