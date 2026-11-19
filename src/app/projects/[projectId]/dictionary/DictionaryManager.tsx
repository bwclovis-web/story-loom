"use client";
import { Button } from "@/components/ui/Button";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import {
  defaultCaseSensitive,
  DictionaryMatcher,
  similarDictionaryWords,
  type DictionaryScope,
  type DictionaryWord,
} from "@/spelling/dictionary";
import { classifyImport, parseDictionaryImport, type ImportCandidate } from "@/spelling/dictionaryFile";
import type { DictionaryEntryView, ReferenceTermSuggestion } from "@/server/services/dictionaryService";
import { DICTIONARY } from "@/ui/labels";
import {
  addDictionaryWordAction,
  addDictionaryWordsAction,
  findReferenceNamesAction,
  removeDictionaryWordAction,
  updateDictionaryWordAction,
  type BulkActionResult,
} from "./actions";

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const ORIGIN_LABELS: Record<string, string> = {
  manual: "added here",
  editor: "added from the editor",
  import: "imported",
  reference: "from reference names",
};

type Message = { ok: boolean; text: string } | null;

function MessageLine({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <div className={`small ${message.ok ? "" : "error-text"}`} role="status">
      {message.text}
    </div>
  );
}

function ScopeSelect({ value, onChange }: { value: DictionaryScope; onChange: (scope: DictionaryScope) => void }) {
  return (
    <label className="inline">
      {DICTIONARY.scope}
      <select value={value} onChange={(e) => onChange(e.target.value as DictionaryScope)}>
        <option value="project">{DICTIONARY.scopeProject}</option>
        <option value="workspace">{DICTIONARY.scopeWorkspace}</option>
      </select>
    </label>
  );
}

function AddForm({ projectId }: { projectId: string }) {
  const [word, setWord] = useState("");
  const [scope, setScope] = useState<DictionaryScope>("project");
  // Null until the author ticks or unticks the box: then names keep their capitals and other words do not.
  const [matchCase, setMatchCase] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const caseSensitive = matchCase ?? defaultCaseSensitive(word.trim());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await addDictionaryWordAction(projectId, { word, caseSensitive, scope, note }, false);
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) {
        setWord("");
        setNote("");
        setMatchCase(null);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="row">
        <label>
          {DICTIONARY.word}
          <input type="text" value={word} onChange={(e) => setWord(e.target.value)} required spellCheck={false} />
        </label>
        <label style={{ flex: 1 }}>
          {DICTIONARY.note}
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </label>
      </div>
      <div className="row">
        <ScopeSelect value={scope} onChange={setScope} />
        <label className="inline">
          <input type="checkbox" checked={caseSensitive} onChange={(e) => setMatchCase(e.target.checked)} />
          {DICTIONARY.matchCase}
        </label>
        <Button type="submit" disabled={busy}>
          {DICTIONARY.add}
        </Button>
      </div>
      <MessageLine message={message} />
    </form>
  );
}

