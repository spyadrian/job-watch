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
});
