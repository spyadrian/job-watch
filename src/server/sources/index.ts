// Registry of Source adapters. To support another ATS: write src/server/sources/<type>.ts
// implementing SourceAdapter (including matchLink for its link patterns), add its type
// to SourceType in src/shared/types.ts, and list it here. Nothing else changes.
import { greenhouse } from "./greenhouse.ts";
import { ashby } from "./ashby.ts";
import { lever, leverEu } from "./lever.ts";
import { smartrecruiters } from "./smartrecruiters.ts";
import type { SourceAdapter, SourceType } from "./types.ts";

export const adapters: readonly SourceAdapter[] = [
  greenhouse,
  lever,
  leverEu,
  ashby,
  smartrecruiters,
];

export function adapterFor(type: string): SourceAdapter | undefined {
  return adapters.find((adapter) => adapter.type === (type as SourceType));
}

export * from "./types.ts";
