import { describe, expect, it } from "vitest";
import { emptyFilter, emptyListState, type Filter, type Job } from "../../src/web/job-list.ts";

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

const excludeManager: Filter = { ...emptyFilter, excluded: ["manager"] };

describe("why an empty list is empty", () => {
  it("an Inbox with no Company followed invites to follow one", () => {
    expect(emptyListState([], "inbox", emptyFilter, "", false)).toEqual({ kind: "no-company" });
  });

  it("an Inbox whose Jobs are all triaged is caught up", () => {
    const jobs = [job({ id: 1, status: "seen" }), job({ id: 2, status: "saved" })];

    expect(emptyListState(jobs, "inbox", emptyFilter, "", true)).toEqual({ kind: "caught-up", hiddenByFilter: 0 });
  });

  it("an Inbox whose Unseen Jobs all fail the Filter is caught up, with how many are hidden", () => {
    const jobs = [
      job({ id: 1, title: "Office Manager" }),
      job({ id: 2, title: "Sales Manager" }),
      job({ id: 3, title: "Engineer", status: "seen" }),
    ];

    expect(emptyListState(jobs, "inbox", excludeManager, "", true)).toEqual({ kind: "caught-up", hiddenByFilter: 2 });
  });

  it("a search that matches nothing says so, in any list", () => {
    const jobs = [job({ id: 1, title: "Engineer" }), job({ id: 2, title: "Designer", status: "saved" })];

    expect(emptyListState(jobs, "inbox", emptyFilter, "  pilot ", true)).toEqual({ kind: "no-match", query: "pilot" });
    expect(emptyListState(jobs, "saved", emptyFilter, "pilot", true)).toEqual({ kind: "no-match", query: "pilot" });
  });

  it("other lists keep their own message", () => {
    expect(emptyListState([], "saved", emptyFilter, "", true)).toEqual({ kind: "list" });
  });
});
