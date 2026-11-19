import { createApp } from "../../src/server/app.ts";
import type { Clock } from "../../src/server/clock.ts";
import { openDatabase } from "../../src/server/db.ts";
import { createRecordedFetch, type RecordedSources } from "../../src/server/recorded-fetch.ts";

/** A clock the test moves by hand. */
export class TestClock implements Clock {
  current: Date;
  constructor(start: string | Date = "2026-01-15T09:00:00Z") {
    this.current = new Date(start);
  }
  now(): Date {
    return new Date(this.current);
  }
  set(at: string | Date): void {
    this.current = new Date(at);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export interface TestAppOptions {
  /** Recorded Source responses served by the injected fetch. Mutable via `sources`. */
  sources?: RecordedSources;
  now?: string | Date;
  /** Enables the test-only POST /api/test/reset. */
  testReset?: boolean;
  /** Wraps the recorded fetch, e.g. to hold or slow down answers. */
  wrapFetch?: (recorded: typeof globalThis.fetch) => typeof globalThis.fetch;
  sourceTimeoutMs?: number;
  refreshConcurrency?: number;
}

/**
 * The real Hono app, in-process, on a fresh in-memory SQLite database, with a
 * fetch that only serves recorded responses and a hand-driven clock.
 * Fixture `file` paths are resolved from the repository root.
 */
export function createTestApp(options: TestAppOptions = {}) {
  const sources: RecordedSources = { ...options.sources };
  const clock = new TestClock(options.now);
  const db = openDatabase(":memory:");
  // Rebuilt per call so tests can change `sources` between requests (e.g. a Job disappearing).
  const recorded: typeof globalThis.fetch = (input, init) => createRecordedFetch(sources)(input, init);
  const inner = options.wrapFetch ? options.wrapFetch(recorded) : recorded;
  const fetch: typeof globalThis.fetch = (input, init) => {
    requested.push(input instanceof Request ? input.url : String(input));
    return inner(input, init);
  };
  /** Every URL the server fetched, in order, exactly as requested. */
  const requested: string[] = [];
  const app = createApp({
    db,
    fetch,
    clock,
    testReset: options.testReset,
    sourceTimeoutMs: options.sourceTimeoutMs,
    refreshConcurrency: options.refreshConcurrency,
  });

  async function request(method: string, path: string, body?: unknown): Promise<Response> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { "content-type": "application/json" };
    }
    return app.request(path, init);
  }

  return { app, db, clock, sources, requested, request };
}
