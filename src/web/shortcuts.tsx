import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type { Shortcut } from "../shared/types.ts";
import { call } from "./api.ts";
import { ManagedRow } from "./managed-row.tsx";
import { fold } from "./text-match.ts";

export interface ShortcutsState {
  shortcuts: Shortcut[];
  /** Set when the list could not be loaded. */
  loadError: string | null;
  add(name: string, url: string): Promise<void>;
  rename(id: number, name: string): Promise<void>;
  remove(id: number): Promise<void>;
}

/** Shortcuts shared by the header and the Companies tab. Mutations throw with the server's message. */
export function useShortcuts(): ShortcutsState {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    call<{ shortcuts: Shortcut[] }>("GET", "/api/shortcuts")
      .then((data) => !cancelled && setShortcuts(data.shortcuts))
      .catch((err: Error) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const add = useCallback(async (name: string, url: string) => {
    const { shortcut } = await call<{ shortcut: Shortcut }>("POST", "/api/shortcuts", { name, url });
    setShortcuts((list) => [...list, shortcut]);
  }, []);

  const rename = useCallback(async (id: number, name: string) => {
    const { shortcut } = await call<{ shortcut: Shortcut }>("PATCH", `/api/shortcuts/${id}`, { name });
    setShortcuts((list) => list.map((s) => (s.id === id ? shortcut : s)));
  }, []);

  const remove = useCallback(async (id: number) => {
    await call("DELETE", `/api/shortcuts/${id}`);
    setShortcuts((list) => list.filter((s) => s.id !== id));
  }, []);

  return { shortcuts, loadError, add, rename, remove };
}

function ShortcutLink({ shortcut, className, onOpen }: { shortcut: Shortcut; className?: string; onOpen?: () => void }) {
  return (
    <a href={shortcut.url} target="_blank" rel="noopener noreferrer" className={className} onClick={onOpen}>
      {shortcut.name}
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}

/** From this many Shortcuts, the header menu starts with a filter field. */
const FILTER_FROM = 11;

/** Open state of the header's Shortcuts menu, shared with the global `g` key (see App). */
export function useShortcutsMenu() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}

export type ShortcutsMenuState = ReturnType<typeof useShortcutsMenu>;

/**
 * One header button that opens the Shortcuts: a dropdown on wide screens, a full-width
 * disclosure on narrow ones (CSS). Closes on Esc (focus back to the button), on a click
 * outside, and after opening a Shortcut. Arrow keys move through the filter and the items.
 */
export function ShortcutsMenu({
  shortcuts,
  menu,
  onManage,
}: {
  shortcuts: Shortcut[];
  menu: ShortcutsMenuState;
  onManage: () => void;
}) {
  const { open, setOpen } = menu;
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const filterable = shortcuts.length >= FILTER_FROM;
  const needle = fold(query.trim());
  const shown = needle === "" ? shortcuts : shortcuts.filter((s) => fold(s.name).includes(needle));

  // On open, focus the filter field, or the first Shortcut when there is none.
  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    panelRef.current?.querySelector<HTMLElement>("input, a")?.focus();
  }, [open]);

  // A click outside closes the menu.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, setOpen]);

  if (shortcuts.length === 0) return null;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    // Home / End stay in the filter field, where they move the caret.
    if ((e.key === "Home" || e.key === "End") && e.target instanceof HTMLInputElement) return;
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>("input, a, button") ?? [])];
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "ArrowDown") next = Math.min(at + 1, items.length - 1);
    else next = Math.max(at - 1, 0);
    items[next]!.focus();
  }

  return (
    <div ref={rootRef} className="shortcuts-menu" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="shortcuts-button"
        aria-expanded={open}
        aria-controls="shortcuts-panel"
        aria-keyshortcuts="g"
        title="Shortcuts (g)"
        onClick={() => setOpen(!open)}
      >
        Shortcuts<span className="shortcuts-count"> · {shortcuts.length}</span>
        <span className="shortcuts-chevron" aria-hidden="true" />
      </button>
      <nav ref={panelRef} id="shortcuts-panel" aria-label="Shortcuts" className="shortcuts-panel" hidden={!open}>
        {filterable && (
          <input
            type="search"
            className="shortcuts-filter"
            aria-label="Filter Shortcuts"
            placeholder="Filter Shortcuts"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {shown.length === 0 ? (
          <p className="hint shortcuts-none">No Shortcut matches “{query.trim()}”.</p>
        ) : (
          <ul>
            {shown.map((s) => (
              <li key={s.id}>
                <ShortcutLink shortcut={s} onOpen={() => setOpen(false)} />
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="shortcuts-manage"
          onClick={() => {
            setOpen(false);
            onManage();
          }}
        >
          Manage Shortcuts
        </button>
      </nav>
    </div>
  );
}

/** The Shortcuts section of the Companies tab: list, add, rename, remove. */
export function ShortcutsSection({ state }: { state: ShortcutsState }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await state.add(name, url);
      setName("");
      setUrl("");
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="shortcuts-heading" className="managed-section">
      <h2 id="shortcuts-heading" ref={headingRef} tabIndex={-1}>
        Shortcuts
      </h2>
      <p className="hint">Careers sites whose Jobs can't be read automatically. They open in a new tab.</p>
      {state.loadError && <p role="alert" className="error">{state.loadError}</p>}
      {state.shortcuts.length === 0 ? (
        <p className="hint">No Shortcuts yet.</p>
      ) : (
        <ul className="managed-list">
          {state.shortcuts.map((s) => (
            <ShortcutRow key={s.id} shortcut={s} state={state} afterRemoveFocus={headingRef} />
          ))}
        </ul>
      )}
      <form className="shortcut-add" onSubmit={onAdd} noValidate>
        <label>
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required />
        </label>
        <label>
          <span>Link</span>
          <input
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            autoComplete="off"
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "shortcut-add-error" : undefined}
          />
        </label>
        <button type="submit" disabled={busy}>
          Add Shortcut
        </button>
      </form>
      {error && (
        <p id="shortcut-add-error" role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}

function ShortcutRow({
  shortcut,
  state,
  afterRemoveFocus,
}: {
  shortcut: Shortcut;
  state: ShortcutsState;
  afterRemoveFocus: RefObject<HTMLElement | null>;
}) {
  return (
    <ManagedRow
      name={shortcut.name}
      onRename={(name) => state.rename(shortcut.id, name)}
      onRemove={() => state.remove(shortcut.id)}
      afterRemoveFocus={afterRemoveFocus}
    >
      <ShortcutLink shortcut={shortcut} className="shortcut-name" />
      <span className="managed-detail">{shortcut.url}</span>
    </ManagedRow>
  );
}
