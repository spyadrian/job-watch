import { describe, expect, it } from "vitest";
import type { Company, Job } from "../../src/shared/types.ts";
import { createTestApp } from "../support/test-app.ts";

const greenhouse = (slug: string) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
const sources = {
  [greenhouse("acme")]: { file: "tests/fixtures/sources/greenhouse/acme.json", contentType: "application/json" },
  [greenhouse("manyroles")]: { file: "tests/fixtures/sources/greenhouse/manyroles.json", contentType: "application/json" },
};

async function setup() {
  const app = createTestApp({ sources, now: "2026-01-15T09:00:00Z" });
  async function follow(key: string, name: string): Promise<Company> {
    const res = await app.request("POST", "/api/companies", { source: { type: "greenhouse", key }, name });
    expect(res.status).toBe(201);
    return ((await res.json()) as { company: Company }).company;
  }
  async function companies(): Promise<Company[]> {
    const res = await app.request("GET", "/api/companies");
    expect(res.status).toBe(200);
    return ((await res.json()) as { companies: Company[] }).companies;
  }
  async function jobs(): Promise<Job[]> {
    return ((await (await app.request("GET", "/api/jobs")).json()) as { jobs: Job[] }).jobs;
  }
  async function act(jobId: number, action: string) {
    expect((await app.request("POST", `/api/jobs/${jobId}/status`, { action })).status).toBe(200);
  }
  return { ...app, follow, companies, jobs, act };
}

describe("listing followed Companies", () => {
  it("is empty before following anything", async () => {
    const t = await setup();

    expect(await t.companies()).toEqual([]);
  });

  it("lists every followed Company by name with its Source type and no error", async () => {
    const t = await setup();
    await t.follow("manyroles", "Many Roles");
    t.clock.advance(60_000);
    await t.follow("acme", "Acme");

    expect(await t.companies()).toEqual([
      {
        id: expect.any(Number),
        name: "Acme",
        source: { type: "greenhouse", key: "acme" },
        sourceLabel: "Greenhouse",
        createdAt: "2026-01-15T09:01:00.000Z",
        lastError: null,
      },
      {
        id: expect.any(Number),
        name: "Many Roles",
        source: { type: "greenhouse", key: "manyroles" },
        sourceLabel: "Greenhouse",
        createdAt: "2026-01-15T09:00:00.000Z",
        lastError: null,
      },
    ]);
  });
});

describe("a Company whose Source failed on the last read", () => {
  it("carries the reason and the time of the failure", async () => {
    const t = await setup();
    const acme = await t.follow("acme", "Acme");
    // Nothing in the API records a failed read yet (refresh is ticket 05).
    t.db
      .prepare("UPDATE company SET last_error = ?, last_error_at = ? WHERE id = ?")
      .run('the Greenhouse board "acme" answered 500', "2026-01-15T10:00:00.000Z", acme.id);

    expect((await t.companies())[0]!.lastError).toEqual({
      message: 'the Greenhouse board "acme" answered 500',
      at: "2026-01-15T10:00:00.000Z",
    });
  });
});

describe("renaming a Company", () => {
  it("changes its name in the list and on all its Jobs", async () => {
    const t = await setup();
    const acme = await t.follow("acme", "Acme");
    await t.follow("manyroles", "Many Roles");

    const res = await t.request("PATCH", `/api/companies/${acme.id}`, { name: "  Acme Corp " });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ company: { ...acme, name: "Acme Corp" } });
    expect((await t.companies()).map((c) => c.name)).toEqual(["Acme Corp", "Many Roles"]);
    const jobs = await t.jobs();
    expect(jobs.filter((j) => j.companyName === "Acme Corp")).toHaveLength(3);
    expect(jobs.filter((j) => j.companyName === "Acme")).toHaveLength(0);
  });

  it("refuses an empty name and keeps the old one", async () => {
    const t = await setup();
    const acme = await t.follow("acme", "Acme");

    const res = await t.request("PATCH", `/api/companies/${acme.id}`, { name: "   " });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Give the Company a name." });
    expect((await t.companies())[0]!.name).toBe("Acme");
  });

  it("answers 404 for a Company that is not followed", async () => {
    const t = await setup();

    const res = await t.request("PATCH", "/api/companies/999", { name: "Ghost" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "This Company is no longer followed." });
  });
});

