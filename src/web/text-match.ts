// Accent- and case-insensitive text matching, shared by the Filter and search.

/** Lower case with accents removed: "Genève" → "geneve". */
export function fold(s: string): string {
  return folded(s).text;
}

/**
 * Every place `needle` occurs in `text`, ignoring accents and case, as
 * [start, end) ranges on the ORIGINAL text (non-overlapping, left to right).
 */
export function findRanges(text: string, needle: string): Array<[number, number]> {
  const n = fold(needle);
  if (n === "") return [];
  const { text: hay, origin } = folded(text);
  const ranges: Array<[number, number]> = [];
  let from = 0;
  for (let at = hay.indexOf(n, from); at !== -1; at = hay.indexOf(n, from)) {
    const last = at + n.length - 1;
    let end = origin[last]! + charLength(text, origin[last]!);
    // Keep the accents that belong to the last matched letter.
    while (end < text.length && /\p{M}/u.test(text[end]!)) end++;
    ranges.push([origin[at]!, end]);
    from = at + n.length;
  }
  return ranges;
}

/** The folded text, with the index in the original of the character each folded unit comes from. */
function folded(s: string): { text: string; origin: number[] } {
  let text = "";
  const origin: number[] = [];
  for (let i = 0; i < s.length; ) {
    const char = String.fromCodePoint(s.codePointAt(i)!);
    const f = char.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    text += f;
    for (let k = 0; k < f.length; k++) origin.push(i);
    i += char.length;
  }
  return { text, origin };
}

function charLength(s: string, i: number): number {
  return String.fromCodePoint(s.codePointAt(i)!).length;
}
