import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import type { Shortcut } from "../shared/types.ts";
import { call } from "./api.ts";
import { ManagedRow } from "./managed-row.tsx";

export interface ShortcutsState {
  shortcuts: Shortcut[];
  /** Set when the list could not be loaded. */
  loadError: string | null;
  /** Loads the list again, e.g. after an import. */
  reload(): void;
  add(name: string, url: string): Promise<void>;
  rename(id: number, name: string): Promise<void>;
  remove(id: number): Promise<void>;
}

/** Shortcuts shared by the header and the Companies tab. Mutations throw with the server's message. */
export function useShortcuts(): ShortcutsState {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(() => {
    let cancelled = false;
    call<{ shortcuts: Shortcut[] }>("GET", "/api/shortcuts")
      .then((data) => {
        if (cancelled) return;
        setShortcuts(data.shortcuts);
        setLoadError(null);
      })
      .catch((err: Error) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(reload, [reload]);

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

  return { shortcuts, loadError, reload, add, rename, remove };
}

function ShortcutLink({ shortcut, className }: { shortcut: Shortcut; className?: string }) {
  return (
    <a href={shortcut.url} target="_blank" rel="noopener noreferrer" className={className}>
      {shortcut.name}
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}

/** Small links in the app header. */
export function HeaderShortcuts({ shortcuts }: { shortcuts: Shortcut[] }) {
  if (shortcuts.length === 0) return null;
  return (
    <nav aria-label="Shortcuts" className="header-shortcuts">
      <ul>
        {shortcuts.map((s) => (
          <li key={s.id}>
            <ShortcutLink shortcut={s} />
          </li>
        ))}
      </ul>
    </nav>
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
