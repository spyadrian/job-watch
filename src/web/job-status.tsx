// Job status changes in the UI: the Seen / Save / Applied toggle buttons on each
// row, the calls to the status API, and the undo toast.
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { canApply } from "../shared/job-lifecycle.ts";
import type { Job, JobAction, JobStatus } from "../shared/types.ts";
import { call } from "./api.ts";

/** How long the toast stays before it disappears on its own. */
export const TOAST_MS = 5000;

const doneMessage: Record<JobAction, string> = {
  seen: "Marked as seen",
  unseen: "Moved back to the Inbox",
  save: "Saved",
  unsave: "Removed from Saved",
  apply: "Marked as applied",
  unapply: "Unmarked as applied",
};

interface Toast {
  /** Changes on every new toast, so its timer restarts. */
  key: number;
  message: string;
  /** The last status change, which Undo reverts; absent when it can't be undone. */
  undo?: { jobId: number; status: JobStatus; wasSaved: boolean };
}

export interface StatusChanges {
  act: (job: Job, action: JobAction) => void;
  /** Mark all as seen: the given (visible) Jobs, in one request. */
  markAllSeen: (jobs: Job[]) => void;
  undo: () => void;
  toast: Toast | null;
}

/** Applies status actions through the API and keeps `jobs` and the toast in step. */
export function useStatusChanges(setJobs: Dispatch<SetStateAction<Job[]>>): StatusChanges {
  const [toast, setToast] = useState<Toast | null>(null);
  const counter = useRef(0);

  const show = useCallback((message: string, undo?: Toast["undo"]) => {
    counter.current += 1;
    setToast({ key: counter.current, message, undo });
  }, []);

  const putJob = useCallback(
    (id: number, job: Job | null) =>
      setJobs((jobs) => (job ? jobs.map((j) => (j.id === id ? job : j)) : jobs.filter((j) => j.id !== id))),
    [setJobs],
  );

  const act = useCallback(
    (job: Job, action: JobAction) => {
      call<{ job: Job | null; deleted?: boolean }>("POST", `/api/jobs/${job.id}/status`, { action })
        .then((res) => {
          putJob(job.id, res.job);
          if (res.deleted) show("Removed: this Job is no longer published");
          else show(doneMessage[action], { jobId: job.id, status: job.status, wasSaved: job.wasSaved });
        })
        .catch((err: Error) => show(err.message));
    },
    [putJob, show],
  );

  const markAllSeen = useCallback(
    (jobs: Job[]) => {
      call<{ jobs: Job[] }>("POST", "/api/jobs/seen", { ids: jobs.map((j) => j.id) })
        .then((res) => {
          const updated = new Map(res.jobs.map((j) => [j.id, j]));
          setJobs((all) => all.map((j) => updated.get(j.id) ?? j));
          show(res.jobs.length === 1 ? "Marked 1 Job as seen" : `Marked ${res.jobs.length} Jobs as seen`);
        })
        .catch((err: Error) => show(err.message));
    },
    [setJobs, show],
  );

  const undo = useCallback(() => {
    const last = toast?.undo;
    if (!last) return;
    setToast(null);
    call<{ job: Job }>("POST", `/api/jobs/${last.jobId}/undo`, { status: last.status, wasSaved: last.wasSaved })
      .then((res) => putJob(last.jobId, res.job))
      .catch((err: Error) => show(`Couldn't undo: ${err.message}`));
  }, [toast, putJob, show]);

  // Disappears on its own.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  return { act, markAllSeen, undo, toast };
}

/**
 * The polite live region holding the toast. Always rendered (so announcements are
 * heard), it sits below the scrolling list in a corner and never takes focus.
 */
export function StatusToast({ toast, onUndo }: { toast: Toast | null; onUndo: () => void }) {
  return (
    <div role="status" aria-live="polite" className="toast-region">
      {toast && (
        <div key={toast.key} className="toast">
          <span>{toast.message}</span>
          {toast.undo && (
            <>
              <span aria-hidden="true">·</span>
              <button type="button" className="toast-undo" onClick={onUndo}>
                Undo
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const buttons: { label: string; on: JobStatus; set: JobAction; unset: JobAction }[] = [
  { label: "Seen", on: "seen", set: "seen", unset: "unseen" },
  { label: "Save", on: "saved", set: "save", unset: "unsave" },
  { label: "Applied", on: "applied", set: "apply", unset: "unapply" },
];

/** Seen, Save and Applied toggles; pressed when the Job has that status. */
export function StatusButtons({ job, onAct }: { job: Job; onAct: (job: Job, action: JobAction) => void }) {
  return (
    <div role="group" aria-label={`Status of ${job.title}`} className="status-buttons">
      {buttons.map((b) => {
        const pressed = job.status === b.on;
        const action = pressed ? b.unset : b.set;
        return (
          <button
            key={b.label}
            type="button"
            aria-pressed={pressed}
            disabled={!canApply(job, action)}
            onClick={() => onAct(job, action)}
          >
            {b.label}
          </button>
        );
      })}
    </div>
  );
}
