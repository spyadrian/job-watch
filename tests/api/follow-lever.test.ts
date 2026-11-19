import { describe, expect, it } from "vitest";
import { createTestApp } from "../support/test-app.ts";

const NORTHWIND_US = "https://api.lever.co/v0/postings/northwind?mode=json";
const ALPENBANK_EU = "https://api.eu.lever.co/v0/postings/alpenbank?mode=json";
const recorded = {
  [NORTHWIND_US]: { file: "tests/fixtures/sources/lever/northwind.json", contentType: "application/json" },
  [ALPENBANK_EU]: { file: "tests/fixtures/sources/lever/alpenbank-eu.json", contentType: "application/json" },
};

async function discoveredSources(input: string) {
  const { request } = createTestApp({ sources: recorded });
  const res = await request("POST", "/api/companies/discover", { input });
  expect(res.status).toBe(200);
  return (await res.json()).candidates.map((c: { source: unknown }) => c.source);
}

describe("discovering a Lever Company from a link", () => {
  it("reads a US board and reports N jobs found, saving nothing", async () => {
    const { request } = createTestApp({ sources: recorded });

    const res = await request("POST", "/api/companies/discover", { input: "https://jobs.lever.co/northwind" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidates: [
        {
          source: { type: "lever", key: "northwind" },
          sourceLabel: "Lever",
          suggestedName: "Northwind",
          jobCount: 3,
          alreadyFollowing: null,
        },
      ],
    });
    expect(await (await request("GET", "/api/jobs")).json()).toEqual({ jobs: [] });
  });

  it.each([
    "https://jobs.lever.co/northwind/",
    "https://jobs.lever.co/northwind/5f0c2a8e-1b7d-4e43-9a51-0a6b2c3d4e01",
    "https://jobs.lever.co/northwind/5f0c2a8e-1b7d-4e43-9a51-0a6b2c3d4e01/apply?lever-source=LinkedIn",
    "https://jobs.lever.co/northwind?department=Engineering",
    "https://api.lever.co/v0/postings/northwind?mode=json",
    "jobs.lever.co/NorthWind",
  ])("recognises %s as the Lever (US) board northwind", async (input) => {
    expect(await discoveredSources(input)).toEqual([{ type: "lever", key: "northwind" }]);
  });

  it.each([
    "https://jobs.eu.lever.co/alpenbank",
    "https://jobs.eu.lever.co/alpenbank/e7d6c5b4-a392-4817-b6f5-e4d3c2b1a001",
    "https://jobs.eu.lever.co/alpenbank/e7d6c5b4-a392-4817-b6f5-e4d3c2b1a001/apply",
    "https://api.eu.lever.co/v0/postings/alpenbank",
  ])("recognises %s as the Lever (EU) board alpenbank", async (input) => {
    expect(await discoveredSources(input)).toEqual([{ type: "lever-eu", key: "alpenbank" }]);
  });

  it("reads an EU board from the EU instance", async () => {
    const { request } = createTestApp({ sources: recorded });

    const res = await request("POST", "/api/companies/discover", { input: "https://jobs.eu.lever.co/alpenbank" });

    expect(await res.json()).toEqual({
      candidates: [
        {
          source: { type: "lever-eu", key: "alpenbank" },
          sourceLabel: "Lever (EU)",
          suggestedName: "Alpenbank",
          jobCount: 1,
          alreadyFollowing: null,
        },
      ],
    });
  });

  it("explains when the board doesn't exist", async () => {
    const { request, sources } = createTestApp();
    sources["https://api.lever.co/v0/postings/nope?mode=json"] = {
      status: 404,
      body: { ok: false, error: "Document not found" },
    };

    const res = await request("POST", "/api/companies/discover", { input: "https://jobs.lever.co/nope" });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('The Lever board "nope" doesn\'t exist (HTTP 404)');
  });

  it("refuses an answer in an unexpected format rather than reporting zero jobs", async () => {
    const { request, sources } = createTestApp();
    sources[NORTHWIND_US] = { body: { ok: true } };

    const res = await request("POST", "/api/companies/discover", { input: "https://jobs.lever.co/northwind" });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/unexpected format/);
  });
});

describe("following a Lever Company", () => {
  it("stores its Jobs with every raw location and the publication date", async () => {
    const { request } = createTestApp({ sources: recorded, now: "2026-01-15T09:00:00Z" });

    const res = await request("POST", "/api/companies", { source: { type: "lever", key: "northwind" }, name: "Northwind" });

    expect(res.status).toBe(201);
    const { jobs } = await (await request("GET", "/api/jobs")).json();
    expect(
      jobs.map((j: Record<string, unknown>) => ({ title: j.title, url: j.url, locations: j.locations, publishedAt: j.publishedAt })),
    ).toEqual([
      {
        title: "Platform Engineer",
        url: "https://jobs.lever.co/northwind/5f0c2a8e-1b7d-4e43-9a51-0a6b2c3d4e01",
        locations: ["Zürich", "Remote - Switzerland"],
        publishedAt: "2026-01-08T14:00:00.000Z",
      },
      {
        title: "Account Executive",
        url: "https://jobs.lever.co/northwind/8a1d3c55-6e2f-4b90-8c11-7f6e5d4c3b02",
        locations: ["Geneva, Switzerland"],
        publishedAt: "2026-01-10T16:45:00.000Z",
      },
      {
        title: "Operations Intern",
        url: "https://jobs.lever.co/northwind/c3b2a190-0f1e-4d2c-8b3a-29384756ab03",
        locations: [],
        publishedAt: null,
      },
    ]);
  });

  it("follows the same slug on the US and EU instances as two different Sources", async () => {
    const { request, sources } = createTestApp({ sources: recorded });
    sources["https://api.eu.lever.co/v0/postings/northwind?mode=json"] = { body: [] };

    const us = await request("POST", "/api/companies", { source: { type: "lever", key: "northwind" }, name: "Northwind" });
    const eu = await request("POST", "/api/companies", { source: { type: "lever-eu", key: "northwind" }, name: "Northwind EU" });

    expect(us.status).toBe(201);
    expect(eu.status).toBe(201);
    expect((await eu.json()).jobCount).toBe(0);
  });
});
