// The "?" help: a modal dialog listing every keyboard shortcut, opened by `?` or the header button.
import { useRef, type Ref } from "react";

const shortcuts: { keys: string[]; does: string }[] = [
  { keys: ["j", "k"], does: "Select the next / previous Job" },
  { keys: ["Enter"], does: "Open the selected Job in a new tab" },
  { keys: ["e"], does: "Toggle Seen on the selected Job" },
  { keys: ["s"], does: "Toggle Saved on the selected Job" },
  { keys: ["a"], does: "Toggle Applied on the selected Job" },
  { keys: ["u"], does: "Undo the last status change" },
  { keys: ["/"], does: "Focus the search" },
  { keys: ["Esc"], does: "Clear the search" },
  { keys: ["g"], does: "Open the Shortcuts menu" },
  { keys: ["?"], does: "Show these shortcuts" },
];

/** Open / close the help dialog; focus returns to whatever had it before (native `<dialog>` behaviour). */
export function useKeyboardHelp() {
  const ref = useRef<HTMLDialogElement>(null);
  return {
    ref,
    open: () => {
      const dialog = ref.current;
      if (!dialog || dialog.open) return false;
      dialog.showModal();
    },
  };
}

export function KeyboardHelpButton({ onOpen }: { onOpen: () => unknown }) {
  return (
    <button type="button" className="help-button" aria-keyshortcuts="?" title="Keyboard shortcuts (?)" onClick={onOpen}>
      <span aria-hidden="true">?</span>
      <span className="visually-hidden">Keyboard shortcuts</span>
    </button>
  );
}

export function KeyboardHelp({ ref }: { ref: Ref<HTMLDialogElement> }) {
  return (
    <dialog ref={ref} className="help-dialog" aria-labelledby="help-title">
      <h2 id="help-title">Keyboard shortcuts</h2>
      <p className="hint">They work anywhere except while typing in a text field.</p>
      <dl className="help-keys">
        {shortcuts.map((s) => (
          <div key={s.keys.join()}>
            <dt>
              {s.keys.map((k, i) => (
                <span key={k}>
                  {i > 0 && " / "}
                  <kbd>{k}</kbd>
                </span>
              ))}
            </dt>
            <dd>{s.does}</dd>
          </div>
        ))}
      </dl>
      <form method="dialog">
        <button type="submit" autoFocus>
          Close
        </button>
      </form>
    </dialog>
  );
}
