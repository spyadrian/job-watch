import { describe, expect, it } from "vitest";
import { createRecordedFetch } from "../../src/server/recorded-fetch.ts";

// The recorded fetch is shared test infrastructure (API tests and the Playwright
// server both use it), so its contract is pinned here.
describe("recorded fetch", () => {
  const fetch = createRecordedFetch({
    "https://boards-api.example.com/v1/boards/acme/jobs": { body: { jobs: [{ id: 1 }] } },
    "https://acme.example.com/feed?paged=2": { file: "tests/fixtures/sources/example/feed.xml", contentType: "application/rss+xml" },
    "https://down.example.com/": { status: 503, body: "Service Unavailable" },
  });

  it("serves an inline JSON body", async () => {
    const res = await fetch("https://boards-api.example.com/v1/boards/acme/jobs");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobs: [{ id: 1 }] });
  });

  it("serves a fixture file and ignores the _ cache-busting parameter", async () => {
    const res = await fetch("https://acme.example.com/feed?_=1736931600000&paged=2");
    expect(res.headers.get("content-type")).toBe("application/rss+xml");
    expect(await res.text()).toContain("<rss");
  });

  it("serves recorded error statuses", async () => {
    const res = await fetch("https://down.example.com/");
    expect(res.status).toBe(503);
  });

  it("fails like a network error for URLs that were not recorded", async () => {
    await expect(fetch("https://unknown.example.com/")).rejects.toThrow(TypeError);
  });
});
