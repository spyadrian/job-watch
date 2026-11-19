import { describe, expect, it } from "vitest";
import type { Company, Job, RefreshEvent } from "../../src/shared/types.ts";
import { createTestApp, type TestAppOptions } from "../support/test-app.ts";

const board = (slug: string) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;

interface GhJob {
  id: number;
  title: string;
  location?: string;
  published?: string;
}

/** A recorded Greenhouse board answering with these Jobs. */
function greenhouse(slug: string, jobs: GhJob[]) {
  return {
    body: {
      jobs: jobs.map((j) => ({
        id: j.id,
        title: j.title,
        absolute_url: `https://job-boards.greenhouse.io/${slug}/jobs/${j.id}`,
        location: j.location ? { name: j.location } : null,
        first_published: j.published ?? null,
      })),
    },
  };
}

const designer: GhJob = { id: 1, title: "Product Designer", location: "Geneva", published: "2026-01-10T12:00:00Z" };
const engineer: GhJob = { id: 2, title: "Backend Engineer", location: "Zürich", published: "2026-01-11T12:00:00Z" };
const analyst: GhJob = { id: 3, title: "Data Analyst", location: "Bern", published: "2026-01-12T12:00:00Z" };

async function setup(options: TestAppOptions = {}) {
  const app = createTestApp({
    now: "2026-01-15T09:00:00Z",
    ...options,
    sources: { [board("acme")]: greenhouse("acme", [designer, engineer]), ...options.sources },
  });
  async function follow(key: string, name: string): Promise<Company> {
    const res = await app.request("POST", "/api/companies", { source: { type: "greenhouse", key }, name });
    expect(res.status).toBe(201);
    return ((await res.json()) as { company: Company }).company;
  }
  async function refresh(): Promise<RefreshEvent[]> {
    const res = await app.request("POST", "/api/refresh");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    return readEvents(res);
  }
  async function jobs(): Promise<Job[]> {
    return ((await (await app.request("GET", "/api/jobs")).json()) as { jobs: Job[] }).jobs;
  }
  async function job(title: string): Promise<Job | undefined> {
    return (await jobs()).find((j) => j.title === title);
  }
  async function companies(): Promise<Company[]> {
    return ((await (await app.request("GET", "/api/companies")).json()) as { companies: Company[] }).companies;
  }
  async function act(title: string, action: string) {
    const target = await job(title);
    const res = await app.request("POST", `/api/jobs/${target!.id}/status`, { action });
    expect(res.status).toBe(200);
    return (await res.json()) as { job: Job | null; deleted?: true };
  }
  function setBoard(slug: string, list: GhJob[]) {
    app.sources[board(slug)] = greenhouse(slug, list);
  }
  return { ...app, follow, refresh, jobs, job, companies, act, setBoard };
}

async function readEvents(res: Response): Promise<RefreshEvent[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as RefreshEvent);
}

function summaryOf(events: RefreshEvent[]) {
  const last = events.at(-1);
  expect(last?.type).toBe("done");
  return last?.type === "done" ? last.summary : null;
}