function EntryRow({ projectId, entry, similar }: { projectId: string; entry: DictionaryEntryView; similar: string[] }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState({ word: entry.word, caseSensitive: entry.caseSensitive, note: entry.note, scope: entry.scope });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const run = async (action: () => Promise<{ ok: boolean; message: string }>, onOk: () => void) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      if (result.ok) onOk();
      else setMessage({ ok: false, text: result.message });
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <tr>
        <td>
          <input
            type="text"
            aria-label={DICTIONARY.word}
            value={draft.word}
            onChange={(e) => setDraft({ ...draft, word: e.target.value })}
            spellCheck={false}
          />
          <MessageLine message={message} />
        </td>
        <td>
          <input
            type="checkbox"
            aria-label={DICTIONARY.matchCase}
            checked={draft.caseSensitive}
            onChange={(e) => setDraft({ ...draft, caseSensitive: e.target.checked })}
          />
        </td>
        <td>
          <input
            type="text"
            aria-label={DICTIONARY.note}
            value={draft.note}
            maxLength={200}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          />
          <ScopeSelect value={draft.scope} onChange={(scope) => setDraft({ ...draft, scope })} />
        </td>
        <td />
        <td>
          <div className="row">
            <Button
              type="button"
              disabled={busy}
              onClick={() => run(() => updateDictionaryWordAction(projectId, entry.id, draft), () => setEditing(false))}
            >
              {DICTIONARY.save}
            </Button>
            <Button type="button" disabled={busy} onClick={() => setEditing(false)} variant="secondary">
              {DICTIONARY.cancel}
            </Button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <strong>{entry.word}</strong>
        <div className="small muted">{ORIGIN_LABELS[entry.origin] ?? entry.origin}</div>
        <MessageLine message={message} />
      </td>
      <td>{entry.caseSensitive ? "yes" : "no"}</td>
      <td className="small">{entry.note}</td>
      <td className="small warning-text">{similar.length ? `${DICTIONARY.similar} ${similar.join(", ")}` : ""}</td>
      <td>
        {confirming ? (
          <div className="row">
            <Button
              type="button"
             
              disabled={busy}
              onClick={() => run(() => removeDictionaryWordAction(projectId, entry.id), () => setConfirming(false))}
             variant="danger">
              {DICTIONARY.confirmRemove} &ldquo;{entry.word}&rdquo;
            </Button>
            <Button type="button" disabled={busy} onClick={() => setConfirming(false)} variant="secondary">
              {DICTIONARY.cancel}
            </Button>
          </div>
        ) : (
          <div className="row">
            <Button
              type="button"
             
              onClick={() => {
                setDraft({ word: entry.word, caseSensitive: entry.caseSensitive, note: entry.note, scope: entry.scope });
                setEditing(true);
              }}
             variant="secondary">
              {DICTIONARY.edit}
            </Button>
            <Button type="button" onClick={() => setConfirming(true)} variant="secondary">
              {DICTIONARY.remove}
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

function EntryTable({
  projectId,
  heading,
  entries,
  all,
}: {
  projectId: string;
  heading: string;
  entries: DictionaryEntryView[];
  all: DictionaryEntryView[];
}) {
  return (
    <section className="panel">
      <h2>
        {heading} <span className="muted small">({entries.length})</span>
      </h2>
      {entries.length === 0 ? (
        <p className="muted small">{DICTIONARY.empty}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{DICTIONARY.word}</th>
              <th>{DICTIONARY.matchCase}</th>
              <th>Note</th>
              <th>Check</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <EntryRow
                key={`${e.id}-${e.updatedAt}`}
                projectId={projectId}
                entry={e}
                similar={similarDictionaryWords(
                  e.word,
                  all.filter((o) => o.id !== e.id),
                )}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function BulkResult({ result }: { result: BulkActionResult | null }) {
  if (!result) return null;
  return (
    <div className="stack small" role="status">
      <div className={result.ok ? "" : "error-text"}>{result.message}</div>
      {result.skipped.length > 0 ? (
        <ul>
          {result.skipped.map((s, i) => (
            <li key={i}>
              <strong>{s.word}</strong>: {s.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ImportSection({ projectId, existing }: { projectId: string; existing: DictionaryWord[] }) {
  const [parsed, setParsed] = useState<{ fileName: string; kind: string; candidates: ImportCandidate[] } | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [caseOverride, setCaseOverride] = useState<Map<number, boolean>>(new Map());
  const [scope, setScope] = useState<DictionaryScope>("project");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkActionResult | null>(null);

  const rows = useMemo(() => {
    if (!parsed) return [];
    const withCase = parsed.candidates.map((c) =>
      caseOverride.has(c.position) ? { ...c, caseSensitive: caseOverride.get(c.position)! } : c,
    );
    return classifyImport(withCase, existing);
  }, [parsed, caseOverride, existing]);
  const chosen = rows.filter((r) => r.status === "new" && selected.has(r.position));
  const newCount = rows.filter((r) => r.status === "new").length;

  const onFile = async (file: File | undefined) => {
    setParsed(null);
    setError("");
    setResult(null);
    setSelected(new Set());
    setCaseOverride(new Map());
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setError("That file is larger than 2 MB, which is too large for a dictionary.");
      return;
    }
    const outcome = parseDictionaryImport(await file.text());
    if (!outcome.ok) setError(outcome.message);
    else setParsed({ fileName: file.name, kind: outcome.kind, candidates: outcome.candidates });
  };

  const toggle = (position: number, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(position);
    else next.delete(position);
    setSelected(next);
  };

  const add = async () => {
    setBusy(true);
    setResult(null);
    try {
      const items = chosen.map((c) => ({ word: c.word, caseSensitive: c.caseSensitive, note: c.note }));
      setResult(await addDictionaryWordsAction(projectId, scope, items, "import"));
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel stack">
      <h2>{DICTIONARY.importHeading}</h2>
      <p className="small muted" style={{ margin: 0 }}>
        {DICTIONARY.importNote}
      </p>
      <label>
        {DICTIONARY.importFile}
        <input type="file" accept=".json,.txt,.dic,application/json,text/plain" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {error ? <div className="small error-text">{error}</div> : null}
      {parsed ? (
        <>
          <div className="small muted">
            {parsed.fileName}: {parsed.kind === "wordly" ? "Story Loom dictionary file" : "word list"}, {rows.length} word
            {rows.length === 1 ? "" : "s"}, {newCount} new.
          </div>
          <div className="row">
            <Button type="button" disabled={newCount === 0} onClick={() => setSelected(new Set(rows.filter((r) => r.status === "new").map((r) => r.position)))} variant="secondary">
              {DICTIONARY.selectAllNew}
            </Button>
            <Button type="button" disabled={selected.size === 0} onClick={() => setSelected(new Set())} variant="secondary">
              {DICTIONARY.selectNone}
            </Button>
            <ScopeSelect value={scope} onChange={setScope} />
            <Button type="button" disabled={busy || chosen.length === 0} onClick={add}>
              {DICTIONARY.addSelected(chosen.length)}
            </Button>
          </div>
          <BulkResult result={result} />
          <table>
            <thead>
              <tr>
                <th>Add</th>
                <th>{DICTIONARY.word}</th>
                <th>{DICTIONARY.matchCase}</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.position}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Add ${r.word}`}
                      disabled={r.status !== "new"}
                      checked={r.status === "new" && selected.has(r.position)}
                      onChange={(e) => toggle(r.position, e.target.checked)}
                    />
                  </td>
                  <td>{r.word}</td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${DICTIONARY.matchCase}: ${r.word}`}
                      disabled={r.status === "invalid"}
                      checked={r.caseSensitive}
                      onChange={(e) => setCaseOverride(new Map(caseOverride).set(r.position, e.target.checked))}
                    />
                  </td>
                  <td className="small">{r.note}</td>
                  <td className={`small ${r.status === "invalid" ? "error-text" : "muted"}`}>{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}

function ReferenceSection({ projectId, language, matcher }: { projectId: string; language: string; matcher: DictionaryMatcher }) {
  const [found, setFound] = useState<ReferenceTermSuggestion[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [caseOverride, setCaseOverride] = useState<Map<string, boolean>>(new Map());
  const [scope, setScope] = useState<DictionaryScope>("project");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BulkActionResult | null>(null);

  const visible = (found ?? []).filter((s) => !matcher.accepts(s.word));
  const caseOf = (s: ReferenceTermSuggestion) => caseOverride.get(s.word) ?? s.caseSensitive;
  const chosen = visible.filter((s) => selected.has(s.word));

  const find = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setFound(await findReferenceNamesAction(projectId, language));
      setSelected(new Set());
      setCaseOverride(new Map());
    } catch {
      setError("Reference names could not be read. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    setBusy(true);
    setResult(null);
    try {
      const items = chosen.map((s) => ({ word: s.word, caseSensitive: caseOf(s) }));
      setResult(await addDictionaryWordsAction(projectId, scope, items, "reference"));
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel stack">
      <h2>{DICTIONARY.referencesHeading}</h2>
      <p className="small muted" style={{ margin: 0 }}>
        {DICTIONARY.referencesNote}
      </p>
      <div>
        <Button type="button" disabled={busy} onClick={find} variant="secondary">
          {DICTIONARY.findNames}
        </Button>
      </div>
      {error ? <div className="small error-text">{error}</div> : null}
      <BulkResult result={result} />
      {found !== null && visible.length === 0 ? <p className="small muted">{DICTIONARY.noNames}</p> : null}
      {visible.length > 0 ? (
        <>
          <div className="row">
            <ScopeSelect value={scope} onChange={setScope} />
            <Button type="button" disabled={busy || chosen.length === 0} onClick={add}>
              {DICTIONARY.addSelected(chosen.length)}
            </Button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Add</th>
                <th>{DICTIONARY.word}</th>
                <th>{DICTIONARY.matchCase}</th>
                <th>{DICTIONARY.foundIn}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.word}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Add ${s.word}`}
                      checked={selected.has(s.word)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(s.word);
                        else next.delete(s.word);
                        setSelected(next);
                      }}
                    />
                  </td>
                  <td>{s.word}</td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${DICTIONARY.matchCase}: ${s.word}`}
                      checked={caseOf(s)}
                      onChange={(e) => setCaseOverride(new Map(caseOverride).set(s.word, e.target.checked))}
                    />
                  </td>
                  <td className="small">
                    {s.sources.map((src, i) => (
                      <span key={src.recordId}>
                        {i > 0 ? ", " : ""}
                        <Link href={`/projects/${projectId}/records/${src.recordId}`}>{src.title}</Link>
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}

export function DictionaryManager({
  projectId,
  projectTitle,
  workspaceName,
  language,
  project,
  workspace,
}: {
  projectId: string;
  projectTitle: string;
  workspaceName: string;
  language: string;
  project: DictionaryEntryView[];
  workspace: DictionaryEntryView[];
}) {
  const all = useMemo(() => [...project, ...workspace], [project, workspace]);
  const matcher = useMemo(() => new DictionaryMatcher(all), [all]);
  const base = `/projects/${projectId}/dictionary/export`;

  return (
    <>
      <section className="panel">
        <h2>{DICTIONARY.addHeading}</h2>
        <AddForm projectId={projectId} />
      </section>
      <EntryTable projectId={projectId} heading={`${DICTIONARY.scopeProject}: ${projectTitle}`} entries={project} all={all} />
      <EntryTable projectId={projectId} heading={`Workspace: ${workspaceName}`} entries={workspace} all={all} />
      <ReferenceSection projectId={projectId} language={language} matcher={matcher} />
      <ImportSection projectId={projectId} existing={all} />
      <section className="panel stack">
        <h2>{DICTIONARY.exportHeading}</h2>
        <div className="row">
          <a href={`${base}?scope=project`}>{DICTIONARY.exportScope("project")}</a>
          <a href={`${base}?scope=workspace`}>{DICTIONARY.exportScope("workspace")}</a>
        </div>
      </section>
    </>
  );
}
