import { describe, expect, it } from "vitest";
import type { Company, Filter, Job, Shortcut } from "../../src/shared/types.ts";
import { createTestApp } from "../support/test-app.ts";

const greenhouse = (slug: string) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
const sources = {
  [greenhouse("acme")]: { file: "tests/fixtures/sources/greenhouse/acme.json", contentType: "application/json" },
  [greenhouse("manyroles")]: { file: "tests/fixtures/sources/greenhouse/manyroles.json", contentType: "application/json" },
};

const geneva: Filter = {
  cities: [["Geneva", "Genève"]],
  required: ["engineer"],
  boosted: ["senior"],
  excluded: ["intern"],
  includeRemote: false,
};

function setup(now = "2026-01-15T09:00:00Z") {
  const app = createTestApp({ sources, now });
  async function follow(key: string, name: string): Promise<Company> {
    const res = await app.request("POST", "/api/companies", { source: { type: "greenhouse", key }, name });
    expect(res.status).toBe(201);
    return ((await res.json()) as { company: Company }).company;
  }
  async function get<T>(path: string): Promise<T> {
    const res = await app.request("GET", path);
    expect(res.status).toBe(200);
    return (await res.json()) as T;
  }
  const companies = async () => (await get<{ companies: Company[] }>("/api/companies")).companies;
  const shortcuts = async () => (await get<{ shortcuts: Shortcut[] }>("/api/shortcuts")).shortcuts;
  const filter = async () => (await get<{ filter: Filter }>("/api/filter")).filter;
  const jobs = async () => (await get<{ jobs: Job[] }>("/api/jobs")).jobs;
  const job = async (title: string) => (await jobs()).find((j) => j.title === title);
  async function act(title: string, action: string) {
    const target = await job(title);
    expect((await app.request("POST", `/api/jobs/${target!.id}/status`, { action })).status).toBe(200);
  }
  async function exportData(): Promise<Record<string, unknown>> {
    const res = await app.request("GET", "/api/export");
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown>;
  }
  async function importData(file: unknown, query = "") {
    const res = await app.request("POST", `/api/import${query}`, file);
    return { status: res.status, body: (await res.json()) as any };
  }
  return { ...app, follow, companies, shortcuts, filter, jobs, job, act, exportData, importData };
}