describe("refreshing new and existing Jobs", () => {
  it("stores Jobs found for the first time as Unseen, first fetched now", async () => {
    const t = await setup();
    await t.follow("acme", "Acme");
    t.clock.set("2026-01-16T08:00:00Z");
    t.setBoard("acme", [designer, engineer, analyst]);

    const events = await t.refresh();

    expect(summaryOf(events)).toEqual({ new: 1, outdated: 0, failed: 0 });
    expect(await t.job("Data Analyst")).toMatchObject({
      companyName: "Acme",
      url: "https://job-boards.greenhouse.io/acme/jobs/3",
      locations: ["Bern"],
      publishedAt: "2026-01-12T12:00:00.000Z",
      firstFetchedAt: "2026-01-16T08:00:00.000Z",
      status: "unseen",
      outdated: false,
    });
  });

  it("updates title, URL, locations and publication date of stored Jobs and keeps their status", async () => {
    const t = await setup();
    await t.follow("acme", "Acme");
    await t.act("Product Designer", "save");
    t.clock.set("2026-01-16T08:00:00Z");
    // Same Source, Job 1 edited.
    t.sources[board("acme")] = {
      body: {
        jobs: [
          {
            id: 1,
            title: "Senior Product Designer",
            absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1?v=2",
            location: { name: "Lausanne" },
            first_published: "2026-01-14T00:00:00Z",
          },
          { id: 2, title: "Backend Engineer", absolute_url: "https://job-boards.greenhouse.io/acme/jobs/2", location: { name: "Zürich" }, first_published: "2026-01-11T12:00:00Z" },
        ],
      },
    };

    const events = await t.refresh();

    expect(summaryOf(events)).toEqual({ new: 0, outdated: 0, failed: 0 });
    expect(await t.job("Product Designer")).toBeUndefined();
    expect(await t.job("Senior Product Designer")).toMatchObject({
      url: "https://job-boards.greenhouse.io/acme/jobs/1?v=2",
      locations: ["Lausanne"],
      publishedAt: "2026-01-14T00:00:00.000Z",
      firstFetchedAt: "2026-01-15T09:00:00.000Z",
      status: "saved",
    });
    expect(await t.jobs()).toHaveLength(2);
  });

  it("streams one progress line per Source, then the summary", async () => {
    const t = await setup({ sources: { [board("globex")]: greenhouse("globex", [analyst]) } });
    await t.follow("acme", "Acme");
    await t.follow("globex", "Globex");

    const events = await t.refresh();

    expect(events[0]).toEqual({ type: "start", total: 2 });
    const progress = events.filter((e) => e.type === "progress");
    expect(progress.map((e) => e.done)).toEqual([1, 2]);
    expect(progress.map((e) => e.total)).toEqual([2, 2]);
    expect(progress.map((e) => e.companyName).sort()).toEqual(["Acme", "Globex"]);
    expect(progress.every((e) => e.error === null)).toBe(true);
    expect(events).toHaveLength(4);
  });

  it("ends right away with an empty summary when no Company is followed", async () => {
    const t = await setup();

    expect(await t.refresh()).toEqual([
      { type: "start", total: 0 },
      { type: "done", summary: { new: 0, outdated: 0, failed: 0 } },
    ]);
  });
});

describe("Jobs that disappear from their Source", () => {
  it("deletes absent Unseen and Seen Jobs and flags absent Saved and Applied Jobs Outdated", async () => {
    const t = await setup();
    t.setBoard("acme", [designer, engineer, analyst, { id: 4, title: "Office Manager" }]);
    await t.follow("acme", "Acme");
    await t.act("Backend Engineer", "seen");
    await t.act("Data Analyst", "save");
    await t.act("Office Manager", "apply");
    t.setBoard("acme", []);

    const events = await t.refresh();

    expect(summaryOf(events)).toEqual({ new: 0, outdated: 4, failed: 0 });
    expect((await t.jobs()).map((j) => [j.title, j.status, j.outdated])).toEqual([
      ["Data Analyst", "saved", true],
      ["Office Manager", "applied", true],
    ]);
  });

  it("doesn't count an already Outdated Job again", async () => {
    const t = await setup();
    await t.follow("acme", "Acme");
    await t.act("Product Designer", "save");
    t.setBoard("acme", [engineer]);
    await t.refresh();

    const events = await t.refresh();

    expect(summaryOf(events)).toEqual({ new: 0, outdated: 0, failed: 0 });
    expect(await t.job("Product Designer")).toMatchObject({ status: "saved", outdated: true });
  });

  it("deletes an Outdated Job that is un-saved", async () => {
    const t = await setup();
    await t.follow("acme", "Acme");
    await t.act("Product Designer", "save");
    t.setBoard("acme", [engineer]);
    await t.refresh();

    expect(await t.act("Product Designer", "unsave")).toEqual({ job: null, deleted: true });
    expect(await t.job("Product Designer")).toBeUndefined();
  });

  it("deletes an Outdated Job un-marked Applied that was never Saved", async () => {
    const t = await setup();
    await t.follow("acme", "Acme");
    await t.act("Product Designer", "apply");
    t.setBoard("acme", [engineer]);
    await t.refresh();

    expect(await t.act("Product Designer", "unapply")).toEqual({ job: null, deleted: true });
  });

  it("puts an Outdated Job un-marked Applied that was Saved back in Saved, still Outdated", async () => {
    const t = await setup();
    await t.follow("acme", "Acme");
    await t.act("Product Designer", "save");
    await t.act("Product Designer", "apply");
    t.setBoard("acme", [engineer]);
    await t.refresh();

    const { job } = await t.act("Product Designer", "unapply");

    expect(job).toMatchObject({ status: "saved", outdated: true });
  });

  it("makes an Outdated Job that reappears current again, keeping its status", async () => {
    const t = await setup();
    await t.follow("acme", "Acme");
    await t.act("Product Designer", "apply");
    t.setBoard("acme", [engineer]);
    await t.refresh();
    t.setBoard("acme", [designer, engineer]);

    const events = await t.refresh();

    expect(summaryOf(events)).toEqual({ new: 0, outdated: 0, failed: 0 });
    expect(await t.job("Product Designer")).toMatchObject({
      status: "applied",
      outdated: false,
      firstFetchedAt: "2026-01-15T09:00:00.000Z",
    });
  });
});

