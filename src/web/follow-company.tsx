import { useId, useState, type FormEvent } from "react";
import type { Candidate, CreateCompanyResponse, DiscoverResponse } from "../shared/types.ts";
import { call } from "./api.ts";

type Step =
  | { kind: "idle" }
  | { kind: "found"; candidates: Candidate[] }
  | { kind: "followed"; message: string };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The add form of the Companies tab: paste a link, see "N jobs found" with an
 * editable name, then Follow or Cancel. Nothing is saved before Follow.
 */
export function FollowCompany({ onFollowed }: { onFollowed: () => void }) {
  const [input, setInput] = useState("");
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [chosen, setChosen] = useState(0);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = useId();

  async function onFind(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setStep({ kind: "idle" });
    try {
      const { candidates } = await call<DiscoverResponse>("POST", "/api/companies/discover", { input });
      setStep({ kind: "found", candidates });
      setChosen(0);
      setName(candidates[0]?.suggestedName ?? "");
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
      setStep({ kind: "followed", message: `Following ${company.name}: ${plural(jobCount, "job")} added to your Inbox.` });
      setInput("");
      onFollowed();
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

  return (
    <section aria-labelledby={`${ids}-heading`} className="follow-company form-section">
      <h2 id={`${ids}-heading`}>Follow a Company</h2>
      <p className="hint">Paste the link of a Greenhouse job board or of one of its Jobs.</p>
      <form className="inline-form" onSubmit={onFind} noValidate>
        <label className="grow">
          <span>Link</span>
          <input
            type="url"
            inputMode="url"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://job-boards.greenhouse.io/…"
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
        {step.kind === "found" && candidates.length === 0 && (
          <p className="hint result">No supported job board found at this link.</p>
        )}
        {step.kind === "followed" && <p className="success result">{step.message}</p>}
      </div>

      {candidate && (
        <form className="candidate" onSubmit={(e) => onFollow(e, candidate)} aria-labelledby={`${ids}-found`}>
          {candidates.length > 1 ? (
            <fieldset>
              <legend id={`${ids}-found`}>Choose a job board</legend>
              {candidates.map((c, i) => (
                <label key={`${c.source.type}:${c.source.key}`} className="choice">
                  <input type="radio" name="candidate" checked={i === chosen} onChange={() => choose(i, candidates)} />
                  {c.suggestedName} · {c.sourceLabel} · {plural(c.jobCount, "job")}
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
