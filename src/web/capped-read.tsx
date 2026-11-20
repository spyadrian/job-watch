import type { CappedRead, SourceRef } from "../shared/types.ts";

/** "1000 of 2626 jobs read": a read that stopped at the most Jobs read from one Source. */
export const cappedCount = ({ read, total }: CappedRead) => `${read} of ${total} jobs read`;

/**
 * How to read fewer Jobs from a capped Source, when its Source type can narrow one:
 * an Eightfold careers link with `?location=…`, with an example built from the site.
 */
export function NarrowingTip({ source }: { source: SourceRef }) {
  const example = narrowedLink(source);
  if (!example) return null;
  return (
    <>
      To read one location only, paste the careers link with <code>?location=…</code>, e.g. <code>{example}</code>
    </>
  );
}

/** "jobs.nvidia.com/nvidia.com" → "https://jobs.nvidia.com/careers?location=Switzerland". */
function narrowedLink(source: SourceRef): string | null {
  if (source.type !== "eightfold") return null;
  const [host, domain] = source.key.split("?")[0]!.split("/");
  if (!host || !domain) return null;
  // On eightfold.ai the link names the tenant; on the employer's own domain the site is the tenant.
  const query = host.endsWith(".eightfold.ai") ? `domain=${domain}&location=Switzerland` : "location=Switzerland";
  return `https://${host}/careers?${query}`;
}
