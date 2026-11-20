import { useId, useState, type FormEvent, type Ref } from "react";
import type { Candidate, CreateCompanyResponse, DiscoverResponse } from "../shared/types.ts";
import { call } from "./api.ts";
import { plural } from "./plural.ts";

type Step =
  | { kind: "idle" }
  | { kind: "found"; candidates: Candidate[]; unreachable?: string }
  | { kind: "done"; message: string };

/** Job board kinds named in the hint; one line per supported ATS. */
const SUPPORTED_BOARDS = [
  "Greenhouse",
  "Lever",
  "Ashby",
  "SmartRecruiters",
  "Recruitee",
  "Workable",
  "Personio",
  "BambooHR",
  "iCIMS (Jibe)",
  "Workday",
  "Oracle Cloud HCM",
  "Eightfold",
];
const supportedBoards = new Intl.ListFormat("en", { type: "disjunction" }).format(SUPPORTED_BOARDS);

/**
 * What the Shortcut offered after an empty search is prefilled with: from a link,
 * a name guessed from its host and the link itself; from a name, that name.
 */
export function shortcutDraft(input: string): { name: string; url: string } {
  const text = input.trim();
  if (/\s/.test(text) || !text.includes(".")) return { name: text, url: "" };
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const host = new URL(url).hostname.replace(/^(?:www|careers|jobs|karriere)\./, "");
    const word = host.split(".")[0] ?? "";
    return { name: word ? word[0]!.toUpperCase() + word.slice(1) : "", url };
  } catch {
    return { name: "", url: text };
  }
}

/**
 * The add form of the Companies tab: paste a link (job board, Job, feed or
 * careers page) or type a name, pick among the candidates found, edit the name,
 * then Follow or Cancel. Nothing is saved before Follow. When nothing is found,
 * offers to add a Shortcut instead.
 */
export function FollowCompany({
  onFollowed,
  onAddShortcut,
  inputRef,
}: {
  onFollowed: () => void;
  onAddShortcut: (name: string, url: string) => Promise<void>;
  /** The link-or-name input, for callers that bring the person straight to it. */
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [input, setInput] = useState("");
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [chosen, setChosen] = useState(0);
  const [name, setName] = useState("");
  const [shortcut, setShortcut] = useState({ name: "", url: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = useId();

  async function onFind(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setStep({ kind: "idle" });
    try {
      const { candidates, unreachable } = await call<DiscoverResponse>("POST", "/api/companies/discover", { input });
      setStep({ kind: "found", candidates, unreachable });
      setChosen(0);
      setName(candidates[0]?.suggestedName ?? "");
      setShortcut(shortcutDraft(input));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function choose(index: number, candidates: Candidate[]) {
    setChosen(index);
    setName(candidates[index]!.suggestedName);
  }

  async function onFollow(e: FormEvent, candidate: Candidate) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { company, jobCount } = await call<CreateCompanyResponse>("POST", "/api/companies", {
        source: candidate.source,
        name,
      });
      setStep({ kind: "done", message: `Following ${company.name}: ${plural(jobCount, "job")} added to your Inbox.` });
      setInput("");
      onFollowed();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onShortcut(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onAddShortcut(shortcut.name, shortcut.url);
      setStep({ kind: "done", message: `Added ${shortcut.name.trim()} to your Shortcuts.` });
      setInput("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onCancel() {
    setStep({ kind: "idle" });
    setError(null);
  }

  const candidates = step.kind === "found" ? step.candidates : [];
  const candidate = candidates[chosen];
  const nothingFound = step.kind === "found" && candidates.length === 0;

  return (
    <section aria-labelledby={`${ids}-heading`} className="follow-company form-section">
      <h2 id={`${ids}-heading`}>Follow a Company</h2>
      <p className="hint">
        Paste the link of a {supportedBoards} job board, of one of its Jobs, of an RSS/Atom job feed or of the
        company's careers page, or type the company's name.
      </p>
      <form className="inline-form" onSubmit={onFind} noValidate>
        <label className="grow">
          <span>Link or Company name</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://job-boards.greenhouse.io/… or Acme"
            autoComplete="off"
            required
            aria-invalid={error && step.kind === "idle" ? true : undefined}
            aria-describedby={error ? `${ids}-error` : undefined}
          />
        </label>
        <button type="submit" className="primary" disabled={busy || !input.trim()}>
          {busy && step.kind === "idle" ? "Looking…" : "Find jobs"}
        </button>
      </form>

      <div aria-live="polite">
        {nothingFound && step.unreachable && <p className="error result">{step.unreachable}.</p>}
        {nothingFound && (
          <p className="hint result">
            {step.unreachable ? "Add it as a Shortcut instead?" : "No supported job board found. Add it as a Shortcut instead?"}
          </p>
        )}
        {step.kind === "done" && <p className="success result">{step.message}</p>}
      </div>

      {nothingFound && (
        <form className="candidate" onSubmit={onShortcut} aria-label="Add as a Shortcut" noValidate>
          <label className="grow">
            <span>Shortcut name</span>
            <input
              value={shortcut.name}
              onChange={(e) => setShortcut({ ...shortcut, name: e.target.value })}
              autoComplete="off"
              required
            />
          </label>
          <label className="grow">
            <span>Shortcut link</span>
            <input
              type="url"
              inputMode="url"
              value={shortcut.url}
              onChange={(e) => setShortcut({ ...shortcut, url: e.target.value })}
              placeholder="https://"
              autoComplete="off"
              required
            />
          </label>
          <div className="row-actions">
            <button type="submit" className="primary" disabled={busy || !shortcut.name.trim() || !shortcut.url.trim()}>
              Add as a Shortcut
            </button>
            <button type="button" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {candidate && (
        <form className="candidate" onSubmit={(e) => onFollow(e, candidate)} aria-labelledby={`${ids}-found`}>
          {candidates.length > 1 ? (
            <fieldset>
              <legend id={`${ids}-found`}>Choose a job board</legend>
              {candidates.map((c, i) => (
                <label key={`${c.source.type}:${c.source.key}`} className="choice">
                  <input type="radio" name="candidate" checked={i === chosen} onChange={() => choose(i, candidates)} />
                  {c.suggestedName} · {c.sourceLabel} · {plural(c.jobCount, "job")}
                  {c.alreadyFollowing !== null && " · already followed"}
                </label>
              ))}
            </fieldset>
          ) : (
            <p id={`${ids}-found`} className="found" role="status">
              <strong>{plural(candidate.jobCount, "job")} found</strong> on {candidate.sourceLabel} ({candidate.source.key})
            </p>
          )}
          {candidate.alreadyFollowing !== null ? (
            <p className="error">Already following {candidate.alreadyFollowing}</p>
          ) : (
            <label className="grow">
              <span>Company name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required />
            </label>
          )}
          <div className="row-actions">
            {candidate.alreadyFollowing === null && (
              <button type="submit" className="primary" disabled={busy || !name.trim()}>
                Follow
              </button>
            )}
            <button type="button" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p id={`${ids}-error`} role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
