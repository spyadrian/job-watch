import { describe, expect, it } from "vitest";
import type { Job } from "../../src/shared/types.ts";
import { createTestApp } from "../support/test-app.ts";

const ACME_JOBS = "https://boards-api.greenhouse.io/v1/boards/acme/jobs";
const acme = { [ACME_JOBS]: { file: "tests/fixtures/sources/greenhouse/acme.json", contentType: "application/json" } };

/** A test app following Acme (3 Unseen Jobs), with helpers to act on one of its Jobs. */
async function setup() {
  const app = createTestApp({ sources: acme });
  const followed = await app.request("POST", "/api/companies", { source: { type: "greenhouse", key: "acme" }, name: "Acme" });
  expect(followed.status).toBe(201);
  const jobs = await listJobs();
  const id = jobs[0]!.id;

  async function listJobs(): Promise<Job[]> {
    return ((await (await app.request("GET", "/api/jobs")).json()) as { jobs: Job[] }).jobs;
  }
  async function act(action: string, jobId = id) {
    const res = await app.request("POST", `/api/jobs/${jobId}/status`, { action });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }
  async function job(jobId = id): Promise<Job | undefined> {
    return (await listJobs()).find((j) => j.id === jobId);
  }
  /** Seeds the Outdated flag; nothing in the API can set it yet (refresh is ticket 05). */
  function makeOutdated(jobId = id) {
    app.db.prepare("UPDATE job SET outdated = 1 WHERE id = ?").run(jobId);
  }
  return { ...app, id, act, job, listJobs, makeOutdated };
}

/** Brings the Job to a status by a valid path from Unseen. */
async function reach(t: Awaited<ReturnType<typeof setup>>, path: string[]) {
  for (const action of path) expect((await t.act(action)).status).toBe(200);
}

describe("changing a Job's status (spec status table)", () => {
  it("Mark Seen: Unseen → Seen", async () => {
    const t = await setup();

    const res = await t.act("seen");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ job: expect.objectContaining({ id: t.id, status: "seen", wasSaved: false }) });
    expect(await t.job()).toMatchObject({ status: "seen", wasSaved: false });
  });

  // [row, path from Unseen to the "From" status, action, expected status, expected flag]
  it.each([
    ["Un-mark Seen: Seen → Unseen", ["seen"], "unseen", "unseen", false],
    ["Save: Unseen → Saved", [], "save", "saved", false],
    ["Save: Seen → Saved", ["seen"], "save", "saved", false],
    ["Un-save: Saved → Seen", ["save"], "unsave", "seen", false],
    ["Mark Applied: Unseen → Applied (flag off)", [], "apply", "applied", false],
    ["Mark Applied: Seen → Applied (flag off)", ["seen"], "apply", "applied", false],
    ["Mark Applied: Saved → Applied (flag on)", ["save"], "apply", "applied", true],
    ["Un-mark Applied, flag on: Applied → Saved", ["save", "apply"], "unapply", "saved", false],
    ["Un-mark Applied, flag off: Applied → Seen", ["apply"], "unapply", "seen", false],
    ["Un-mark Applied, flag off, after Seen: Applied → Seen", ["seen", "apply"], "unapply", "seen", false],
  ] as const)("%s", async (_row, path, action, status, wasSaved) => {
    const t = await setup();
    await reach(t, [...path]);

    const res = await t.act(action);

    expect(res.status).toBe(200);
    expect(res.body.job).toMatchObject({ id: t.id, status, wasSaved, outdated: false });
    expect(await t.job()).toMatchObject({ status, wasSaved });
  });

  it("changes only the Job acted on", async () => {
    const t = await setup();

    await t.act("save");

    const others = (await t.listJobs()).filter((j) => j.id !== t.id);
    expect(others.map((j) => j.status)).toEqual(["unseen", "unseen"]);
  });

  it.each([
    [[], "unseen"],
    [[], "unsave"],
    [[], "unapply"],
    [["seen"], "seen"],
    [["save"], "seen"],
    [["save"], "unseen"],
    [["save"], "save"],
    [["apply"], "apply"],
    [["apply"], "save"],
    [["apply"], "seen"],
    [["apply"], "unsave"],
  ] as const)("refuses an action outside the table (after %j: %s) with 409 and changes nothing", async (path, action) => {
    const t = await setup();
    await reach(t, [...path]);
    const before = await t.job();

    const res = await t.act(action);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(await t.job()).toEqual(before);
  });

  it("answers 404 for an unknown Job", async () => {
    const t = await setup();

    const res = await t.act("seen", 9999);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it.each([{}, { action: "dismiss" }, { action: 3 }])("answers 400 for a bad body %j", async (body) => {
    const t = await setup();

    const res = await t.request("POST", `/api/jobs/${t.id}/status`, body);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });
});

