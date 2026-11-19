import { useRef, useState, type KeyboardEvent } from "react";
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
        <p className="empty">{current.empty}</p>
        {active === "companies" && <ShortcutsSection state={shortcuts} />}
      </main>
    </>
  );
}
