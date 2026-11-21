"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import { Button, ButtonLink } from "@/components/ui/Button";
import { errorIssue, type Issue } from "@/domain/issues";
import { WORLD } from "@/ui/labels";
import {
  generateLanguageNames,
  MAX_GENERATED_NAMES,
  parseLanguageNamePatternSet,
} from "@/world/languageNamePatterns";
import { worldbuildingKindFromFields } from "@/world/worldKinds";
import { addGeneratedNameToDictionaryAction, createDossierFromGeneratedNameAction } from "./actions";

export interface LanguageNameSource {
  id: string;
  title: string;
  fields: unknown;
}

export function NameGenerator({ projectId, languages }: { projectId: string; languages: readonly LanguageNameSource[] }) {
  const router = useRouter();
  const [languageId, setLanguageId] = useState(languages[0]?.id ?? "");
  const [seed, setSeed] = useState("");
  const [count, setCount] = useState("8");
  const [scope, setScope] = useState<"project" | "workspace">("project");
  const [names, setNames] = useState<string[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();

  const selected = languages.find((row) => row.id === languageId) ?? null;
  const patternSet = useMemo(
    () => (selected ? parseLanguageNamePatternSet(selected.fields) : null),
    [selected],
  );

  const generate = () => {
    if (!patternSet) {
      setIssues([errorIssue("INVALID_REFERENCE", WORLD.nameGeneratorMissingPatterns)]);
      setNames([]);
      return;
    }
    const parsedCount = Number(count);
    if (!Number.isFinite(parsedCount) || parsedCount < 1) {
      setIssues([errorIssue("INVALID_CHANGE", WORLD.nameGeneratorCountInvalid)]);
      return;
    }
    setIssues([]);
    setNames(
      generateLanguageNames(patternSet, {
        count: Math.min(MAX_GENERATED_NAMES, Math.floor(parsedCount)),
        seed,
      }),
    );
  };

  const addToDictionary = (word: string) => {
    startTransition(async () => {
      const result = await addGeneratedNameToDictionaryAction(projectId, { word, scope });
      if (!result.ok) setIssues(result.issues);
      else setIssues([]);
    });
  };

  const createDossier = (title: string) => {
    startTransition(async () => {
      const result = await createDossierFromGeneratedNameAction(projectId, title);
      if (!result.ok) setIssues(result.issues);
      else router.push(`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(result.recordId)}`);
    });
  };

  if (!languages.length) {
    return (
      <div className="panel stack">
        <p className="muted">{WORLD.nameGeneratorNoLanguages}</p>
        <ButtonLink href={`/projects/${encodeURIComponent(projectId)}/world?type=worldbuilding`} variant="secondary">
          {WORLD.nameGeneratorOpenReferences}
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="muted">{WORLD.nameGeneratorLead}</p>
      <IssueList issues={issues} />
      <div className="panel stack">
        <label>
          {WORLD.nameGeneratorLanguage}
          <select value={languageId} onChange={(e) => setLanguageId(e.target.value)}>
            {languages.map((row) => (
              <option key={row.id} value={row.id}>
                {row.title}
                {worldbuildingKindFromFields(row.fields) === "language" ? "" : ""}
              </option>
            ))}
          </select>
        </label>
        {selected ? (
          <p className="small muted">
            <Link href={`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(selected.id)}`}>
              {WORLD.nameGeneratorEditLanguage}
            </Link>
            {patternSet ? null : ` · ${WORLD.nameGeneratorMissingPatterns}`}
          </p>
        ) : null}
        <div className="row" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
          <label>
            {WORLD.nameGeneratorSeed}
            <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder={WORLD.nameGeneratorSeedPlaceholder} />
          </label>
          <label>
            {WORLD.nameGeneratorCount}
            <input type="number" min={1} max={MAX_GENERATED_NAMES} value={count} onChange={(e) => setCount(e.target.value)} />
          </label>
          <label>
            {WORLD.nameGeneratorDictionaryScope}
            <select value={scope} onChange={(e) => setScope(e.target.value as "project" | "workspace")}>
              <option value="project">{WORLD.nameGeneratorScopeProject}</option>
              <option value="workspace">{WORLD.nameGeneratorScopeWorkspace}</option>
            </select>
          </label>
        </div>
        <Button type="button" disabled={pending || !patternSet} onClick={generate}>
          {WORLD.nameGeneratorGenerate}
        </Button>
      </div>
      {names.length ? (
        <ul className="stack" role="list">
          {names.map((name) => (
            <li key={name} className="panel row" style={{ justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
              <span>{name}</span>
              <span className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
                <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => addToDictionary(name)}>
                  {WORLD.nameGeneratorAddDictionary}
                </Button>
                <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => createDossier(name)}>
                  {WORLD.nameGeneratorCreateDossier}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{WORLD.nameGeneratorEmpty}</p>
      )}
    </div>
  );
}