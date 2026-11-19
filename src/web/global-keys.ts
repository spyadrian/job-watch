import { useEffect, useRef } from "react";

/** Handlers by `KeyboardEvent.key` (e.g. "/", "Escape", "j"). A handler returning `false` lets the key through. */
export type KeyHandlers = Partial<Record<string, (e: KeyboardEvent) => boolean | void>>;

/** Whether keyboard focus is in a place where keys are text: inputs, textareas, selects, contenteditable. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "submit", "reset", "file", "image", "range", "color"].includes(target.type);
  }
  return false;
}

/**
 * Page-wide keyboard shortcuts. Ignored while typing in a text field, inside an open dialog
 * (the page behind a modal is inert), and when Ctrl, Alt or Meta is held, so they never steal
 * a character or a browser shortcut. A handled key's default is prevented.
 */
export function useGlobalKeys(handlers: KeyHandlers): void {
  const current = useRef(handlers);
  current.current = handlers;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
      if (isTyping(e.target)) return;
      if (e.target instanceof Element && e.target.closest("dialog[open]")) return;
      const handler = current.current[e.key];
      if (!handler) return;
      if (handler(e) === false) return;
      e.preventDefault();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
