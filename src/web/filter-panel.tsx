// The Filter editor: a collapsible panel at the top of the Inbox. Every change is
// saved through the API straight away; the job-list module applies it.
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import type { Filter } from "../shared/types.ts";
import { call } from "./api.ts";
import { emptyFilter } from "./job-list.ts";

export interface FilterState {
  filter: Filter;
  save: (next: Filter) => void;
  error: string | null;
}

/** The stored Filter, loaded once; `save` replaces it (optimistically). */
export function useFilter(): FilterState {
  const [filter, setFilter] = useState<Filter>(emptyFilter);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<{ filter: Filter }>("GET", "/api/filter")
      .then((res) => setFilter(res.filter))
      .catch((err: Error) => setError(`Couldn't load the Filter: ${err.message}`));
  }, []);

  const save = useCallback((next: Filter) => {
    let previous: Filter = emptyFilter;
    setFilter((current) => {
      previous = current;
      return next;
    });
    call<{ filter: Filter }>("PUT", "/api/filter", next)
      .then((res) => {
        setFilter(res.filter);
        setError(null);
      })
      .catch((err: Error) => {
        setFilter(previous);
        setError(`Couldn't save the Filter: ${err.message}`);
      });
  }, []);

  return { filter, save, error };
}

const OPEN_KEY = "job-watch.filter-open";

type ListKey = "required" | "boosted" | "excluded";

const keywordGroups: { key: ListKey; label: string; hint: string }[] = [
  { key: "required", label: "Required keywords", hint: "The title must contain at least one." },
  { key: "boosted", label: "Boosted keywords", hint: "Jobs with one in the title come first." },
  { key: "excluded", label: "Excluded keywords", hint: "Jobs with one in the title are hidden." },
];

export function FilterPanel({ state }: { state: FilterState }) {
  const { filter, save, error } = state;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const bodyId = useId();

  function toggle() {
    setOpen(!open);
    try {
      localStorage.setItem(OPEN_KEY, open ? "0" : "1");
    } catch {
      // Remembering the panel state is only a convenience.
    }
  }

  const count =
    filter.cities.length + filter.required.length + filter.boosted.length + filter.excluded.length;

  return (
    <section className="filter-panel" aria-label="Filter">
      <h2 className="filter-heading">
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
          <span className="chevron" aria-hidden="true" />
          Filter
          <span className="filter-summary">{count === 0 ? "none" : summary(filter)}</span>
        </button>
      </h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div id={bodyId} className="filter-body" hidden={!open}>
        <WordGroup
          kind="city"
          label="City filters"
          hint="Jobs with no location or a remote one always show. Separate spellings with /, e.g. Geneva / Genève / Genf."
          items={filter.cities.map((spellings) => spellings.join(" / "))}
          onAdd={(text) => {
            const spellings = text
              .split("/")
              .map((s) => s.trim())
              .filter((s) => s !== "");
            if (spellings.length > 0) save({ ...filter, cities: [...filter.cities, spellings] });
          }}
          onRemove={(i) => save({ ...filter, cities: filter.cities.filter((_, j) => j !== i) })}
        />
        {keywordGroups.map((g) => (
          <WordGroup
            key={g.key}
            kind={g.key}
            label={g.label}
            hint={g.hint}
            items={filter[g.key]}
            onAdd={(text) => {
              const word = text.trim();
              if (word && !filter[g.key].includes(word)) save({ ...filter, [g.key]: [...filter[g.key], word] });
            }}
            onRemove={(i) => save({ ...filter, [g.key]: filter[g.key].filter((_, j) => j !== i) })}
          />
        ))}
      </div>
    </section>
  );
}

function summary(filter: Filter): string {
  const parts: string[] = [];
  const n = (count: number, one: string, many = `${one}s`) => count > 0 && parts.push(`${count} ${count === 1 ? one : many}`);
  n(filter.cities.length, "city", "cities");
  n(filter.required.length, "required");
  n(filter.boosted.length, "boosted");
  n(filter.excluded.length, "excluded");
  return parts.join(" · ");
}

/** One list of words (City filters or keywords): removable chips plus an add field. */
function WordGroup({
  kind,
  label,
  hint,
  items,
  onAdd,
  onRemove,
}: {
  kind: "city" | ListKey;
  label: string;
  hint: string;
  items: string[];
  onAdd: (text: string) => void;
  onRemove: (index: number) => void;
}) {
  const [text, setText] = useState("");
  const inputId = useId();
  const hintId = useId();
  const singular = kind === "city" ? "City filter" : label.replace(/s$/, "");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim() === "") return;
    onAdd(text);
    setText("");
  }

  return (
    <div className={`word-group word-group-${kind}`} role="group" aria-labelledby={`${inputId}-label`}>
      <div className="word-group-head">
        <span id={`${inputId}-label`} className="word-group-label">
          {label}
        </span>
        <span id={hintId} className="hint">
          {hint}
        </span>
      </div>
      {items.length > 0 && (
        <ul className="chips" aria-label={label}>
          {items.map((item, i) => (
            <li key={`${i}-${item}`} className={`chip chip-${kind}`}>
              <span>{item}</span>
              <button type="button" aria-label={`Remove ${singular} ${item}`} onClick={() => onRemove(i)}>
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="word-add" onSubmit={submit}>
        <label htmlFor={inputId} className="visually-hidden">
          New {singular}
        </label>
        <input
          id={inputId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={kind === "city" ? "Geneva / Genève / Genf" : "Add a keyword"}
          aria-describedby={hintId}
          autoComplete="off"
        />
        <button type="submit">Add</button>
      </form>
    </div>
  );
}
