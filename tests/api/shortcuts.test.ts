import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.ts";
import { openDatabase } from "../../src/server/db.ts";
import { createTestApp, TestClock } from "../support/test-app.ts";

/** The app on a database file, as if the container (re)started. */
function startApp(path: string) {
  const db = openDatabase(path);
  const app = createApp({ db, fetch: () => Promise.reject(new TypeError("offline")), clock: new TestClock() });
  return { request: (p: string, init?: RequestInit) => app.request(p, init), close: () => db.close() };
}

describe("Shortcuts API", () => {
  it("lists Jobup and Indeed Switzerland on first start", async () => {
    const { request } = createTestApp();

    const res = await request("GET", "/api/shortcuts");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      shortcuts: [
        { id: expect.any(Number), name: "Jobup", url: "https://www.jobup.ch" },
        { id: expect.any(Number), name: "Indeed Switzerland", url: "https://ch.indeed.com" },
      ],
    });
  });

  it("adds a Shortcut at the end of the list", async () => {
    const { request } = createTestApp();

    const res = await request("POST", "/api/shortcuts", {
      name: "  Acme careers ",
      url: "https://careers.acme.example/jobs",
    });

    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toEqual({
      shortcut: { id: expect.any(Number), name: "Acme careers", url: "https://careers.acme.example/jobs" },
    });
    const list = await (await request("GET", "/api/shortcuts")).json();
    expect(list.shortcuts.map((s: { name: string }) => s.name)).toEqual([
      "Jobup",
      "Indeed Switzerland",
      "Acme careers",
    ]);
  });

  it.each([
    ["not a link", "acme careers"],
    ["a non-web link", "ftp://acme.example/jobs"],
    ["an empty link", "   "],
  ])("refuses %s with a message", async (_label, url) => {
    const { request } = createTestApp();

    const res = await request("POST", "/api/shortcuts", { name: "Acme", url });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/link/i) });
    const list = await (await request("GET", "/api/shortcuts")).json();
    expect(list.shortcuts).toHaveLength(2);
  });

  it("renames a Shortcut and keeps its link and place", async () => {
    const { request } = createTestApp();
    const [jobup] = (await (await request("GET", "/api/shortcuts")).json()).shortcuts;

    const res = await request("PATCH", `/api/shortcuts/${jobup.id}`, { name: " jobup.ch " });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      shortcut: { id: jobup.id, name: "jobup.ch", url: "https://www.jobup.ch" },
    });
    const list = await (await request("GET", "/api/shortcuts")).json();
    expect(list.shortcuts.map((s: { name: string }) => s.name)).toEqual(["jobup.ch", "Indeed Switzerland"]);
  });

  it("changes a Shortcut's link and keeps its name and place", async () => {
    const { request } = createTestApp();
    const [jobup] = (await (await request("GET", "/api/shortcuts")).json()).shortcuts;

    const res = await request("PATCH", `/api/shortcuts/${jobup.id}`, { url: " https://www.jobup.ch/en/jobs " });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      shortcut: { id: jobup.id, name: "Jobup", url: "https://www.jobup.ch/en/jobs" },
    });
    const list = await (await request("GET", "/api/shortcuts")).json();
    expect(list.shortcuts.map((s: { url: string }) => s.url)).toEqual([
      "https://www.jobup.ch/en/jobs",
      "https://ch.indeed.com",
    ]);
  });

  it("changes a Shortcut's name and link together", async () => {
    const { request } = createTestApp();
    const [jobup] = (await (await request("GET", "/api/shortcuts")).json()).shortcuts;

    const res = await request("PATCH", `/api/shortcuts/${jobup.id}`, {
      name: "Jobup jobs",
      url: "http://jobup.example/jobs",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      shortcut: { id: jobup.id, name: "Jobup jobs", url: "http://jobup.example/jobs" },
    });
  });

  it.each([
    ["not a link", "jobup careers"],
    ["a non-web link", "ftp://jobup.example/jobs"],
    ["an empty link", "  "],
  ])("refuses %s as a new link and changes nothing", async (_label, url) => {
    const { request } = createTestApp();
    const [jobup] = (await (await request("GET", "/api/shortcuts")).json()).shortcuts;

    const res = await request("PATCH", `/api/shortcuts/${jobup.id}`, { name: "Jobup jobs", url });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Enter a valid web link, starting with https:// or http://.",
    });
    const list = await (await request("GET", "/api/shortcuts")).json();
    expect(list.shortcuts[0]).toEqual({ id: jobup.id, name: "Jobup", url: "https://www.jobup.ch" });
  });

  it("refuses a blank new name with a new link and changes nothing", async () => {
    const { request } = createTestApp();
    const [jobup] = (await (await request("GET", "/api/shortcuts")).json()).shortcuts;

    const res = await request("PATCH", `/api/shortcuts/${jobup.id}`, { name: "  ", url: "https://jobup.example" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Give the Shortcut a name." });
    const list = await (await request("GET", "/api/shortcuts")).json();
    expect(list.shortcuts[0]).toEqual({ id: jobup.id, name: "Jobup", url: "https://www.jobup.ch" });
  });

  it("refuses an update with neither a name nor a link", async () => {
    const { request } = createTestApp();
    const [jobup] = (await (await request("GET", "/api/shortcuts")).json()).shortcuts;

    const res = await request("PATCH", `/api/shortcuts/${jobup.id}`, {});

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
    const list = await (await request("GET", "/api/shortcuts")).json();
    expect(list.shortcuts[0]).toEqual({ id: jobup.id, name: "Jobup", url: "https://www.jobup.ch" });
  });

  it("refuses an empty new name", async () => {
    const { request } = createTestApp();
    const [jobup] = (await (await request("GET", "/api/shortcuts")).json()).shortcuts;

    const res = await request("PATCH", `/api/shortcuts/${jobup.id}`, { name: "" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/name/i) });
  });

  it("answers 404 when renaming an unknown Shortcut", async () => {
    const { request } = createTestApp();

    const res = await request("PATCH", "/api/shortcuts/999", { name: "Ghost" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });

  it("removes any Shortcut, including a default one", async () => {
    const { request } = createTestApp();
    const [jobup] = (await (await request("GET", "/api/shortcuts")).json()).shortcuts;

    const res = await request("DELETE", `/api/shortcuts/${jobup.id}`);

    expect(res.status).toBe(204);
    const list = await (await request("GET", "/api/shortcuts")).json();
    expect(list.shortcuts.map((s: { name: string }) => s.name)).toEqual(["Indeed Switzerland"]);
  });

  it("answers 404 when removing an unknown Shortcut", async () => {
    const { request } = createTestApp();

    const res = await request("DELETE", "/api/shortcuts/999");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });

  it("does not bring removed defaults back on the next start", async () => {
    const dir = mkdtempSync(join(tmpdir(), "job-watch-"));
    const path = join(dir, "job-watch.db");
    try {
      const first = startApp(path);
      for (const s of (await (await first.request("/api/shortcuts")).json()).shortcuts) {
        await first.request(`/api/shortcuts/${s.id}`, { method: "DELETE" });
      }
      first.close();

      const second = startApp(path);
      const list = await (await second.request("/api/shortcuts")).json();
      second.close();

      expect(list).toEqual({ shortcuts: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a Shortcut without a name", async () => {
    const { request } = createTestApp();

    const res = await request("POST", "/api/shortcuts", { name: " ", url: "https://acme.example" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/name/i) });
  });
});
