// Process entry point: wires real (or recorded) dependencies, serves the built
// front end and the API. Run directly with Node's TypeScript type stripping.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.ts";
import { systemClock } from "./clock.ts";
import { openDatabase } from "./db.ts";
import { loadRecordedFetch } from "./recorded-fetch.ts";

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "127.0.0.1";
const dbPath = process.env.JOB_WATCH_DB ?? "data/job-watch.db";
const webDir = process.env.JOB_WATCH_WEB_DIR ?? "dist/web";
// Path to a RecordedSources JSON manifest; when set, the server never touches the network.
const recordedSources = process.env.JOB_WATCH_RECORDED_SOURCES;

const fetchImpl = recordedSources ? loadRecordedFetch(recordedSources) : globalThis.fetch;
// Recorded mode is the e2e suite's mode: it also gets the test-only reset endpoint.
const app = createApp({
  db: openDatabase(dbPath),
  fetch: fetchImpl,
  clock: systemClock,
  testReset: Boolean(recordedSources),
});

app.use("/*", serveStatic({ root: webDir }));
const indexHtml = readFileSync(resolve(webDir, "index.html"), "utf8");
app.get("*", (c) => c.html(indexHtml));

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  const mode = recordedSources ? ` (recorded Sources: ${recordedSources})` : "";
  console.log(`Job Watch listening on http://${info.address}:${info.port}${mode}, database ${dbPath}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));
