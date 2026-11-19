/** Source of the current time. Injected so tests control "now". */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
