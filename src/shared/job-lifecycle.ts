// The spec's Job lifecycle (status table) as a pure function, shared by the
// server (which enforces it) and the front end (which only offers allowed actions).
import type { JobAction, JobStatus } from "./types.ts";

/** The part of a Job the status rules look at. */
export interface JobState {
  status: JobStatus;
  wasSaved: boolean;
  outdated: boolean;
}

/** What an action does to a Job: its new status and flag, or deletion. */
export type Transition = { status: JobStatus; wasSaved: boolean } | { deleted: true };

/** The action is not allowed from the Job's current status. */
export class TransitionError extends Error {}

export const jobStatuses: JobStatus[] = ["unseen", "seen", "saved", "applied"];

const actionLabel: Record<JobAction, string> = {
  seen: "mark Seen",
  unseen: "un-mark Seen",
  save: "save",
  unsave: "un-save",
  apply: "mark Applied",
  unapply: "un-mark Applied",
};

export const jobActions = Object.keys(actionLabel) as JobAction[];

/** Applies one action of the status table, or throws TransitionError. */
export function transition(from: JobState, action: JobAction): Transition {
  const { status, wasSaved, outdated } = from;
  // An Outdated Job that would fall back to Seen is deleted instead.
  const toSeen: Transition = outdated ? { deleted: true } : { status: "seen", wasSaved: false };
  switch (action) {
    case "seen":
      if (status === "unseen") return { status: "seen", wasSaved: false };
      break;
    case "unseen":
      if (status === "seen") return { status: "unseen", wasSaved: false };
      break;
    case "save":
      if (status === "unseen" || status === "seen") return { status: "saved", wasSaved: false };
      break;
    case "unsave":
      if (status === "saved") return toSeen;
      break;
    case "apply":
      if (status === "unseen" || status === "seen") return { status: "applied", wasSaved: false };
      if (status === "saved") return { status: "applied", wasSaved: true };
      break;
    case "unapply":
      if (status === "applied") return wasSaved ? { status: "saved", wasSaved: false } : toSeen;
      break;
  }
  throw new TransitionError(`Can't ${actionLabel[action]} a Job that is ${status[0]!.toUpperCase()}${status.slice(1)}.`);
}

/**
 * A Job no longer in its Source: an Unseen or Seen Job is deleted; a Saved or
 * Applied Job is kept, flagged Outdated.
 */
export function becomeOutdated(from: JobState): { outdated: true } | { deleted: true } {
  return from.status === "unseen" || from.status === "seen" ? { deleted: true } : { outdated: true };
}

/** Whether the status table allows `action` from this state. */
export function canApply(from: JobState, action: JobAction): boolean {
  try {
    transition(from, action);
    return true;
  } catch {
    return false;
  }
}
