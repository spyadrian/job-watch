import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import type { CompaniesResponse, Company, CompanyError } from "../shared/types.ts";
import { call } from "./api.ts";
import { timeAgo } from "./time-ago.ts";

export interface CompaniesState {
  companies: Company[];
  /** Set when the list could not be loaded. */
  loadError: string | null;
  reload(): void;
  rename(id: number, name: string): Promise<void>;
  remove(id: number): Promise<void>;
}

/**
 * Followed Companies. Mutations throw with the server's message; `onJobsChanged`
 * runs after a rename or removal, since both change what the Job lists show.
 */
export function useCompanies(onJobsChanged: () => void): CompaniesState {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(() => {
    call<CompaniesResponse>("GET", "/api/companies")
      .then((data) => {
        setCompanies(data.companies);
        setLoadError(null);
      })
      .catch((err: Error) => setLoadError(`Couldn't load Companies: ${err.message}`));
  }, []);

  useEffect(reload, [reload]);

  const rename = useCallback(
    async (id: number, name: string) => {
      await call("PATCH", `/api/companies/${id}`, { name });
      reload();
      onJobsChanged();
    },
    [reload, onJobsChanged],
  );

  const remove = useCallback(
    async (id: number) => {
      await call("DELETE", `/api/companies/${id}`);
      setCompanies((list) => list.filter((c) => c.id !== id));
      onJobsChanged();
    },
    [onJobsChanged],
  );

  return { companies, loadError, reload, rename, remove };
}

/** The followed Companies of the Companies tab: list with Source type, rename, remove. */
export function CompaniesSection({ state }: { state: CompaniesState }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  return (
    <section aria-labelledby="companies-heading" className="shortcuts companies">
      <h2 id="companies-heading" ref={headingRef} tabIndex={-1}>
        Followed Companies
      </h2>
      {state.loadError && (
        <p role="alert" className="error">
          {state.loadError}
        </p>
      )}
      {state.companies.length === 0 ? (
        <p className="hint">You don't follow any Company yet.</p>
      ) : (
        <ul className="shortcut-list">
          {state.companies.map((c) => (
            <CompanyRow key={c.id} company={c} state={state} afterRemoveFocus={headingRef} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The last read of the Company's Source failed: says why and when; gone after the next good read. */
function CompanyErrorBadge({ error }: { error: CompanyError }) {
  return (
    <span className="company-error">
      <span className="company-error-label">Source failed</span>{" "}
      <span>
        {error.message} <span className="company-error-when">({timeAgo(error.at, new Date())})</span>
      </span>
    </span>
  );
}

function CompanyRow({
  company,
  state,
  afterRemoveFocus,
}: {
  company: Company;
  state: CompaniesState;
  afterRemoveFocus: RefObject<HTMLElement | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(company.name);
  const [error, setError] = useState<string | null>(null);
  const renameRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // After Save or Cancel, put focus back on the Rename button.
  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      renameRef.current?.focus();
    }
  }, [editing]);

  async function run(action: () => Promise<void>) {
    try {
      await action();
      setError(null);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (await run(() => state.rename(company.id, draft))) {
      returnFocus.current = true;
      setEditing(false);
    }
  }

  function onCancel() {
    setDraft(company.name);
    setError(null);
    returnFocus.current = true;
    setEditing(false);
  }

  async function onRemove() {
    if (await run(() => state.remove(company.id))) afterRemoveFocus.current?.focus();
  }

  return (
    <li className="shortcut-row">
      {editing ? (
        <form className="shortcut-rename" onSubmit={onSave} onKeyDown={(e) => e.key === "Escape" && onCancel()}>
          <input
            aria-label={`New name for ${company.name}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
          <button type="submit">Save</button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <span className="company-name">{company.name}</span>
          <span className="shortcut-url">{company.sourceLabel}</span>
          {company.lastError && <CompanyErrorBadge error={company.lastError} />}
          <span className="row-actions">
            <button
              ref={renameRef}
              type="button"
              aria-label={`Rename ${company.name}`}
              onClick={() => {
                setDraft(company.name);
                setEditing(true);
              }}
            >
              Rename
            </button>
            <button type="button" aria-label={`Remove ${company.name}`} onClick={onRemove}>
              Remove
            </button>
          </span>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </li>
  );
}
