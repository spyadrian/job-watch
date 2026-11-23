// The Data section of the Companies tab: export everything to one file, import such a file.
import { useId, useState, type ChangeEvent } from "react";
import { isEmptyFilter } from "../shared/filter.ts";
import type { Filter, ImportSummary } from "../shared/types.ts";
import { callWithJson } from "./api.ts";
import { plural } from "./plural.ts";

/** The import summary in plain English. The server says "replaced" only when the Filter changed. */
function importSummaryText(summary: ImportSummary): string {
  const filterChanged = summary.filter === "replaced";
  const added = [
    summary.companies.added > 0 && `${summary.companies.added} ${summary.companies.added === 1 ? "Company" : "Companies"}`,
    summary.shortcuts.added > 0 && plural(summary.shortcuts.added, "Shortcut"),
  ].filter(Boolean);
  const restored = summary.jobs.added + summary.jobs.statusesRestored;
  const clauses = [
    added.length > 0 && `added ${added.join(" and ")}`,
    restored > 0 && `restored ${restored} Job ${restored === 1 ? "status" : "statuses"}`,
  ].filter(Boolean) as string[];
  if (clauses.length === 0 && !filterChanged) return "Nothing new to import: everything in this file is already here.";
  const sentences: string[] = [];
  if (clauses.length > 0) {
    const text = clauses.join("; ");
    sentences.push(`${text[0]!.toUpperCase()}${text.slice(1)}.`);
  }
  if (filterChanged) sentences.push("Replaced your Filter with the file's.");
  if (summary.companies.added > 0) sentences.push("Refresh to read the new Companies' Jobs.");
  return sentences.join(" ");
}

/** Export and import of all data. `onImported` reloads what the import may have changed. */
export function DataSection({ filter, onImported }: { filter: Filter; onImported: () => void }) {
  // null: follow the default, which is to replace the Filter only while it is empty.
  const [replaceChoice, setReplaceChoice] = useState<boolean | null>(null);
  const replaceFilter = replaceChoice ?? isEmptyFilter(filter);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ids = useId();

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    setSummary("");
    setError(null);
    try {
      const path = `/api/import?filter=${replaceFilter ? "replace" : "keep"}`;
      setSummary(importSummaryText(await callWithJson<ImportSummary>("POST", path, await file.text())));
      onImported();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      input.value = ""; // so the same file can be picked again
    }
  }

  return (
    <section aria-labelledby={`${ids}-heading`} className="managed-section data-section">
      <h2 id={`${ids}-heading`}>Data</h2>
      <p className="hint">
        Save your Companies, Shortcuts, Filter and Job statuses to one file (Unseen Jobs are left out: the next Refresh reads them again), or load such a file here to merge it with what you already have.
      </p>
      <p>
        <a href="/api/export" download className="button-link">
          Export
        </a>
      </p>
      <div className="data-import">
        <label>
          <span>Import a file</span>
          <input type="file" accept="application/json,.json" onChange={onFile} disabled={busy} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={replaceFilter} onChange={(e) => setReplaceChoice(e.target.checked)} />
          <span>Replace my Filter with the file's</span>
        </label>
      </div>
      <p role="status" className="data-summary">
        {summary}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
