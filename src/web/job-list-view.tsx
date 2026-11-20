import { useEffect, useRef, useState } from "react";
import {
  emptyListState,
  jobRows,
  type EmptyListState,
  type Filter,
  type Job,
  type JobRow,
  type ListKind,
} from "./job-list.ts";
import { canApply } from "../shared/job-lifecycle.ts";
import type { JobAction } from "../shared/types.ts";
import { useGlobalKeys } from "./global-keys.ts";
import { Highlighted } from "./highlighted.tsx";
import { StatusButtons, statusToggles, toggleAction } from "./job-status.tsx";
import { timeAgo } from "./time-ago.ts";

export const PAGE_SIZE = 50;

/** One list (Inbox, Saved, Applied, Seen): the job-list module's rows, 50 at a time. */
export function JobListView({
  jobs,
  list,
  filter,
  query,
  empty,
  followsAnyCompany,
  onFollowCompany,
  onAct,
  onMarkAllSeen,
}: {
  jobs: Job[];
  list: ListKind;
  filter: Filter;
  query: string;
  /** What an empty Saved, Applied or Seen list says; the Inbox says why it is empty. */
  empty: string;
  followsAnyCompany: boolean;
  onFollowCompany: () => void;
  onAct: (job: Job, action: JobAction) => void;
  onMarkAllSeen: (jobs: Job[]) => void;
}) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const now = useNow();
  const rows = jobRows(jobs, list, filter, query);
  const selection = useSelection(rows, shown, setShown, onAct);

  if (rows.length === 0) {
    return (
      <EmptyList
        state={emptyListState(jobs, list, filter, query, followsAnyCompany)}
        empty={empty}
        onFollowCompany={onFollowCompany}
      />
    );
  }
  const visible = rows.slice(0, shown);
  return (
    <>
      {list === "inbox" && (
        <div className="list-actions">
          <button type="button" onClick={() => onMarkAllSeen(visible.map((r) => r.job))}>
            {rows.length > visible.length ? `Mark ${visible.length} as seen` : "Mark all as seen"}
          </button>
          <span className="list-count">{plural(rows.length, "Job")}</span>
        </div>
      )}
      <ul className="job-list" aria-label={`${rows.length} Jobs`}>
        {visible.map((row) => (
          <JobRowItem
            key={row.job.id}
            row={row}
            now={now}
            onAct={onAct}
            selected={row.job.id === selection.id}
            onSelect={selection.select}
          />
        ))}
      </ul>
      {rows.length > shown && (
        <div className="more">
          <button type="button" onClick={() => setShown((n) => n + PAGE_SIZE)}>
            Show {Math.min(PAGE_SIZE, rows.length - shown)} more
          </button>
          <span className="hint">
            Showing {visible.length} of {rows.length}
          </span>
        </div>
      )}
    </>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What an empty list says: why it is empty, and for an Inbox without Companies, the way out. */
function EmptyList({
  state,
  empty,
  onFollowCompany,
}: {
  state: EmptyListState;
  empty: string;
  onFollowCompany: () => void;
}) {
  switch (state.kind) {
    case "no-match":
      return <p className="empty">No Jobs match “{state.query}”.</p>;
    case "list":
      return <p className="empty">{empty}</p>;
    case "no-company":
      return (
        <div className="empty">
          <p>You don't follow any Company yet.</p>
          <button type="button" onClick={onFollowCompany}>
            Follow a Company
          </button>
        </div>
      );
    case "caught-up":
      return (
        <div className="empty">
          <p>You're all caught up: nothing new to review.</p>
          {state.hiddenByFilter > 0 && (
            <p className="empty-detail">
              {state.hiddenByFilter === 1
                ? "1 Unseen Job is hidden by your Filter."
                : `${state.hiddenByFilter} Unseen Jobs are hidden by your Filter.`}
            </p>
          )}
        </div>
      );
  }
}

/** Controls whose own Enter key must win over "open the selected Job". */
const ownsEnter = "a, button, input, select, textarea, summary, [role='tab']";

/**
 * The selected Job: `j` / `k` move it (and keyboard focus) through the rows, `Enter` opens it.
 * When the selected Job leaves the list, the Job that takes its place is selected.
 */
function useSelection(
  rows: JobRow[],
  shown: number,
  setShown: (n: number) => void,
  onAct: (job: Job, action: JobAction) => void,
) {
  const [selection, setSelection] = useState<{ id: number; index: number } | null>(null);
  const focusPending = useRef(false);

  let index = -1;
  if (selection && rows.length > 0) {
    index = rows.findIndex((r) => r.job.id === selection.id);
    if (index === -1) index = Math.min(selection.index, rows.length - 1);
  }
  const current = index === -1 ? null : rows[index]!;

  // Keep the stored selection on the Job that took the place of one that left the list,
  // and keep keyboard focus on it if focus was lost with the removed row.
  useEffect(() => {
    if (!current) return;
    if (selection?.id !== current.job.id || selection.index !== index) {
      setSelection({ id: current.job.id, index });
      if (document.activeElement === document.body || document.activeElement === null) focusPending.current = true;
    }
    if (focusPending.current) {
      focusPending.current = false;
      const el = document.querySelector<HTMLElement>(`[data-job-id="${current.job.id}"]`);
      el?.focus();
      el?.scrollIntoView?.({ block: "nearest" });
    }
  });

  function move(to: number) {
    if (rows.length === 0) return false;
    const next = Math.max(0, Math.min(to, rows.length - 1));
    if (next >= shown) setShown(shown + PAGE_SIZE);
    focusPending.current = true;
    setSelection({ id: rows[next]!.job.id, index: next });
  }

  useGlobalKeys({
    j: () => move(index + 1),
    k: () => move(index === -1 ? 0 : index - 1),
    Enter: (e) => {
      if (!current) return false;
      if (e.target instanceof Element && e.target.closest(ownsEnter)) return false;
      window.open(current.job.url, "_blank", "noopener,noreferrer");
    },
    // e / s / a: the same toggles as the row's Seen / Save / Applied buttons, only when they are enabled.
    ...Object.fromEntries(
      statusToggles.map((t) => [
        t.key,
        () => {
          if (!current) return false;
          const action = toggleAction(current.job, t);
          if (!canApply(current.job, action)) return false;
          onAct(current.job, action);
        },
      ]),
    ),
  });

  return {
    id: current?.job.id ?? null,
    current: current?.job ?? null,
    select: (job: Job) => {
      const i = rows.findIndex((r) => r.job.id === job.id);
      if (i !== -1 && selection?.id !== job.id) setSelection({ id: job.id, index: i });
    },
  };
}

function JobRowItem({
  row: { job, highlights },
  now,
  onAct,
  selected,
  onSelect,
}: {
  row: JobRow;
  now: Date;
  onAct: (job: Job, action: JobAction) => void;
  selected: boolean;
  onSelect: (job: Job) => void;
}) {
  return (
    <li
      className="job-row"
      data-job-id={job.id}
      tabIndex={-1}
      aria-current={selected ? "true" : undefined}
      onFocus={() => onSelect(job)}
    >
      <a className="job-title" href={job.url} target="_blank" rel="noopener noreferrer">
        <Highlighted text={job.title} highlights={highlights.title} />
        <span className="visually-hidden"> (opens in a new tab)</span>
      </a>
      <div className="job-meta">
        <span className="job-company">
          <Highlighted text={job.companyName} highlights={highlights.company} />
        </span>
        {job.outdated && (
          <span className="badge-outdated" title="No longer published by its Source">
            Outdated
          </span>
        )}
        {job.locations.length > 0 && (
          <span className="job-locations">
            {job.locations.map((location, i) => (
              <span key={i} className="job-location">
                <Highlighted text={location} highlights={highlights.locations[i] ?? []} />
              </span>
            ))}
          </span>
        )}
        <time dateTime={job.firstFetchedAt} title={`First fetched ${new Date(job.firstFetchedAt).toLocaleString()}`}>
          {timeAgo(job.firstFetchedAt, now)}
        </time>
      </div>
      <StatusButtons job={job} onAct={onAct} />
    </li>
  );
}

/** The current time, ticking every minute so relative ages stay right. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
