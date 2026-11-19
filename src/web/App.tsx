import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Job } from "../shared/types.ts";
import { call } from "./api.ts";
import { FollowCompany } from "./follow-company.tsx";
import { useGlobalKeys } from "./global-keys.ts";
import { FilterPanel, useFilter } from "./filter-panel.tsx";
import { jobRows } from "./job-list.ts";
import { JobListView } from "./job-list-view.tsx";
import { StatusToast, useStatusChanges } from "./job-status.tsx";
import { SearchBox } from "./search-box.tsx";
import { HeaderShortcuts, ShortcutsSection, useShortcuts } from "./shortcuts.tsx";

type TabId = "inbox" | "saved" | "applied" | "seen" | "companies";

const tabs: { id: TabId; label: string; empty: string }[] = [
  { id: "inbox", label: "Inbox", empty: "Your Inbox is empty. Follow a Company to see its Jobs here." },
  { id: "saved", label: "Saved", empty: "No saved Jobs yet." },
  { id: "applied", label: "Applied", empty: "No Jobs marked Applied yet." },
  { id: "seen", label: "Seen", empty: "No Jobs marked Seen yet." },
  { id: "companies", label: "Companies", empty: "You don't follow any Company yet." },
];

export function App() {
  const [active, setActive] = useState<TabId>("inbox");
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  const current = tabs.find((t) => t.id === active)!;
  const shortcuts = useShortcuts();
  const jobs = useJobs();
  const status = useStatusChanges(jobs.setJobs);
  const filter = useFilter();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useGlobalKeys({
    "/": () => {
      if (!searchRef.current) return false;
      searchRef.current.focus();
    },
    Escape: () => {
      if (query === "") return false;
      setQuery("");
    },
  });

  // WAI-ARIA tabs pattern: arrow keys move between tabs, Home/End jump.
  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    const id = tabs[next]!.id;
    setActive(id);
    tabRefs.current[id]?.focus();
  }

  return (
    <>
      <header className="app-header">
        <h1 className="brand">Job Watch</h1>
        <HeaderShortcuts shortcuts={shortcuts.shortcuts} />
      </header>
      <nav className="tabs-bar">
        <div role="tablist" aria-label="Lists" className="tabs">
          {tabs.map((tab, i) => (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[tab.id] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={tab.id === active}
              aria-controls={`panel-${tab.id}`}
              tabIndex={tab.id === active ? 0 : -1}
              className="tab"
              onClick={() => setActive(tab.id)}
              onKeyDown={(e) => onTabKeyDown(e, i)}
            >
              {tab.label}
              {tab.id !== "companies" && (
                <span className="count"> {jobRows(jobs.jobs, tab.id, filter.filter, "").length}</span>
              )}
            </button>
          ))}
        </div>
      </nav>
      <main
        role="tabpanel"
        id={`panel-${current.id}`}
        aria-labelledby={`tab-${current.id}`}
        tabIndex={0}
        className="panel"
      >
        <div className="panel-inner">
          {active === "companies" ? (
            <>
              <FollowCompany onFollowed={jobs.reload} />
              <ShortcutsSection state={shortcuts} />
            </>
          ) : (
            <>
              {jobs.loadError && (
                <p role="alert" className="error">
                  {jobs.loadError}
                </p>
              )}
              {active === "inbox" && <FilterPanel state={filter} />}
              <SearchBox ref={searchRef} value={query} onChange={setQuery} />
              <JobListView
                key={`${active}:${query}`}
                jobs={jobs.jobs}
                list={active}
                filter={filter.filter}
                query={query}
                empty={current.empty}
                onAct={status.act}
                onMarkAllSeen={status.markAllSeen}
              />
            </>
          )}
        </div>
      </main>
      <StatusToast toast={status.toast} onUndo={status.undo} />
    </>
  );
}

/** Every stored Job; the job-list module splits them into lists. */
function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(() => {
    call<{ jobs: Job[] }>("GET", "/api/jobs")
      .then((data) => {
        setJobs(data.jobs);
        setLoadError(null);
      })
      .catch((err: Error) => setLoadError(`Couldn't load Jobs: ${err.message}`));
  }, []);

  useEffect(reload, [reload]);
  return { jobs, setJobs, loadError, reload };
}
