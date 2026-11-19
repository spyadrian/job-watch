import type { Ref } from "react";

/** The search field over the list being viewed. `/` (see App) focuses it; Esc clears it. */
export function SearchBox({
  ref,
  value,
  onChange,
}: {
  ref: Ref<HTMLInputElement>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div role="search" className="search">
      <input
        ref={ref}
        type="search"
        aria-label="Search"
        aria-keyshortcuts="/"
        placeholder="Search title, Company, location"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onChange("");
          }
        }}
      />
      <kbd className="search-key" aria-hidden="true">
        /
      </kbd>
    </div>
  );
}