/** A fetch wrapper that holds every answer until released, counting requests in flight. */
function gate() {
  const waiting: (() => void)[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let holding = false;
  return {
    get maxInFlight() {
      return maxInFlight;
    },
    get waiting() {
      return waiting.length;
    },
    hold() {
      holding = true;
    },
    release() {
      holding = false;
      waiting.splice(0).forEach((go) => go());
    },
    wrap: (recorded: typeof globalThis.fetch): typeof globalThis.fetch =>
      async (input, init) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (holding) await new Promise<void>((go) => waiting.push(go));
        // Let other reads start before this one answers.
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return recorded(input, init);
      },
  };
}

async function until(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((r) => setTimeout(r, 1));
  expect(condition()).toBe(true);
}

describe("one refresh at a time", () => {
  it("makes a second request join the running refresh instead of reading the Sources again", async () => {
    const g = gate();
    const t = await setup({ wrapFetch: g.wrap });
    await t.follow("acme", "Acme");
    t.setBoard("acme", [designer, engineer, analyst]);
    g.hold();
    const before = t.requested.length;

    const first = t.app.request("/api/refresh", { method: "POST" });
    await until(() => g.waiting === 1);
    const second = t.app.request("/api/refresh", { method: "POST" });
    g.release();
    const [a, b] = await Promise.all([readEvents(await first), readEvents(await second)]);

    expect(t.requested.length - before).toBe(1);
    expect(b).toEqual(a);
    expect(summaryOf(a)).toEqual({ new: 1, outdated: 0, failed: 0 });
    expect(await t.jobs()).toHaveLength(3);
  });

  it("starts a new refresh once the previous one is over", async () => {
    const t = await setup();
    await t.follow("acme", "Acme");
    await t.refresh();
    t.setBoard("acme", [designer, engineer, analyst]);

    expect(summaryOf(await t.refresh())).toEqual({ new: 1, outdated: 0, failed: 0 });
  });

  it("reads Sources with limited concurrency", async () => {
    const g = gate();
    const slugs = ["a1", "a2", "a3", "a4", "a5", "a6"];
    const t = await setup({
      wrapFetch: g.wrap,
      refreshConcurrency: 2,
      sources: Object.fromEntries(slugs.map((s) => [board(s), greenhouse(s, [analyst])])),
    });
    for (const slug of slugs) await t.follow(slug, slug.toUpperCase());

    const events = await t.refresh();

    expect(events.filter((e) => e.type === "progress")).toHaveLength(6);
    expect(g.maxInFlight).toBe(2);
  });
});

