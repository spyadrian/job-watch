// Accent- and case-insensitive text matching, shared by the Filter and search.

/** `s` without accents, lower-cased: "Genève" → "geneve". */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Every non-overlapping occurrence of `needle` in `text`, ignoring accents and case,
 * as [start, end) ranges on the ORIGINAL text.
 */
export function findRanges(text: string, needle: string): Array<[number, number]> {
  const target = fold(needle);
  if (target === "") return [];

  // Fold one code point at a time, remembering where each folded char came from.
  let folded = "";
  const startOf: number[] = [];
  const endOf: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = fold(ch);
    // A lone combining mark folds to nothing: keep it with the char before it.
    if (f === "" && endOf.length > 0) endOf[endOf.length - 1] = i + ch.length;
    for (let k = 0; k < f.length; k++) {
      startOf.push(i);
      endOf.push(i + ch.length);
    }
    folded += f;
    i += ch.length;
  }

  const ranges: Array<[number, number]> = [];
  let from = 0;
  for (;;) {
    const at = folded.indexOf(target, from);
    if (at === -1) break;
    ranges.push([startOf[at]!, endOf[at + target.length - 1]!]);
    from = at + target.length;
  }
  return ranges;
}

/** Orders ranges (e.g. highlights) by where they start, then where they end. */
export function byPosition(a: { start: number; end: number }, b: { start: number; end: number }): number {
  return a.start - b.start || a.end - b.end;
}
