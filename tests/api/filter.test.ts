import { describe, expect, it } from "vitest";
import type { Filter, Job } from "../../src/shared/types.ts";
import { createTestApp } from "../support/test-app.ts";

const ACME_JOBS = "https://boards-api.greenhouse.io/v1/boards/acme/jobs";
const acme = { [ACME_JOBS]: { file: "tests/fixtures/sources/greenhouse/acme.json", contentType: "application/json" } };

describe("the Filter", () => {
  it("starts empty", async () => {
    const { request } = createTestApp();

    const res = await request("GET", "/api/filter");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      filter: { cities: [], required: [], boosted: [], excluded: [], includeRemote: true },
    });
  });

  it("is replaced and read back", async () => {
    const { request } = createTestApp();
    const filter: Filter = {
      cities: [["Geneva", "Genève", "Genf"], ["Lausanne"]],
      required: ["engineer"],
      boosted: ["react"],
      excluded: ["intern"],
      includeRemote: false,
    };

    const put = await request("PUT", "/api/filter", filter);
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ filter });

    expect(await (await request("GET", "/api/filter")).json()).toEqual({ filter });
  });

  it("trims words and drops blank ones and empty City filters", async () => {
    const { request } = createTestApp();

    await request("PUT", "/api/filter", {
      cities: [[" Geneva ", ""], ["  "]],
      required: [" engineer ", ""],
      boosted: [],
      excluded: ["   "],
      includeRemote: true,
    });

    expect(await (await request("GET", "/api/filter")).json()).toEqual({
      filter: { cities: [["Geneva"]], required: ["engineer"], boosted: [], excluded: [], includeRemote: true },
    });
  });

  it.each([
    ["not an object", "nope"],
    ["missing lists", { cities: [] }],
    ["a City filter that is not a list", { cities: ["Geneva"], required: [], boosted: [], excluded: [], includeRemote: true }],
    ["a keyword that is not text", { cities: [], required: [42], boosted: [], excluded: [], includeRemote: true }],
    ["a missing Include remote Jobs", { cities: [], required: [], boosted: [], excluded: [] }],
    ["an Include remote Jobs that is not true or false", { cities: [], required: [], boosted: [], excluded: [], includeRemote: "no" }],
  ])("refuses %s with a message, keeping the saved Filter", async (_, body) => {
    const { request } = createTestApp();
    await request("PUT", "/api/filter", { cities: [], required: ["engineer"], boosted: [], excluded: [], includeRemote: true });

    const res = await request("PUT", "/api/filter", body);

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Filter/);
    expect(((await (await request("GET", "/api/filter")).json()) as { filter: Filter }).filter.required).toEqual([
      "engineer",
    ]);
  });
});

describe("Mark all as seen", () => {
  async function setup() {
    const app = createTestApp({ sources: acme });
    expect(
      (await app.request("POST", "/api/companies", { source: { type: "greenhouse", key: "acme" }, name: "Acme" })).status,
    ).toBe(201);
    const listJobs = async () => ((await (await app.request("GET", "/api/jobs")).json()) as { jobs: Job[] }).jobs;
    return { ...app, listJobs, ids: (await listJobs()).map((j) => j.id) };
  }

  it("marks exactly the given Jobs Seen in one request, leaving the others Unseen", async () => {
    const t = await setup();
    const [a, b, c] = t.ids as [number, number, number];

    const res = await t.request("POST", "/api/jobs/seen", { ids: [a, c] });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { jobs: Job[] };
    expect(body.jobs.map((j) => [j.id, j.status])).toEqual([
      [a, "seen"],
      [c, "seen"],
    ]);
    const statuses = Object.fromEntries((await t.listJobs()).map((j) => [j.id, j.status]));
    expect(statuses).toEqual({ [a]: "seen", [b]: "unseen", [c]: "seen" });
  });

  it("leaves Jobs that are no longer Unseen (or no longer exist) alone", async () => {
    const t = await setup();
    const [a, b] = t.ids as [number, number];
    expect((await t.request("POST", `/api/jobs/${a}/status`, { action: "save" })).status).toBe(200);

    const res = await t.request("POST", "/api/jobs/seen", { ids: [a, b, 9999] });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { jobs: Job[] }).jobs.map((j) => j.id)).toEqual([b]);
    expect((await t.listJobs()).find((j) => j.id === a)!.status).toBe("saved");
  });

  it.each([["no body", undefined], ["ids not a list", { ids: 3 }], ["ids not numbers", { ids: ["1"] }]])(
    "refuses %s",
    async (_, body) => {
      const t = await setup();

      const res = await t.request("POST", "/api/jobs/seen", body);

      expect(res.status).toBe(400);
      expect((await t.listJobs()).every((j) => j.status === "unseen")).toBe(true);
    },
  );
});
