import type { Hono } from "hono";
import type { Refresher } from "../refresh.ts";
import type { RefreshEvent } from "../../shared/types.ts";

/**
 * POST /api/refresh: starts a refresh (or joins the running one) and streams
 * its events as NDJSON: start, one progress line per Source, then the summary.
 */
export function registerRefreshRoutes(api: Hono, refresher: Refresher): void {
  api.post("/refresh", () => {
    const run = refresher.start();
    const encoder = new TextEncoder();
    let unsubscribe = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        unsubscribe = run.subscribe((event: RefreshEvent) => {
          if (closed) return;
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          if (event.type === "done") {
            closed = true;
            controller.close();
          }
        });
        if (closed) unsubscribe();
      },
      cancel() {
        unsubscribe();
      },
    });
    return new Response(stream, {
      headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
    });
  });
}
