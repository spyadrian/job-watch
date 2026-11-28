import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { CompaniesResponse, Company, CompanyError } from "../shared/types.ts";
import { call } from "./api.ts";
import { cappedCount, NarrowingTip } from "./capped-read.tsx";
import { ManagedRow, renameAction } from "./managed-row.tsx";
import { timeAgo } from "./time-ago.ts";

export interface CompaniesState {
  companies: Company[];
  /** Whether the list has loaded at least once; until then `companies` is empty for lack of knowing. */
  loaded: boolean;
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
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(() => {
    call<CompaniesResponse>("GET", "/api/companies")
      .then((data) => {
        setCompanies(data.companies);
        setLoaded(true);
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

  return { companies, loaded, loadError, reload, rename, remove };
}

/** The followed Companies of the Companies tab: list with Source type, rename, remove. */
export function CompaniesSection({ state }: { state: CompaniesState }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  return (
    <section aria-labelledby="companies-heading" className="managed-section">
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
        <ul className="managed-list">
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

/** The last good read stopped at the most Jobs read from one Source: says so and how to narrow it. */
function CompanyCappedNotice({ company }: { company: Company }) {
  if (!company.capped) return null;
  return (
    <span className="company-capped">
      <span className="company-capped-label">Only {cappedCount(company.capped)}</span>{" "}
      <NarrowingTip source={company.source} />
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
  return (
    <ManagedRow
      name={company.name}
      edit={renameAction(company.name, (name) => state.rename(company.id, name))}
      onRemove={() => state.remove(company.id)}
      afterRemoveFocus={afterRemoveFocus}
    >
      <span className="company-name">{company.name}</span>
      <span className="managed-detail">{company.sourceLabel}</span>
      {company.lastError && <CompanyErrorBadge error={company.lastError} />}
      <CompanyCappedNotice company={company} />
    </ManagedRow>
  );
}