describe("a Source that fails", () => {
  it.each([
    ["answers HTTP 500", { status: 500, body: "boom" }, 'The Greenhouse board "acme" answered with an error (HTTP 500)'],
    ["answers HTTP 404", { status: 404, body: "gone" }, `The Greenhouse board "acme" doesn't exist (HTTP 404)`],
    ["can't be reached", null, `Couldn't reach the Greenhouse board "acme"`],
  ])("leaves its Jobs untouched and records the error on its Company when it %s", async (_, response, message) => {
    const t = await setup();
    await t.follow("acme", "Acme");
    await t.act("Product Designer", "save");
    const before = await t.jobs();
    t.clock.set("2026-01-16T08:00:00Z");
    if (response) t.sources[board("acme")] = response;
    else delete t.sources[board("acme")];

    const events = await t.refresh();

    expect(summaryOf(events)).toEqual({ new: 0, outdated: 0, failed: 1 });
    expect(events.find((e) => e.type === "progress")).toMatchObject({ companyName: "Acme", error: message });
    expect(await t.jobs()).toEqual(before);
    expect((await t.companies())[0]!.lastError).toEqual({ message, at: "2026-01-16T08:00:00.000Z" });
  });

  it("gives up on a Source that doesn't answer in time", async () => {
    let hang = false;
    const t = await setup({
      sourceTimeoutMs: 20,
      wrapFetch: (recorded) => (input, init) =>
        hang && String(input).includes("/slow/")
          ? new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))
          : recorded(input, init),
      sources: { [board("slow")]: greenhouse("slow", [analyst]) },
    });
    await t.follow("slow", "Slow");
    await t.follow("acme", "Acme");
    hang = true;

    const events = await t.refresh();

    expect(summaryOf(events)).toEqual({ new: 0, outdated: 0, failed: 1 });
    expect((await t.companies()).find((c) => c.name === "Slow")!.lastError!.message).toBe(
      `the Greenhouse board "slow" didn't answer in time`,
    );
    expect(await t.job("Data Analyst")).toMatchObject({ companyName: "Slow" });
  });

  it("doesn't stop the other Sources from being read", async () => {
    const t = await setup({ sources: { [board("globex")]: greenhouse("globex", [analyst]) } });
    await t.follow("acme", "Acme");
    await t.follow("globex", "Globex");
    t.sources[board("acme")] = { status: 503, body: "down" };
    t.setBoard("globex", [analyst, { id: 9, title: "Sales Lead" }]);

    const events = await t.refresh();

    expect(summaryOf(events)).toEqual({ new: 1, outdated: 0, failed: 1 });
    expect(await t.job("Sales Lead")).toMatchObject({ companyName: "Globex", status: "unseen" });
  });

  it("counts a read that can't be stored as failed, goes on and always ends the stream", async () => {
    let db: { close(): void } | undefined;
    const t = await setup({
      refreshConcurrency: 1,
      sources: { [board("globex")]: greenhouse("globex", [analyst]) },
      // The database goes away while the first Source is being read.
      wrapFetch: (recorded) => (input, init) => {
        db?.close();
        db = undefined;
        return recorded(input, init);
      },
    });
    await t.follow("acme", "Acme");
    await t.follow("globex", "Globex");
    db = t.db;

    const events = await t.refresh();

    expect(events.filter((e) => e.type === "progress").map((e) => "error" in e && typeof e.error)).toEqual([
      "string",
      "string",
    ]);
    expect(summaryOf(events)).toEqual({ new: 0, outdated: 0, failed: 2 });
  });

  it("clears the Company's error on the next successful read", async () => {
    const t = await setup();
    await t.follow("acme", "Acme");
    t.sources[board("acme")] = { status: 500, body: "boom" };
    await t.refresh();
    t.setBoard("acme", [designer, engineer]);

    await t.refresh();

    expect((await t.companies())[0]!.lastError).toBeNull();
  });
});
