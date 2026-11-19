import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";

/**
 * One row of a list the person manages (followed Companies, Shortcuts): shows
 * `children`, with Rename (inline form, Esc cancels) and Remove. A failed action
 * shows the server's message in the row. After Save or Cancel, focus goes back to
 * Rename; after Remove, to `afterRemoveFocus`.
 */
export function ManagedRow({
  name,
  onRename,
  onRemove,
  afterRemoveFocus,
  children,
}: {
  name: string;
  onRename: (name: string) => Promise<void>;
  onRemove: () => Promise<void>;
  afterRemoveFocus: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const renameRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

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
    if (await run(() => onRename(draft))) {
      returnFocus.current = true;
      setEditing(false);
    }
  }

  function onCancel() {
    setDraft(name);
    setError(null);
    returnFocus.current = true;
    setEditing(false);
  }

  async function onRemoveClick() {
    if (await run(onRemove)) afterRemoveFocus.current?.focus();
  }

  return (
    <li className="managed-row">
      {editing ? (
        <form className="managed-rename" onSubmit={onSave} onKeyDown={(e) => e.key === "Escape" && onCancel()}>
          <input aria-label={`New name for ${name}`} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          <button type="submit">Save</button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          {children}
          <span className="row-actions">
            <button
              ref={renameRef}
              type="button"
              aria-label={`Rename ${name}`}
              onClick={() => {
                setDraft(name);
                setEditing(true);
              }}
            >
              Rename
            </button>
            <button type="button" aria-label={`Remove ${name}`} onClick={onRemoveClick}>
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
