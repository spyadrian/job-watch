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
  /** Whether the toast offers Undo (it reports a status change that can be reverted). */
  undoable: boolean;
}

/** The status a Job had before the last change, which Undo (or `u`) restores. */
interface LastChange {
  jobId: number;
  status: JobStatus;
  wasSaved: boolean;
}

export interface StatusChanges {
  act: (job: Job, action: JobAction) => void;
  /** Reverts the last status change, if any; returns whether there was one. */
  undo: () => boolean;
  toast: Toast | null;
}

/** Applies status actions through the API and keeps `jobs` and the toast in step. */
export function useStatusChanges(setJobs: Dispatch<SetStateAction<Job[]>>): StatusChanges {
  const [toast, setToast] = useState<Toast | null>(null);
  const counter = useRef(0);
  // Kept after the toast is gone, so `u` still undoes the last change.
  const last = useRef<LastChange | null>(null);

  const show = useCallback((message: string, undoable = false) => {
    counter.current += 1;
    setToast({ key: counter.current, message, undoable });
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
          if (res.deleted) {
            last.current = null;
            show("Removed: this Job is no longer published");
          } else {
            last.current = { jobId: job.id, status: job.status, wasSaved: job.wasSaved };
            show(doneMessage[action], true);
          }
        })
        .catch((err: Error) => show(err.message));
    },
    [putJob, show],
  );

  const undo = useCallback(() => {
    const change = last.current;
    if (!change) return false;
    last.current = null;
    setToast(null);
    call<{ job: Job }>("POST", `/api/jobs/${change.jobId}/undo`, { status: change.status, wasSaved: change.wasSaved })
      .then((res) => {
        putJob(change.jobId, res.job);
        show("Undone");
      })
      .catch((err: Error) => show(`Couldn't undo: ${err.message}`));
    return true;
  }, [putJob, show]);

  // Disappears on its own.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  return { act, undo, toast };
}

/**
 * The polite live region holding the toast. Always rendered (so announcements are
 * heard), it sits below the scrolling list in a corner and never takes focus.
 */
export function StatusToast({ toast, onUndo }: { toast: Toast | null; onUndo: () => unknown }) {
  return (
    <div role="status" aria-live="polite" className="toast-region">
      {toast && (
        <div key={toast.key} className="toast">
          <span>{toast.message}</span>
          {toast.undoable && (
            <>
              <span aria-hidden="true">·</span>
              <button type="button" className="toast-undo" aria-keyshortcuts="u" onClick={onUndo}>
                Undo
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The three status toggles, with the key that toggles each on the selected Job. */
export const statusToggles: { label: string; key: string; on: JobStatus; set: JobAction; unset: JobAction }[] = [
  { label: "Seen", key: "e", on: "seen", set: "seen", unset: "unseen" },
  { label: "Save", key: "s", on: "saved", set: "save", unset: "unsave" },
  { label: "Applied", key: "a", on: "applied", set: "apply", unset: "unapply" },
];

/** The action a toggle performs on this Job: unset when the Job has that status, else set. */
export function toggleAction(job: Job, toggle: (typeof statusToggles)[number]): JobAction {
  return job.status === toggle.on ? toggle.unset : toggle.set;
}

/** Seen, Save and Applied toggles; pressed when the Job has that status. */
export function StatusButtons({ job, onAct }: { job: Job; onAct: (job: Job, action: JobAction) => void }) {
  return (
    <div role="group" aria-label={`Status of ${job.title}`} className="status-buttons">
      {statusToggles.map((b) => {
        const pressed = job.status === b.on;
        const action = toggleAction(job, b);
        return (
          <button
            key={b.label}
            type="button"
            aria-pressed={pressed}
            aria-keyshortcuts={b.key}
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
