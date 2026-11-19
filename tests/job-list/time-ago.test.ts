import { describe, expect, it } from "vitest";
import { timeAgo } from "../../src/web/time-ago.ts";

const now = new Date("2026-01-15T12:00:00Z");

describe("first-fetched time shown on a Job row", () => {
  it.each([
    ["2026-01-15T11:59:30Z", "just now"],
    ["2026-01-15T12:00:05Z", "just now"], // slight clock skew never shows a negative age
    ["2026-01-15T11:58:00Z", "2m ago"],
    ["2026-01-15T09:00:00Z", "3h ago"],
    ["2026-01-14T11:00:00Z", "1d ago"],
    ["2026-01-12T12:00:00Z", "3d ago"],
    ["2025-12-16T12:00:00Z", "30d ago"],
    ["2025-11-15T12:00:00Z", "2mo ago"],
    ["2024-12-15T12:00:00Z", "1y ago"],
  ])("%s is %s", (iso, expected) => {
    expect(timeAgo(iso, now)).toBe(expected);
  });
});