describe("a Source reference is unique", () => {
  it('refuses to follow it again with "Already following <Company>" and saves nothing', async () => {
    const t = await setup();
    const acme = await t.follow("acme", "Acme");
    await t.request("PATCH", `/api/companies/${acme.id}`, { name: "Acme Corp" });

    const res = await t.request("POST", "/api/companies", { source: { type: "greenhouse", key: "acme" }, name: "Acme 2" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Already following Acme Corp" });
    expect((await t.companies()).map((c) => c.name)).toEqual(["Acme Corp"]);
    expect(await t.jobs()).toHaveLength(3);
  });

  it("flags the candidate at discovery with the Company's current name", async () => {
    const t = await setup();
    const acme = await t.follow("acme", "Acme");
    await t.request("PATCH", `/api/companies/${acme.id}`, { name: "Acme Corp" });

    const res = await t.request("POST", "/api/companies/discover", { input: "https://boards.greenhouse.io/acme" });

    expect(res.status).toBe(200);
    expect((await res.json()).candidates).toEqual([expect.objectContaining({ alreadyFollowing: "Acme Corp" })]);
  });
});

describe("removing a Company", () => {
  /** Follows Acme (3 Jobs) and puts one Job in each of Seen, Saved and Applied; the fourth stays Unseen. */
  async function acmeInEveryList() {
    const t = await setup();
    await t.follow("manyroles", "Many Roles");
    const acme = await t.follow("acme", "Acme");
    await t.request("PATCH", `/api/companies/${acme.id}`, { name: "Acme Corp" });
    const [seen, saved, applied] = (await t.jobs()).filter((j) => j.companyName === "Acme Corp");
    await t.act(seen!.id, "seen");
    await t.act(saved!.id, "save");
    await t.act(applied!.id, "apply");
    return { ...t, acme, seen: seen!, saved: saved!, applied: applied! };
  }

  it("stops following it", async () => {
    const t = await acmeInEveryList();

    const res = await t.request("DELETE", `/api/companies/${t.acme.id}`);

    expect(res.status).toBe(204);
    expect((await t.companies()).map((c) => c.name)).toEqual(["Many Roles"]);
  });

  it("deletes its Unseen and Seen Jobs and leaves other Companies' Jobs alone", async () => {
    const t = await acmeInEveryList();
    const manyRoles = (await t.jobs()).filter((j) => j.companyName === "Many Roles");

    await t.request("DELETE", `/api/companies/${t.acme.id}`);

    const jobs = await t.jobs();
    expect(jobs.find((j) => j.id === t.seen.id)).toBeUndefined();
    expect(jobs.filter((j) => j.companyName === "Acme Corp" && (j.status === "unseen" || j.status === "seen"))).toEqual([]);
    expect(jobs.filter((j) => j.companyName === "Many Roles")).toEqual(manyRoles);
  });

  it("keeps its Saved and Applied Jobs, marked Outdated, with the Company's name", async () => {
    const t = await acmeInEveryList();

    await t.request("DELETE", `/api/companies/${t.acme.id}`);

    const kept = (await t.jobs()).filter((j) => j.companyName !== "Many Roles");
    expect(kept).toEqual([
      { ...t.saved, status: "saved", outdated: true, companyName: "Acme Corp" },
      { ...t.applied, status: "applied", outdated: true, companyName: "Acme Corp" },
    ]);
  });

  it("keeps an Applied Job's was-Saved flag, so un-marking Applied returns it to Saved", async () => {
    const t = await acmeInEveryList();
    await t.act(t.saved.id, "apply");

    await t.request("DELETE", `/api/companies/${t.acme.id}`);

    const res = await t.request("POST", `/api/jobs/${t.saved.id}/status`, { action: "unapply" });
    expect((await res.json()).job).toMatchObject({ status: "saved", outdated: true, companyName: "Acme Corp" });
  });

  it("lets the same Source be followed again afterwards, alongside the kept Jobs", async () => {
    const t = await acmeInEveryList();
    await t.request("DELETE", `/api/companies/${t.acme.id}`);

    await t.follow("acme", "Acme");

    const acmeJobs = (await t.jobs()).filter((j) => j.companyName.startsWith("Acme"));
    expect(acmeJobs.map((j) => [j.companyName, j.status, j.outdated])).toEqual([
      ["Acme Corp", "saved", true],
      ["Acme Corp", "applied", true],
      ["Acme", "unseen", false],
      ["Acme", "unseen", false],
      ["Acme", "unseen", false],
    ]);
  });

  it("answers 404 for a Company that is not followed", async () => {
    const t = await setup();

    const res = await t.request("DELETE", "/api/companies/999");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "This Company is no longer followed." });
  });
});
