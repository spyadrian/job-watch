import { useEffect, useState } from "react";
import { emptyFilter, jobRows, type Job, type JobRow, type ListKind } from "./job-list.ts";
import type { JobAction } from "../shared/types.ts";
import { Highlighted } from "./highlighted.tsx";
import { StatusButtons } from "./job-status.tsx";
import { timeAgo } from "./time-ago.ts";

export const PAGE_SIZE = 50;

/** One list (Inbox, Saved, Applied, Seen): the job-list module's rows, 50 at a time. */
export function JobListView({
  jobs,
  list,
  query,
  empty,
  onAct,
}: {
  jobs: Job[];
  list: ListKind;
  query: string;
  empty: string;
  onAct: (job: Job, action: JobAction) => void;
}) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const now = useNow();
  const rows = jobRows(jobs, list, emptyFilter, query);

  if (rows.length === 0) {
    const searching = query.trim() !== "" && jobRows(jobs, list, emptyFilter, "").length > 0;
    return <p className="empty">{searching ? `No Jobs match “${query.trim()}”.` : empty}</p>;
  }
  const visible = rows.slice(0, shown);
  return (
    <>
      <ul className="job-list" aria-label={`${rows.length} Jobs`}>
        {visible.map((row) => (
          <JobRowItem key={row.job.id} row={row} now={now} onAct={onAct} />
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

function JobRowItem({
  row: { job, highlights },
  now,
  onAct,
}: {
  row: JobRow;
  now: Date;
  onAct: (job: Job, action: JobAction) => void;
}) {
  return (
    <li className="job-row">
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