describe("status changes on an Outdated Job", () => {
  it("Un-save deletes an Outdated Job instead of moving it to Seen", async () => {
    const t = await setup();
    await reach(t, ["save"]);
    t.makeOutdated();

    const res = await t.act("unsave");

    expect(res).toEqual({ status: 200, body: { job: null, deleted: true } });
    expect(await t.job()).toBeUndefined();
  });

  it("Un-mark Applied without the flag deletes an Outdated Job", async () => {
    const t = await setup();
    await reach(t, ["apply"]);
    t.makeOutdated();

    const res = await t.act("unapply");

    expect(res).toEqual({ status: 200, body: { job: null, deleted: true } });
    expect(await t.job()).toBeUndefined();
  });

  it("Un-mark Applied with the flag moves it back to Saved, still Outdated", async () => {
    const t = await setup();
    await reach(t, ["save", "apply"]);
    t.makeOutdated();

    const res = await t.act("unapply");

    expect(res.status).toBe(200);
    expect(res.body.job).toMatchObject({ status: "saved", wasSaved: false, outdated: true });
  });

  it("Mark Applied on a Saved Outdated Job keeps it Outdated", async () => {
    const t = await setup();
    await reach(t, ["save"]);
    t.makeOutdated();

    const res = await t.act("apply");

    expect(res.body.job).toMatchObject({ status: "applied", wasSaved: true, outdated: true });
  });
});

describe("undoing the last status change", () => {
  // Undo puts the Job back in its previous status, which the inverse action alone can't always
  // do (un-saving a Job saved from the Inbox would land in Seen, not back in the Inbox).
  it.each([
    [[], "seen"],
    [["seen"], "unseen"],
    [[], "save"],
    [["seen"], "save"],
    [["save"], "unsave"],
    [[], "apply"],
    [["save"], "apply"],
    [["save", "apply"], "unapply"],
    [["seen", "apply"], "unapply"],
  ] as const)("after %j then %s, restores the previous status and flag", async (path, action) => {
    const t = await setup();
    await reach(t, [...path]);
    const before = (await t.job())!;
    await t.act(action);

    const res = await t.request("POST", `/api/jobs/${t.id}/undo`, { status: before.status, wasSaved: before.wasSaved });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ job: before });
    expect(await t.job()).toEqual(before);
  });

  it.each([{}, { status: "dismissed", wasSaved: false }, { status: "seen" }, { status: "seen", wasSaved: true }])(
    "answers 400 for a bad body %j",
    async (body) => {
      const t = await setup();

      const res = await t.request("POST", `/api/jobs/${t.id}/undo`, body);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: expect.any(String) });
    },
  );

  it("answers 404 when the Job is gone", async () => {
    const t = await setup();

    const res = await t.request("POST", "/api/jobs/9999/undo", { status: "unseen", wasSaved: false });

    expect(res.status).toBe(404);
  });
});

describe("persistence", () => {
  it("keeps statuses across a restart on the same database file", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { createApp } = await import("../../src/server/app.ts");
    const { openDatabase } = await import("../../src/server/db.ts");
    const { createRecordedFetch } = await import("../../src/server/recorded-fetch.ts");
    const dir = mkdtempSync(join(tmpdir(), "job-watch-"));
    try {
      const file = join(dir, "job-watch.db");
      const deps = { fetch: createRecordedFetch(acme), clock: { now: () => new Date("2026-01-15T09:00:00Z") } };
      const first = createApp({ ...deps, db: openDatabase(file) });
      await first.request("/api/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: { type: "greenhouse", key: "acme" }, name: "Acme" }),
      });
      const [a, b] = ((await (await first.request("/api/jobs")).json()) as { jobs: Job[] }).jobs;
      for (const [id, action] of [[a!.id, "save"], [a!.id, "apply"], [b!.id, "seen"]] as const) {
        await first.request(`/api/jobs/${id}/status`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        });
      }

      const second = createApp({ ...deps, db: openDatabase(file) });
      const jobs = ((await (await second.request("/api/jobs")).json()) as { jobs: Job[] }).jobs;

      expect(jobs.map((j) => [j.status, j.wasSaved])).toEqual([
        ["applied", true],
        ["seen", false],
        ["unseen", false],
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
