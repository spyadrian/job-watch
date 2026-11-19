import { describe, expect, it } from "vitest";
import { emptyFilter, jobRows, type Filter, type Job } from "../../src/web/job-list.ts";

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

describe("the Filter", () => {
  const filter = (f: Partial<Filter>): Filter => ({ ...emptyFilter, ...f });
  const inbox = (jobs: Job[], f: Partial<Filter>) => jobRows(jobs, "inbox", filter(f), "").map((r) => r.job.id);

  describe("City filters", () => {
    it("pass a Job whose location contains any spelling, ignoring accents and case", () => {
      const jobs = [
        job({ id: 1, locations: ["GENÈVE, Switzerland"] }),
        job({ id: 2, locations: ["Genf"] }),
        job({ id: 3, locations: ["Lausanne"] }),
      ];

      expect(inbox(jobs, { cities: [["Geneve", "Genf"]] })).toEqual([1, 2]);
    });

    it("combine with OR and pass a Job if any of its locations matches", () => {
      const jobs = [
        job({ id: 1, locations: ["Zürich, Switzerland"] }),
        job({ id: 2, locations: ["Berlin", "Lausanne"] }),
        job({ id: 3, locations: ["Berlin", "Paris"] }),
      ];

      expect(inbox(jobs, { cities: [["Zurich"], ["Lausanne"]] })).toEqual([1, 2]);
    });

    it("always pass Jobs with no location or a remote location", () => {
      const jobs = [
        job({ id: 1, locations: [] }),
        job({ id: 2, locations: ["Remote - Europe"] }),
        job({ id: 3, locations: ["Berlin", "REMOTE"] }),
        job({ id: 4, locations: ["Berlin"] }),
      ];

      expect(inbox(jobs, { cities: [["Geneva"]] })).toEqual([1, 2, 3]);
    });

    it("pass every Job when there is no City filter", () => {
      expect(inbox([job({ id: 1, locations: ["Berlin"] })], { cities: [] })).toEqual([1]);
    });
  });

  describe("keywords", () => {
    it("Required: the title must contain at least one, ignoring accents and case", () => {
      const jobs = [
        job({ id: 1, title: "Développeur Frontend" }),
        job({ id: 2, title: "Senior TYPESCRIPT Engineer" }),
        job({ id: 3, title: "Product Manager" }),
      ];

      expect(inbox(jobs, { required: ["developpeur", "TypeScript"] })).toEqual([1, 2]);
    });

    it("Excluded: a title containing any is kept out", () => {
      const jobs = [
        job({ id: 1, title: "Software Engineer" }),
        job({ id: 2, title: "Stagiaire Software Engineer" }),
        job({ id: 3, title: "Lead Engineer" }),
      ];

      expect(inbox(jobs, { excluded: ["STAGIAIRE", "lead"] })).toEqual([1]);
    });

    it("match the title only, not the Company or locations", () => {
      const jobs = [job({ id: 1, title: "Engineer", companyName: "Rust Corp", locations: ["Rust"] })];

      expect(inbox(jobs, { required: ["rust"] })).toEqual([]);
      expect(inbox(jobs, { excluded: ["rust"] })).toEqual([1]);
    });

    it("Boosted: matching Jobs sort first, then the usual order", () => {
      const jobs = [
        job({ id: 1, title: "Data Engineer", firstFetchedAt: "2026-01-12T09:00:00Z" }),
        job({ id: 2, title: "React Developer", firstFetchedAt: "2026-01-10T09:00:00Z" }),
        job({ id: 3, title: "Product Manager", firstFetchedAt: "2026-01-11T09:00:00Z" }),
        job({ id: 4, title: "Senior réact engineer", firstFetchedAt: "2026-01-11T09:00:00Z" }),
      ];

      expect(inbox(jobs, { boosted: ["React"] })).toEqual([4, 2, 1, 3]);
    });

    it("ignore blank keywords and spellings", () => {
      const jobs = [job({ id: 1, title: "Engineer", locations: ["Berlin"] })];

      expect(inbox(jobs, { required: [" "], excluded: [""], cities: [["", "Geneva"]] })).toEqual([]);
      expect(inbox(jobs, { required: [" "], excluded: [""] })).toEqual([1]);
    });
  });

  describe("highlights", () => {
    it("mark Required (green) and Boosted (yellow) keywords in the title, on the original text", () => {
      const jobs = [job({ id: 1, title: "Développeur React / react native" })];
      const [row] = jobRows(jobs, "inbox", filter({ required: ["developpeur"], boosted: ["REACT"] }), "");

      expect(row!.highlights.title).toEqual([
        { start: 0, end: 11, kind: "required" },
        { start: 12, end: 17, kind: "boosted" },
        { start: 20, end: 25, kind: "boosted" },
      ]);
      expect(row!.highlights.company).toEqual([]);
      expect(row!.highlights.locations).toEqual([[]]);
    });

    it("show in every list, not only the Inbox", () => {
      const jobs = [job({ id: 1, status: "applied", title: "Rust Engineer" })];
      const [row] = jobRows(jobs, "applied", filter({ required: ["rust"] }), "");

      expect(row!.highlights.title).toEqual([{ start: 0, end: 4, kind: "required" }]);
    });

    it("keep their place when accents decompose (combining marks in the title)", () => {
      const title = "Ingénieur Zürich"; // "Ingénieur Zürich" with combining accents
      const [row] = jobRows([job({ id: 1, title })], "inbox", filter({ boosted: ["zurich"] }), "");

      expect(row!.highlights.title).toEqual([{ start: 11, end: 18, kind: "boosted" }]);
    });
  });

  it("applies only to the Inbox: other lists show everything, in the usual order", () => {
    const jobs = [
      job({ id: 1, status: "saved", title: "Intern", locations: ["Berlin"], firstFetchedAt: "2026-01-12T09:00:00Z" }),
      job({ id: 2, status: "saved", title: "Boosted role", locations: ["Berlin"], firstFetchedAt: "2026-01-10T09:00:00Z" }),
    ];
    const f = filter({ cities: [["Geneva"]], required: ["engineer"], excluded: ["intern"], boosted: ["boosted"] });

    expect(jobRows(jobs, "saved", f, "").map((r) => r.job.id)).toEqual([1, 2]);
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
