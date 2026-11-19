import { useCallback, useEffect, useRef, useState } from "react";
import type { RefreshEvent, RefreshSummary } from "../shared/types.ts";

type RefreshState =
  | { phase: "idle" }
  | { phase: "running"; done: number; total: number | null }
  | { phase: "done"; summary: RefreshSummary }
  | { phase: "failed"; message: string };

export interface RefreshControlState {
  state: RefreshState;
  run(): void;
}

/**
 * Reads every Source when the app opens and on demand. `onFinished` runs after
 * each refresh (the server state may have changed). A click during a refresh is ignored.
 */
export function useRefresh(onFinished: (summary: RefreshSummary | null) => void): RefreshControlState {
  const [state, setState] = useState<RefreshState>({ phase: "idle" });
  const running = useRef(false);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  const run = useCallback(() => {
    if (running.current) return;
    running.current = true;
    setState({ phase: "running", done: 0, total: null });
    streamRefresh((event) => {
      if (event.type === "start") setState({ phase: "running", done: 0, total: event.total });
      else if (event.type === "progress") setState({ phase: "running", done: event.done, total: event.total });
      else setState({ phase: "done", summary: event.summary });
    })
      .then((summary) => finished.current(summary))
      .catch((err: Error) => {
        setState({ phase: "failed", message: `Refresh failed: ${err.message}` });
        finished.current(null);
      })
      .finally(() => {
        running.current = false;
      });
  }, []);

  useEffect(run, [run]);
  return { state, run };
}

/** POSTs /api/refresh and feeds each NDJSON event to `onEvent`; resolves with the summary. */
async function streamRefresh(onEvent: (event: RefreshEvent) => void): Promise<RefreshSummary> {
  const res = await fetch("/api/refresh", { method: "POST" });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Request failed (${res.status}).`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let summary: RefreshSummary | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += value;
    const lines = buffer.split("\n");
    buffer = done ? "" : lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as RefreshEvent;
      if (event.type === "done") summary = event.summary;
      onEvent(event);
    }
    if (done) break;
  }
  if (!summary) throw new Error("the refresh stopped before the end.");
  return summary;
}

/** "14 new · 3 outdated · 1 source failed" (the failed part only when some failed). */
export function summaryText({ new: added, outdated, failed }: RefreshSummary): string {
  const parts = [`${added} new`, `${outdated} outdated`];
  if (failed > 0) parts.push(`${failed} ${failed === 1 ? "source" : "sources"} failed`);
  return parts.join(" · ");
}

/** The header's Refresh button with its progress and summary, announced politely. */
export function RefreshControl({ refresh }: { refresh: RefreshControlState }) {
  const { state } = refresh;
  let text = "";
  if (state.phase === "running") {
    text = state.total === null ? "Refreshing…" : `Refreshing ${state.done}/${state.total}…`;
  } else if (state.phase === "done") text = summaryText(state.summary);
  else if (state.phase === "failed") text = state.message;
  return (
    <div className="refresh">
      <button type="button" onClick={refresh.run} aria-describedby="refresh-status">
        Refresh
      </button>
      <span
        id="refresh-status"
        aria-live="polite"
        aria-atomic="true"
        className={state.phase === "failed" ? "refresh-status error" : "refresh-status"}
      >
        {text}
      </span>
    </div>
  );
}
