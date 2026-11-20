/** A count and its noun, plural unless the count is 1: "1 Job", "3 Jobs". */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
