// Registry of Source adapters. To support another ATS: write src/server/sources/<type>.ts
// implementing SourceAdapter (including matchLink for its link patterns), add its type
// to SourceType in src/shared/types.ts, and list it here. Nothing else changes.
import { greenhouse } from "./greenhouse.ts";
import { recruitee } from "./recruitee.ts";
import { workable } from "./workable.ts";
import type { SourceAdapter, SourceType } from "./types.ts";

export const adapters: readonly SourceAdapter[] = [
  greenhouse,
  recruitee,
  workable,
];

export function adapterFor(type: string): SourceAdapter | undefined {
  return adapters.find((adapter) => adapter.type === (type as SourceType));
}

export * from "./types.ts";
