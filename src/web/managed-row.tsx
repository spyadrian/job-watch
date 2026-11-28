import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";

/** One field of a row's inline edit form. */
export interface EditField {
  key: string;
  /** Visible label. Without one, `ariaLabel` names the input. */
  label?: string;
  ariaLabel?: string;
  value: string;
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
  /** Whether a server message is about this field; the field is then marked invalid. */
  isInvalid?: (message: string) => boolean;
}

/** What a row's edit button does: its text, the fields of its inline form, and how to save them. */
export interface EditAction {
  /** Button text, e.g. "Rename"; its accessible name is "<verb> <name>". */
  verb: string;
  fields: EditField[];
  onSave: (values: Record<string, string>) => Promise<void>;
}

/** The single-field Rename used by followed Companies. */
export function renameAction(name: string, onRename: (name: string) => Promise<void>): EditAction {
  return {
    verb: "Rename",
    fields: [{ key: "name", ariaLabel: `New name for ${name}`, value: name }],
    onSave: (values) => onRename(values.name ?? ""),
  };
}

/**
 * One row of a list the person manages (followed Companies, Shortcuts): shows
 * `children`, with the `edit` action (inline form, Esc cancels) and Remove. A failed
 * action shows the server's message in the row. After Save or Cancel, focus goes back
 * to the edit button; after Remove, to `afterRemoveFocus`.
 */
export function ManagedRow({
  name,
  edit,
  onRemove,
  afterRemoveFocus,
  children,
}: {
  name: string;
  edit: EditAction;
  onRemove: () => Promise<void>;
  afterRemoveFocus: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const errorId = useId();

  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      editRef.current?.focus();
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

  function startEditing() {
    setDrafts(Object.fromEntries(edit.fields.map((f) => [f.key, f.value])));
    setEditing(true);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (await run(() => edit.onSave(drafts))) {
      returnFocus.current = true;
      setEditing(false);
    }
  }

  function onCancel() {
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
        <form
          className={edit.fields.some((f) => f.label) ? "managed-rename managed-edit" : "managed-rename"}
          onSubmit={onSave}
          onKeyDown={(e) => e.key === "Escape" && onCancel()}
          noValidate
        >
          {edit.fields.map((field, i) => {
            const invalid = error !== null && field.isInvalid?.(error) === true;
            const input = (
              <input
                {...field.inputProps}
                aria-label={field.label ? undefined : field.ariaLabel}
                value={drafts[field.key] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [field.key]: e.target.value }))}
                autoFocus={i === 0}
                aria-invalid={invalid ? true : undefined}
                aria-describedby={invalid ? errorId : undefined}
              />
            );
            return field.label ? (
              <label key={field.key}>
                <span>{field.label}</span>
                {input}
              </label>
            ) : (
              <Fragment key={field.key}>{input}</Fragment>
            );
          })}
          <button type="submit">Save</button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          {children}
          <span className="row-actions">
            <button ref={editRef} type="button" aria-label={`${edit.verb} ${name}`} onClick={startEditing}>
              {edit.verb}
            </button>
            <button type="button" aria-label={`Remove ${name}`} onClick={onRemoveClick}>
              Remove
            </button>
          </span>
        </>
      )}
      {error && (
        <p id={errorId} role="alert" className="error">
          {error}
        </p>
      )}
    </li>
  );
}
