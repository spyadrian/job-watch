import { describe, expect, it } from "vitest";
import { emptyFilter, emptyListState, type Filter, type Job, type LoadState } from "../../src/web/job-list.ts";

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

const noCompany: LoadState = { jobsLoaded: true, companies: "none" };
const someCompany: LoadState = { jobsLoaded: true, companies: "some" };

describe("why an empty list is empty", () => {
  it("an Inbox with no Company followed invites to follow one", () => {
    expect(emptyListState([], "inbox", emptyFilter, "", noCompany)).toEqual({ kind: "no-company" });
  });

  it("an Inbox whose Jobs are all triaged is caught up", () => {
    const jobs = [job({ id: 1, status: "seen" }), job({ id: 2, status: "saved" })];

    expect(emptyListState(jobs, "inbox", emptyFilter, "", someCompany)).toEqual({ kind: "caught-up", hiddenByFilter: 0 });
  });

  it("an Inbox whose Unseen Jobs all fail the Filter is caught up, with how many are hidden", () => {
    const jobs = [
      job({ id: 1, title: "Office Manager" }),
      job({ id: 2, title: "Sales Manager" }),
      job({ id: 3, title: "Engineer", status: "seen" }),
    ];

    expect(emptyListState(jobs, "inbox", excludeManager, "", someCompany)).toEqual({ kind: "caught-up", hiddenByFilter: 2 });
  });

  it("a search that matches nothing says so, in any list", () => {
    const jobs = [job({ id: 1, title: "Engineer" }), job({ id: 2, title: "Designer", status: "saved" })];

    expect(emptyListState(jobs, "inbox", emptyFilter, "  pilot ", someCompany)).toEqual({ kind: "no-match", query: "pilot" });
    expect(emptyListState(jobs, "saved", emptyFilter, "pilot", someCompany)).toEqual({ kind: "no-match", query: "pilot" });
  });

  it("other lists keep their own message", () => {
    expect(emptyListState([], "saved", emptyFilter, "", someCompany)).toEqual({ kind: "list-message" });
  });

  it("says nothing until the Jobs have loaded", () => {
    const loading: LoadState = { jobsLoaded: false, companies: "some" };

    expect(emptyListState([], "inbox", emptyFilter, "", loading)).toEqual({ kind: "loading" });
    expect(emptyListState([], "saved", emptyFilter, "", loading)).toEqual({ kind: "loading" });
  });

  it("an Inbox says nothing until the Companies have loaded", () => {
    const jobs = [job({ id: 1, status: "seen" })];

    expect(emptyListState(jobs, "inbox", emptyFilter, "", { jobsLoaded: true, companies: "loading" })).toEqual({
      kind: "loading",
    });
  });

  it("an Inbox whose Companies failed to load doesn't claim none are followed", () => {
    expect(emptyListState([], "inbox", emptyFilter, "", { jobsLoaded: true, companies: "failed" })).toEqual({
      kind: "caught-up",
      hiddenByFilter: 0,
    });
  });
});