/** What a person sees of their data, without ids and fetch times that differ between instances. */
async function visibleState(t: ReturnType<typeof setup>) {
  return {
    companies: (await t.companies()).map((c) => ({ name: c.name, source: c.source })),
    shortcuts: (await t.shortcuts()).map((s) => ({ name: s.name, url: s.url })),
    filter: await t.filter(),
    jobs: (await t.jobs())
      .filter((j) => j.status !== "unseen")
      .map((j) => ({ companyName: j.companyName, title: j.title, status: j.status, wasSaved: j.wasSaved, outdated: j.outdated }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  };
}

/** An instance with Companies, an extra Shortcut, a Filter and Jobs in every status. */
async function populated() {
  const t = setup();
  await t.follow("acme", "Acme");
  await t.follow("manyroles", "Many Roles");
  await t.request("POST", "/api/shortcuts", { name: "Acme careers", url: "https://careers.acme.example" });
  await t.request("PUT", "/api/filter", geneva);
  await t.act("Senior Backend Engineer", "save");
  await t.act("Senior Backend Engineer", "apply");
  await t.act("Product Designer", "save");
  await t.act("Office Manager", "seen");
  return t;
}

describe("exporting all data", () => {
  it("downloads one dated JSON file with Companies, Shortcuts, the Filter and the Jobs dealt with", async () => {
    const t = await populated();
    t.clock.set("2026-03-02T10:00:00Z");

    const res = await t.request("GET", "/api/export");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="job-watch-2026-03-02.json"');
    const file = (await res.json()) as any;
    expect(file).toMatchObject({ format: "job-watch", version: 1, exportedAt: "2026-03-02T10:00:00.000Z" });
    expect(file.companies).toEqual([
      { name: "Acme", source: { type: "greenhouse", key: "acme" } },
      { name: "Many Roles", source: { type: "greenhouse", key: "manyroles" } },
    ]);
    expect(file.shortcuts).toEqual([
      { name: "Jobup", url: "https://www.jobup.ch", position: 0 },
      { name: "Indeed Switzerland", url: "https://ch.indeed.com", position: 1 },
      { name: "Acme careers", url: "https://careers.acme.example", position: 2 },
    ]);
    expect(file.filter).toEqual(geneva);
    expect(file.jobs).toContainEqual({
      source: { type: "greenhouse", key: "acme" },
      sourceJobId: "4012001",
      companyName: "Acme",
      title: "Senior Backend Engineer",
      url: expect.any(String),
      locations: expect.any(Array),
      publishedAt: expect.anything(),
      firstFetchedAt: "2026-01-15T09:00:00.000Z",
      status: "applied",
      wasSaved: true,
      outdated: false,
    });
    expect(file.jobs.map((j: Job) => j.status).sort()).toEqual(["applied", "saved", "seen"]);
  });

  it("leaves Unseen Jobs out: the next Refresh reads them again", async () => {
    const t = setup();
    await t.follow("acme", "Acme");

    expect((await t.exportData()).jobs).toEqual([]);
  });

  it("includes the Saved and Applied Jobs kept after their Company was removed, under its kept name", async () => {
    const t = await populated();
    const acme = (await t.companies()).find((c) => c.name === "Acme")!;
    await t.request("DELETE", `/api/companies/${acme.id}`);

    const file = (await t.exportData()) as any;

    expect(file.companies.map((c: Company) => c.name)).toEqual(["Many Roles"]);
    expect(file.jobs).toContainEqual(
      expect.objectContaining({ companyName: "Acme", title: "Product Designer", status: "saved", outdated: true }),
    );
  });
});

describe("importing a file", () => {
  it("reproduces Companies, Shortcuts, the Filter and Job statuses in an empty instance", async () => {
    const from = await populated();
    const file = await from.exportData();
    const to = setup();

    const { status, body } = await to.importData(file);

    expect(status).toBe(200);
    expect(body).toEqual({
      companies: { added: 2, alreadyFollowed: 0 },
      shortcuts: { added: 1, skipped: 2 },
      filter: "replaced",
      jobs: { added: 3, statusesRestored: 0, skipped: 0 },
    });
    expect(await visibleState(to)).toEqual(await visibleState(from));
  });

  it("reads no Source", async () => {
    const file = await (await populated()).exportData();
    const to = setup();

    await to.importData(file);

    expect(to.requested).toEqual([]);
  });

  it("lets the next Refresh read the new Companies' Jobs, keeping the imported statuses", async () => {
    const file = await (await populated()).exportData();
    const to = setup();
    await to.importData(file);

    await (await to.request("POST", "/api/refresh")).text();

    expect((await to.job("Senior Backend Engineer"))?.status).toBe("applied");
    expect((await to.job("Office Manager"))?.status).toBe("seen");
    expect((await to.jobs()).filter((j) => j.status === "unseen").length).toBeGreaterThan(0);
    expect((await to.jobs()).filter((j) => j.title === "Senior Backend Engineer")).toHaveLength(1);
  });

  it("brings back kept Jobs of a removed Company without following it", async () => {
    const from = await populated();
    const acme = (await from.companies()).find((c) => c.name === "Acme")!;
    await from.request("DELETE", `/api/companies/${acme.id}`);
    const to = setup();

    await to.importData(await from.exportData());

    expect((await to.companies()).map((c) => c.name)).toEqual(["Many Roles"]);
    expect(await to.job("Product Designer")).toMatchObject({ companyName: "Acme", status: "saved", outdated: true });
    expect(await to.job("Senior Backend Engineer")).toMatchObject({ status: "applied", wasSaved: true, outdated: true });
  });

  it("adds nothing the second time the same file is imported", async () => {
    const file = await (await populated()).exportData();
    const to = setup();
    await to.importData(file);
    const before = await visibleState(to);

    const { body } = await to.importData(file);

    expect(body).toEqual({
      companies: { added: 0, alreadyFollowed: 2 },
      shortcuts: { added: 0, skipped: 3 },
      filter: "kept",
      jobs: { added: 0, statusesRestored: 0, skipped: 3 },
    });
    expect(await visibleState(to)).toEqual(before);
  });

  it("is idempotent for kept Jobs of removed Companies too", async () => {
    const from = await populated();
    const acme = (await from.companies()).find((c) => c.name === "Acme")!;
    await from.request("DELETE", `/api/companies/${acme.id}`);
    const file = await from.exportData();
    const to = setup();
    await to.importData(file);

    const { body } = await to.importData(file);

    expect(body.jobs).toEqual({ added: 0, statusesRestored: 0, skipped: 2 });
    expect((await to.jobs()).filter((j) => j.title === "Product Designer")).toHaveLength(1);
  });
});

describe("importing into an instance that already has data", () => {
  it("follows only new Sources and adds only new Shortcut links, at the end in file order", async () => {
    const file = await (await populated()).exportData();
    const to = setup();
    await to.follow("acme", "Acme Corp");
    await to.request("POST", "/api/shortcuts", { name: "Mine", url: "https://mine.example" });

    const { body } = await to.importData(file);

    expect(body.companies).toEqual({ added: 1, alreadyFollowed: 1 });
    expect(body.shortcuts).toEqual({ added: 1, skipped: 2 });
    expect((await to.companies()).map((c) => c.name)).toEqual(["Acme Corp", "Many Roles"]);
    expect((await to.shortcuts()).map((s) => s.name)).toEqual(["Jobup", "Indeed Switzerland", "Mine", "Acme careers"]);
  });

  it("moves a stored Job's status forward but never back", async () => {
    const file = await (await populated()).exportData();
    const to = setup();
    await to.follow("acme", "Acme");
    // Stored: Senior Backend Engineer Unseen (file: Applied, was Saved), Product Designer Applied
    // (file: Saved), Office Manager Saved (file: Seen).
    await to.act("Product Designer", "apply");
    await to.act("Office Manager", "save");

    const { body } = await to.importData(file);

    expect(body.jobs).toEqual({ added: 0, statusesRestored: 1, skipped: 2 });
    expect(await to.job("Senior Backend Engineer")).toMatchObject({ status: "applied", wasSaved: true });
    expect(await to.job("Product Designer")).toMatchObject({ status: "applied", wasSaved: false });
    expect(await to.job("Office Manager")).toMatchObject({ status: "saved", wasSaved: false });
  });

  it("marks a Saved Job Applied as Was Saved", async () => {
    const from = setup();
    await from.follow("acme", "Acme");
    await from.act("Office Manager", "apply");
    const to = setup();
    await to.follow("acme", "Acme");
    await to.act("Office Manager", "save");

    await to.importData(await from.exportData());

    expect(await to.job("Office Manager")).toMatchObject({ status: "applied", wasSaved: true });
  });

  it("keeps a non-empty Filter unless asked to replace it", async () => {
    const file = await (await populated()).exportData();
    const mine: Filter = { cities: [], required: [], boosted: ["rust"], excluded: [], includeRemote: true };
    const to = setup();
    await to.request("PUT", "/api/filter", mine);

    expect((await to.importData(file)).body.filter).toBe("kept");
    expect(await to.filter()).toEqual(mine);

    expect((await to.importData(file, "?filter=replace")).body.filter).toBe("replaced");
    expect(await to.filter()).toEqual(geneva);
  });

  it("keeps the Filter when asked to, even if empty", async () => {
    const file = await (await populated()).exportData();
    const to = setup();
    const before = await to.filter();

    expect((await to.importData(file, "?filter=keep")).body.filter).toBe("kept");
    expect(await to.filter()).toEqual(before);
  });
});

describe("an invalid file", () => {
  async function refused(file: unknown, message: RegExp, raw = false) {
    const to = setup();
    const before = await visibleState(to);
    const res = raw
      ? await to.app.request("/api/import", { method: "POST", body: String(file), headers: { "content-type": "application/json" } })
      : await to.request("POST", "/api/import", file);

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(message);
    expect(await visibleState(to)).toEqual(before);
  }

  it("is refused when it isn't JSON", async () => {
    await refused("not json {", /isn't a Job Watch export/i, true);
  });

  it("is refused when it isn't a Job Watch export", async () => {
    await refused({ format: "something-else", version: 1 }, /isn't a Job Watch export/i);
  });

  it("is refused when it comes from an unknown version", async () => {
    const file = await (await populated()).exportData();
    await refused({ ...file, version: 99 }, /version 99/i);
  });

  it("is refused, changing nothing, when one part has the wrong shape", async () => {
    const file = (await (await populated()).exportData()) as any;
    // The Companies and Shortcuts are fine; only the last Job is broken.
    const jobs = [...file.jobs, { ...file.jobs[0], sourceJobId: "x", status: "archived" }];
    await refused({ ...file, jobs }, /Job/);
  });

  it("is refused when a Company has an unknown Source type", async () => {
    const file = (await (await populated()).exportData()) as any;
    await refused({ ...file, companies: [{ name: "X", source: { type: "nope", key: "x" } }] }, /Source type/i);
  });
});
