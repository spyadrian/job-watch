import type { Highlight } from "./job-list.ts";

const kindOrder: Highlight["kind"][] = ["required", "boosted", "search"];

/**
 * `text` with its highlight ranges wrapped in <mark>. Overlapping ranges are merged: the text is cut
 * at every range boundary and each piece carries the classes of every kind that covers it.
 */
export function Highlighted({ text, highlights }: { text: string; highlights: readonly Highlight[] }) {
  if (highlights.length === 0) return <>{text}</>;

  const cuts = new Set([0, text.length]);
  for (const h of highlights) {
    cuts.add(clamp(h.start, text.length));
    cuts.add(clamp(h.end, text.length));
  }
  const points = [...cuts].sort((a, b) => a - b);

  const pieces: { start: number; end: number; kinds: Highlight["kind"][] }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!;
    const end = points[i + 1]!;
    const kinds = kindOrder.filter((kind) => highlights.some((h) => h.kind === kind && h.start <= start && h.end >= end));
    const last = pieces.at(-1);
    // Join adjacent pieces with the same kinds so one word stays one <mark>.
    if (last && last.end === start && sameKinds(last.kinds, kinds)) last.end = end;
    else pieces.push({ start, end, kinds });
  }

  return (
    <>
      {pieces.map(({ start, end, kinds }) =>
        kinds.length === 0 ? (
          text.slice(start, end)
        ) : (
          <mark key={start} className={kinds.map((k) => `hl-${k}`).join(" ")}>
            {text.slice(start, end)}
          </mark>
        ),
      )}
    </>
  );
}

function clamp(n: number, max: number): number {
  return Math.max(0, Math.min(n, max));
}

function sameKinds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}
