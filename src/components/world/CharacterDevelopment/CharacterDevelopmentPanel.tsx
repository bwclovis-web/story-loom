"use client";

import { useMemo, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { HelpPopover } from "@/components/ui/HelpPopover";
import { IssueList } from "@/components/IssueList";
import {
  ARCHETYPE_LIBRARY,
  ARC_MOVEMENTS,
  ARC_TEMPLATES,
  ENNEAGRAM_GUIDE,
  ENNEAGRAM_TYPES,
  IMPORTANCE_LEVELS,
  INHERITABLE_KEYS,
  MILESTONE_STATUSES,
  NARRATIVE_ROLES,
  PRESENCE_STATES,
  PSYCHOLOGY_TEXT_KEYS,
  STATE_FACETS,
  adjacentWings,
  characterProfileMarkdown,
  developmentIsEmpty,
  emptyCharacterDevelopment,
  forgottenArcs,
  milestoneFreshness,
  profileFreshness,
  type ArchetypeAssignment,
  type CharacterDevelopment,
  type DevelopmentArc,
  type EnneagramChoice,
  type EnneagramNumber,
  type ImportanceLevel,
  type InheritableKey,
  type InheritedTrait,
  type MilestoneLink,
  type NarrativeRole,
  type ProfileSuggestion,
  type ReviewObservation,
  type StateChange,
} from "@/domain/characterDevelopment";
import { AUTHORITY_STATUSES } from "@/domain/statuses";
import type { Issue } from "@/domain/issues";
import { CHARACTER_DEVELOPMENT as LABELS } from "@/ui/labels";
import {
  acceptCharacterReviewAction,
  acceptCharacterSuggestionsAction,
  markCharacterProfileCheckedAction,
  saveCharacterDevelopmentAction,
} from "@/app/projects/[projectId]/records/[recordId]/characterDevelopmentActions";

export interface DevelopmentChoice {
  id: string;
  label: string;
}

export interface DevelopmentCatalog {
  books: DevelopmentChoice[];
  characters: DevelopmentChoice[];
  relations: DevelopmentChoice[];
  events: DevelopmentChoice[];
  chapters: DevelopmentChoice[];
  scenes: DevelopmentChoice[];
  beats: DevelopmentChoice[];
  assistantConfigured: boolean;
}

const TABS = ["psychology", "archetypes", "arcs", "relationships", "history"] as const;
type TabId = (typeof TABS)[number];

function newId(prefix: string): string {
  const body = globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  return `${prefix}_${body}`;
}

function blankArc(): DevelopmentArc {
  return {
    id: newId("arc"),
    title: "",
    description: "",
    template: "positive_change",
    approval: "draft",
    movement: "progressing",
    scope: "series",
    bookProjectId: null,
    parentArcId: null,
    participantRecordIds: [],
    relationId: null,
    perceptions: [],
    startingState: "",
    desiredOutcome: "",
    startingBelief: "",
    emergingTruth: "",
    internalConflict: "",
    externalConflict: "",
    stakes: "",
    notes: "",
    milestones: [],
  };
}

function blankMilestone(): MilestoneLink {
  return {
    id: newId("mile"),
    title: "",
    summary: "",
    status: "planned",
    bookProjectId: null,
    chapterRecordId: null,
    sceneRecordId: null,
    passageExcerpt: "",
    passageRevision: null,
    passageHash: null,
    storyEventId: null,
    weaveBeatId: null,
    referenceRecordId: null,
    notes: "",
  };
}

export function CharacterDevelopmentPanel({
  projectId,
  recordId,
  title,
  revision,
  isProtected,
  initialProfile,
  catalog,
  traits,
  staleMilestoneIds,
}: {
  projectId: string;
  recordId: string;
  title: string;
  revision: number;
  isProtected: boolean;
  initialProfile: CharacterDevelopment;
  catalog: DevelopmentCatalog;
  traits: InheritedTrait[];
  staleMilestoneIds: string[];
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [tab, setTab] = useState<TabId>("psychology");
  const [expectedRevision, setExpectedRevision] = useState(revision);
  const [unlock, setUnlock] = useState(false);
  const [allowRewrite, setAllowRewrite] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, setPending] = useState(false);
  const [suggestions, setSuggestions] = useState<ProfileSuggestion[]>([]);
  const [pickedSuggestions, setPickedSuggestions] = useState<string[]>([]);
  const [observations, setObservations] = useState<ReviewObservation[]>([]);
  const [pickedNotes, setPickedNotes] = useState<number[]>([]);
  const freshness = profileFreshness(profile, expectedRevision);
  const forgotten = forgottenArcs(profile);
  const relationshipArcs = profile.arcs.filter(
    (arc) => arc.template === "relationship" || arc.relationId || arc.perceptions.length > 0,
  );

  const applyResult = (result: { ok: boolean; message?: string; issues?: Issue[]; revision?: number }) => {
    setMessage(result.message ?? null);
    setIssues(result.issues ?? []);
    if (result.ok && result.revision) setExpectedRevision(result.revision);
  };

  const save = async () => {
    setPending(true);
    try {
      applyResult(
        await saveCharacterDevelopmentAction(
          projectId,
          recordId,
          expectedRevision,
          JSON.stringify(profile),
          unlock,
          allowRewrite,
        ),
      );
    } finally {
      setPending(false);
    }
  };

  const ask = async (mode: "extract" | "review") => {
    setPending(true);
    setMessage(null);
    setIssues([]);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/character-development`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, recordId }),
      });
      const payload = (await response.json()) as {
        suggestions?: ProfileSuggestion[];
        observations?: ReviewObservation[];
        error?: { message?: string };
      };
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Nothing was saved.");
        return;
      }
      if (mode === "extract") {
        setSuggestions(payload.suggestions ?? []);
        setPickedSuggestions([]);
        setMessage(payload.suggestions?.length ? "Review the suggestions. Nothing is canon yet." : "No suggestions were returned.");
      } else {
        setObservations(payload.observations ?? []);
        setPickedNotes([]);
        setMessage(payload.observations?.length ? "Review the notes. The manuscript was not changed." : "No review notes were returned.");
      }
    } catch {
      setMessage("The suggestion could not be requested. Nothing was saved.");
    } finally {
      setPending(false);
    }
  };

  const download = () => {
    const blob = new Blob(
      [characterProfileMarkdown(title, profile), "\n", JSON.stringify(profile, null, 2)],
      { type: "text/markdown" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/[^\w.-]+/g, "-").slice(0, 40) || "character"}-profile.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const tabLabels: Record<TabId, string> = {
    psychology: LABELS.psychology,
    archetypes: LABELS.archetypes,
    arcs: LABELS.arcs,
    relationships: LABELS.relationships,
    history: LABELS.history,
  };

  return (
    <div className="stack">
      <p className="small muted">{LABELS.lead}</p>
      <p className="small muted">{LABELS.aid}</p>
      {profile.importance === "minor" ? <p className="small">{LABELS.minorHint}</p> : null}
      {freshness === "stale" ? <Banner tone="error">{LABELS.staleProfile}</Banner> : null}
      {freshness === "unchecked" ? <Banner>{LABELS.unchecked}</Banner> : null}
      {forgotten.length ? (
        <p className="small">
          {forgotten.map((arc) => arc.title || "Untitled arc").join(", ")} has no milestone yet.
        </p>
      ) : null}
      {message ? <Banner tone={issues.length ? "error" : "ok"}>{message}</Banner> : null}
      <IssueList issues={issues} />

      <div className="grid2">
        <label>
          {LABELS.importance}
          <HelpPopover label={LABELS.importance}>{LABELS.importanceHint}</HelpPopover>
          <select
            value={profile.importance ?? ""}
            onChange={(event) =>
              setProfile({ ...profile, importance: (event.target.value || null) as ImportanceLevel | null })
            }
          >
            <option value="">{LABELS.unset}</option>
            {IMPORTANCE_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <label>
          {LABELS.narrativeRole}
          <HelpPopover label={LABELS.narrativeRole}>{LABELS.roleHint}</HelpPopover>
          <select
            value={profile.narrativeRole ?? ""}
            onChange={(event) =>
              setProfile({ ...profile, narrativeRole: (event.target.value || null) as NarrativeRole | null })
            }
          >
            <option value="">{LABELS.unset}</option>
            {NARRATIVE_ROLES.map((role) => (
              <option key={role} value={role}>
                {role.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="context-tabs" role="tablist" aria-label={LABELS.heading}>
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            className="context-tab"
            role="tab"
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              const index = TABS.indexOf(tab);
              if (event.key === "ArrowRight") setTab(TABS[(index + 1) % TABS.length]!);
              if (event.key === "ArrowLeft") setTab(TABS[(index - 1 + TABS.length) % TABS.length]!);
            }}
          >
            {tabLabels[id]}
          </button>
        ))}
      </div>

      {tab === "psychology" ? (
        <PsychologyFields profile={profile} onChange={setProfile} traits={traits} />
      ) : null}
      {tab === "archetypes" ? <ArchetypeFields profile={profile} catalog={catalog} onChange={setProfile} /> : null}
      {tab === "arcs" ? (
        <ArcFields profile={profile} catalog={catalog} onChange={setProfile} arcs={profile.arcs} staleMilestoneIds={staleMilestoneIds} />
      ) : null}
      {tab === "relationships" ? (
        relationshipArcs.length ? (
          <ArcFields profile={profile} catalog={catalog} onChange={setProfile} arcs={relationshipArcs} staleMilestoneIds={staleMilestoneIds} />
        ) : (
          <EmptyState>{LABELS.noArcs}</EmptyState>
        )
      ) : null}
      {tab === "history" ? (
        <HistoryFields profile={profile} catalog={catalog} projectId={projectId} onChange={setProfile} />
      ) : null}

      {suggestions.length ? (
        <fieldset className="stack">
          <legend>{LABELS.extract}</legend>
          {suggestions.map((suggestion) => (
            <label key={suggestion.id} className="small">
              <input
                type="checkbox"
                checked={pickedSuggestions.includes(suggestion.id)}
                onChange={(event) =>
                  setPickedSuggestions((current) =>
                    event.target.checked ? [...current, suggestion.id] : current.filter((id) => id !== suggestion.id),
                  )
                }
              />{" "}
              {suggestion.kind}: {suggestion.value}
              {suggestion.evidence ? <span className="muted"> — {suggestion.evidence}</span> : null}
            </label>
          ))}
          <Button
            type="button"
            variant="secondary"
            disabled={pending || pickedSuggestions.length === 0}
            onClick={async () => {
              setPending(true);
              try {
                applyResult(
                  await acceptCharacterSuggestionsAction(
                    projectId,
                    recordId,
                    expectedRevision,
                    suggestions.filter((item) => pickedSuggestions.includes(item.id)),
                    unlock,
                  ),
                );
                setSuggestions([]);
              } finally {
                setPending(false);
              }
            }}
          >
            {LABELS.acceptSelected}
          </Button>
        </fieldset>
      ) : null}

      {observations.length ? (
        <fieldset className="stack">
          <legend>{LABELS.review}</legend>
          {observations.map((observation, index) => (
            <label key={`${observation.check}-${index}`} className="small">
              <input
                type="checkbox"
                checked={pickedNotes.includes(index)}
                onChange={(event) =>
                  setPickedNotes((current) =>
                    event.target.checked ? [...current, index] : current.filter((item) => item !== index),
                  )
                }
              />{" "}
              {observation.check}: {observation.summary}
              {observation.uncertainty ? <span className="muted"> ({observation.uncertainty})</span> : null}
              {observation.evidence ? <span className="muted"> — {observation.evidence}</span> : null}
            </label>
          ))}
          <Button
            type="button"
            variant="secondary"
            disabled={pending || pickedNotes.length === 0}
            onClick={async () => {
              setPending(true);
              try {
                applyResult(
                  await acceptCharacterReviewAction(
                    projectId,
                    recordId,
                    expectedRevision,
                    observations.filter((_, index) => pickedNotes.includes(index)),
                    unlock,
                  ),
                );
                setObservations([]);
              } finally {
                setPending(false);
              }
            }}
          >
            {LABELS.acceptReview}
          </Button>
        </fieldset>
      ) : null}

      <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
        <Button type="button" disabled={pending} onClick={save}>
          {LABELS.save}
        </Button>
        <Button type="button" variant="secondary" disabled={pending || !catalog.assistantConfigured} onClick={() => ask("extract")}>
          {LABELS.extract}
        </Button>
        <Button type="button" variant="secondary" disabled={pending || !catalog.assistantConfigured} onClick={() => ask("review")}>
          {LABELS.review}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            try {
              applyResult(await markCharacterProfileCheckedAction(projectId, recordId, expectedRevision, unlock));
            } finally {
              setPending(false);
            }
          }}
        >
          {LABELS.markChecked}
        </Button>
        <Button type="button" variant="secondary" onClick={download}>
          {LABELS.exportProfile}
        </Button>
      </div>
      <p className="small muted">{LABELS.extractHint}</p>
      <p className="small muted">{LABELS.reviewHint}</p>
      {isProtected ? (
        <label className="small">
          <input type="checkbox" checked={unlock} onChange={(event) => setUnlock(event.target.checked)} /> {LABELS.unlock}
        </label>
      ) : null}
      <label className="small">
        <input type="checkbox" checked={allowRewrite} onChange={(event) => setAllowRewrite(event.target.checked)} />{" "}
        {LABELS.confirmRewrite}
      </label>
    </div>
  );
}

function PsychologyFields({
  profile,
  onChange,
  traits,
}: {
  profile: CharacterDevelopment;
  onChange: (next: CharacterDevelopment) => void;
  traits: InheritedTrait[];
}) {
  const psychology = profile.psychology;
  const type = psychology.enneagram;
  const numeric = typeof type === "number" ? type : null;
  const wings = numeric ? adjacentWings(numeric) : [];
  const guide = numeric ? ENNEAGRAM_GUIDE[numeric] : null;
  const empty = developmentIsEmpty({ ...emptyCharacterDevelopment(), importance: profile.importance, narrativeRole: profile.narrativeRole });
  return (
    <div className="stack">
      {empty && !psychology.enneagram ? <EmptyState>{LABELS.empty}</EmptyState> : null}
      <p className="small muted">{LABELS.separate}</p>
      {traits.length ? (
        <ul className="small">
          {traits.map((trait) => (
            <li key={trait.key}>
              <span className="badge">{trait.source === "inherited" ? LABELS.inherited : LABELS.override}</span> {trait.key}: {trait.value}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid2">
        <label>
          {LABELS.enneagram}
          <select
            value={type === null ? "" : String(type)}
            onChange={(event) => {
              const raw = event.target.value;
              const enneagram: EnneagramChoice | null =
                raw === "" ? null : raw === "unknown" || raw === "undecided" || raw === "not_applicable" ? raw : (Number(raw) as EnneagramChoice);
              onChange({
                ...profile,
                psychology: { ...psychology, enneagram, wing: null },
              });
            }}
          >
            <option value="">{LABELS.unset}</option>
            {ENNEAGRAM_TYPES.map((item) => (
              <option key={item} value={item}>
                {item}. {ENNEAGRAM_GUIDE[item].name}
              </option>
            ))}
            <option value="unknown">{LABELS.unknown}</option>
            <option value="undecided">{LABELS.undecided}</option>
            <option value="not_applicable">{LABELS.notApplicable}</option>
          </select>
        </label>
        <label>
          {LABELS.wing}
          <HelpPopover label={LABELS.wing}>{LABELS.wingHint}</HelpPopover>
          <select
            value={psychology.wing ?? ""}
            onChange={(event) =>
              onChange({
                ...profile,
                psychology: { ...psychology, wing: event.target.value ? (Number(event.target.value) as EnneagramNumber) : null },
              })
            }
          >
            <option value="">{LABELS.unset}</option>
            {wings.map((wing) => (
              <option key={wing} value={wing}>
                {wing}
              </option>
            ))}
          </select>
        </label>
      </div>
      {guide ? (
        <p className="small">
          {guide.name}: desire {guide.desire}; fear {guide.fear}. {guide.wings}
        </p>
      ) : null}
      {PSYCHOLOGY_TEXT_KEYS.map((key) => (
        <label key={key}>
          {LABELS.fields[key]}
          <textarea
            rows={2}
            value={psychology[key]}
            onChange={(event) => onChange({ ...profile, psychology: { ...psychology, [key]: event.target.value } })}
          />
        </label>
      ))}
      <fieldset className="stack">
        <legend>{LABELS.frameworks}</legend>
        {psychology.frameworks.map((framework) => (
          <div key={framework.id} className="grid2">
            <label>
              {LABELS.frameworkName}
              <input
                value={framework.name}
                onChange={(event) =>
                  onChange({
                    ...profile,
                    psychology: {
                      ...psychology,
                      frameworks: psychology.frameworks.map((item) =>
                        item.id === framework.id ? { ...item, name: event.target.value } : item,
                      ),
                    },
                  })
                }
              />
            </label>
            <label>
              {LABELS.frameworkNotes}
              <input
                value={framework.notes}
                onChange={(event) =>
                  onChange({
                    ...profile,
                    psychology: {
                      ...psychology,
                      frameworks: psychology.frameworks.map((item) =>
                        item.id === framework.id ? { ...item, notes: event.target.value } : item,
                      ),
                    },
                  })
                }
              />
            </label>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            onChange({
              ...profile,
              psychology: { ...psychology, frameworks: [...psychology.frameworks, { id: newId("frame"), name: "", notes: "" }] },
            })
          }
        >
          {LABELS.addFramework}
        </Button>
      </fieldset>
    </div>
  );
}

function ArchetypeFields({
  profile,
  catalog,
  onChange,
}: {
  profile: CharacterDevelopment;
  catalog: DevelopmentCatalog;
  onChange: (next: CharacterDevelopment) => void;
}) {
  const update = (id: string, patch: Partial<ArchetypeAssignment>) =>
    onChange({ ...profile, archetypes: profile.archetypes.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  return (
    <div className="stack">
      {profile.archetypes.length === 0 ? <EmptyState>No archetypes yet. A character can have more than one, or none.</EmptyState> : null}
      {profile.archetypes.map((archetype) => (
        <fieldset key={archetype.id} className="stack">
          <label>
            {LABELS.archetypeName}
            <select
              value={archetype.custom ? "__custom" : archetype.name}
              onChange={(event) => {
                if (event.target.value === "__custom") update(archetype.id, { custom: true, name: "" });
                else update(archetype.id, { custom: false, name: event.target.value });
              }}
            >
              {ARCHETYPE_LIBRARY.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              <option value="__custom">{LABELS.customArchetype}</option>
            </select>
          </label>
          {archetype.custom ? (
            <label>
              {LABELS.customArchetype}
              <input value={archetype.name} onChange={(event) => update(archetype.id, { name: event.target.value, custom: true })} />
            </label>
          ) : null}
          <label>
            {LABELS.primary}
            <select value={archetype.rank} onChange={(event) => update(archetype.id, { rank: event.target.value === "secondary" ? "secondary" : "primary" })}>
              <option value="primary">{LABELS.primary}</option>
              <option value="secondary">{LABELS.secondary}</option>
            </select>
          </label>
          <label>
            {LABELS.period}
            <input value={archetype.periodLabel} onChange={(event) => update(archetype.id, { periodLabel: event.target.value })} />
          </label>
          <label>
            {LABELS.relationshipContext}
            <select
              value={archetype.relationshipRecordId ?? ""}
              onChange={(event) => update(archetype.id, { relationshipRecordId: event.target.value || null })}
            >
              <option value="">{LABELS.none}</option>
              {catalog.characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Description
            <textarea rows={2} value={archetype.description} onChange={(event) => update(archetype.id, { description: event.target.value })} />
          </label>
          <Button type="button" variant="secondary" onClick={() => onChange({ ...profile, archetypes: profile.archetypes.filter((item) => item.id !== archetype.id) })}>
            Remove
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="secondary"
        onClick={() =>
          onChange({
            ...profile,
            archetypes: [
              ...profile.archetypes,
              {
                id: newId("arch"),
                name: "Hero",
                custom: false,
                description: "",
                rank: profile.archetypes.length ? "secondary" : "primary",
                periodLabel: "",
                relationshipRecordId: null,
              },
            ],
          })
        }
      >
        {LABELS.addArchetype}
      </Button>
    </div>
  );
}

function ArcFields({
  profile,
  catalog,
  onChange,
  arcs,
  staleMilestoneIds,
}: {
  profile: CharacterDevelopment;
  catalog: DevelopmentCatalog;
  onChange: (next: CharacterDevelopment) => void;
  arcs: DevelopmentArc[];
  staleMilestoneIds: string[];
}) {
  const replace = (arc: DevelopmentArc) => onChange({ ...profile, arcs: profile.arcs.map((item) => (item.id === arc.id ? arc : item)) });
  return (
    <div className="stack">
      {arcs.length === 0 ? <EmptyState>{LABELS.noArcs}</EmptyState> : null}
      {arcs.map((arc) => (
        <details key={arc.id} open>
          <summary>{arc.title || LABELS.arcTitle}</summary>
          <div className="stack">
            <label>
              {LABELS.arcTitle}
              <input value={arc.title} onChange={(event) => replace({ ...arc, title: event.target.value })} />
            </label>
            <label>
              Description
              <textarea rows={2} value={arc.description} onChange={(event) => replace({ ...arc, description: event.target.value })} />
            </label>
            <div className="grid2">
              <label>
                {LABELS.template}
                <select value={arc.template} onChange={(event) => replace({ ...arc, template: event.target.value as DevelopmentArc["template"] })}>
                  {ARC_TEMPLATES.map((template) => (
                    <option key={template} value={template}>
                      {template.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {LABELS.scope}
                <select
                  value={arc.scope}
                  onChange={(event) => replace({ ...arc, scope: event.target.value === "book" ? "book" : "series" })}
                >
                  <option value="series">{LABELS.scopeSeries}</option>
                  <option value="book">{LABELS.scopeBook}</option>
                </select>
              </label>
              {arc.scope === "book" ? (
                <label>
                  {LABELS.book}
                  <select value={arc.bookProjectId ?? ""} onChange={(event) => replace({ ...arc, bookProjectId: event.target.value || null })}>
                    <option value="">{LABELS.unset}</option>
                    {catalog.books.map((book) => (
                      <option key={book.id} value={book.id}>
                        {book.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                {LABELS.parentArc}
                <select value={arc.parentArcId ?? ""} onChange={(event) => replace({ ...arc, parentArcId: event.target.value || null })}>
                  <option value="">{LABELS.none}</option>
                  {profile.arcs
                    .filter((item) => item.id !== arc.id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title || item.id}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {LABELS.movement}
                <select value={arc.movement} onChange={(event) => replace({ ...arc, movement: event.target.value as DevelopmentArc["movement"] })}>
                  {ARC_MOVEMENTS.map((movement) => (
                    <option key={movement} value={movement}>
                      {movement}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {LABELS.approval}
                <select value={arc.approval} onChange={(event) => replace({ ...arc, approval: event.target.value as DevelopmentArc["approval"] })}>
                  {AUTHORITY_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Relationship
                <select value={arc.relationId ?? ""} onChange={(event) => replace({ ...arc, relationId: event.target.value || null })}>
                  <option value="">{LABELS.none}</option>
                  {catalog.relations.map((relation) => (
                    <option key={relation.id} value={relation.id}>
                      {relation.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset>
              <legend>{LABELS.participants}</legend>
              {catalog.characters.map((character) => (
                <label key={character.id} className="small">
                  <input
                    type="checkbox"
                    checked={arc.participantRecordIds.includes(character.id)}
                    onChange={(event) => {
                      const participantRecordIds = event.target.checked
                        ? [...arc.participantRecordIds, character.id]
                        : arc.participantRecordIds.filter((id) => id !== character.id);
                      replace({ ...arc, participantRecordIds });
                    }}
                  />{" "}
                  {character.label}
                </label>
              ))}
            </fieldset>
            <fieldset className="stack">
              <legend>{LABELS.perceptions}</legend>
              {arc.perceptions.map((perception) => (
                <div key={perception.recordId} className="grid2">
                  <span className="small">{catalog.characters.find((item) => item.id === perception.recordId)?.label ?? perception.recordId}</span>
                  <label>
                    {LABELS.feeling}
                    <input
                      value={perception.feeling}
                      onChange={(event) =>
                        replace({
                          ...arc,
                          perceptions: arc.perceptions.map((item) =>
                            item.recordId === perception.recordId ? { ...item, feeling: event.target.value } : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    {LABELS.belief}
                    <input
                      value={perception.belief}
                      onChange={(event) =>
                        replace({
                          ...arc,
                          perceptions: arc.perceptions.map((item) =>
                            item.recordId === perception.recordId ? { ...item, belief: event.target.value } : item,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
              ))}
              <label>
                Add a person
                <select
                  value=""
                  onChange={(event) => {
                    if (!event.target.value || arc.perceptions.some((item) => item.recordId === event.target.value)) return;
                    replace({ ...arc, perceptions: [...arc.perceptions, { recordId: event.target.value, feeling: "", belief: "" }] });
                  }}
                >
                  <option value="">{LABELS.none}</option>
                  {catalog.characters.map((character) => (
                    <option key={character.id} value={character.id}>
                      {character.label}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            {(
              [
                ["startingState", "Starting state"],
                ["desiredOutcome", "Desired outcome"],
                ["startingBelief", "Starting belief"],
                ["emergingTruth", "Emerging truth"],
                ["internalConflict", "Internal conflict"],
                ["externalConflict", "External conflict"],
                ["stakes", "Stakes"],
                ["notes", "Author notes"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <textarea rows={2} value={arc[key]} onChange={(event) => replace({ ...arc, [key]: event.target.value })} />
              </label>
            ))}
            <MilestoneFields arc={arc} catalog={catalog} staleMilestoneIds={staleMilestoneIds} onChange={replace} />
            <Button type="button" variant="secondary" onClick={() => onChange({ ...profile, arcs: profile.arcs.filter((item) => item.id !== arc.id) })}>
              Remove arc
            </Button>
          </div>
        </details>
      ))}
      <Button type="button" variant="secondary" onClick={() => onChange({ ...profile, arcs: [...profile.arcs, blankArc()] })}>
        {LABELS.addArc}
      </Button>
    </div>
  );
}

function MilestoneFields({
  arc,
  catalog,
  staleMilestoneIds,
  onChange,
}: {
  arc: DevelopmentArc;
  catalog: DevelopmentCatalog;
  staleMilestoneIds: string[];
  onChange: (arc: DevelopmentArc) => void;
}) {
  return (
    <div className="stack">
      {arc.milestones.map((milestone) => {
        const freshness = staleMilestoneIds.includes(milestone.id)
          ? "stale"
          : milestoneFreshness(milestone, null);
        return (
          <fieldset key={milestone.id} className="stack">
            <label>
              {LABELS.milestoneTitle}
              <input
                value={milestone.title}
                onChange={(event) =>
                  onChange({
                    ...arc,
                    milestones: arc.milestones.map((item) => (item.id === milestone.id ? { ...item, title: event.target.value } : item)),
                  })
                }
              />
            </label>
            <label>
              {LABELS.milestoneStatus}
              <select
                value={milestone.status}
                onChange={(event) =>
                  onChange({
                    ...arc,
                    milestones: arc.milestones.map((item) =>
                      item.id === milestone.id ? { ...item, status: event.target.value as MilestoneLink["status"] } : item,
                    ),
                  })
                }
              >
                {MILESTONE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <Choice
              label="Chapter"
              value={milestone.chapterRecordId}
              choices={catalog.chapters}
              onChange={(chapterRecordId) =>
                onChange({ ...arc, milestones: arc.milestones.map((item) => (item.id === milestone.id ? { ...item, chapterRecordId } : item)) })
              }
            />
            <Choice
              label="Scene"
              value={milestone.sceneRecordId}
              choices={catalog.scenes}
              onChange={(sceneRecordId) =>
                onChange({ ...arc, milestones: arc.milestones.map((item) => (item.id === milestone.id ? { ...item, sceneRecordId } : item)) })
              }
            />
            <Choice
              label="Timeline event"
              value={milestone.storyEventId}
              choices={catalog.events}
              onChange={(storyEventId) =>
                onChange({ ...arc, milestones: arc.milestones.map((item) => (item.id === milestone.id ? { ...item, storyEventId } : item)) })
              }
            />
            <Choice
              label="Plot beat"
              value={milestone.weaveBeatId}
              choices={catalog.beats}
              onChange={(weaveBeatId) =>
                onChange({ ...arc, milestones: arc.milestones.map((item) => (item.id === milestone.id ? { ...item, weaveBeatId } : item)) })
              }
            />
            <label>
              {LABELS.passage}
              <textarea
                rows={2}
                value={milestone.passageExcerpt}
                onChange={(event) =>
                  onChange({
                    ...arc,
                    milestones: arc.milestones.map((item) =>
                      item.id === milestone.id ? { ...item, passageExcerpt: event.target.value } : item,
                    ),
                  })
                }
              />
            </label>
            <label>
              {LABELS.passageRevision}
              <input
                type="number"
                value={milestone.passageRevision ?? ""}
                onChange={(event) =>
                  onChange({
                    ...arc,
                    milestones: arc.milestones.map((item) =>
                      item.id === milestone.id
                        ? { ...item, passageRevision: event.target.value === "" ? null : Number(event.target.value) }
                        : item,
                    ),
                  })
                }
              />
            </label>
            {freshness === "stale" ? <p className="small">{LABELS.stale}</p> : null}
          </fieldset>
        );
      })}
      <Button type="button" variant="secondary" onClick={() => onChange({ ...arc, milestones: [...arc.milestones, blankMilestone()] })}>
        {LABELS.addMilestone}
      </Button>
    </div>
  );
}

function HistoryFields({
  profile,
  catalog,
  projectId,
  onChange,
}: {
  profile: CharacterDevelopment;
  catalog: DevelopmentCatalog;
  projectId: string;
  onChange: (next: CharacterDevelopment) => void;
}) {
  const book = profile.bookImportance.find((item) => item.projectId === projectId);
  const bookState = profile.bookStates.find((item) => item.projectId === projectId);
  const patchImportance = (patch: Partial<NonNullable<typeof book>>) => {
    const next = { projectId, importance: book?.importance ?? null, narrativeRole: book?.narrativeRole ?? null, presence: book?.presence ?? "present", ...patch };
    onChange({
      ...profile,
      bookImportance: [...profile.bookImportance.filter((item) => item.projectId !== projectId), next],
    });
  };
  const patchState = (patch: Partial<NonNullable<typeof bookState>>) => {
    const next = {
      projectId,
      narrativeIndex: bookState?.narrativeIndex ?? null,
      openingNote: bookState?.openingNote ?? "",
      closingNote: bookState?.closingNote ?? "",
      opening: bookState?.opening ?? [],
      closing: bookState?.closing ?? [],
      openingApproval: bookState?.openingApproval ?? "draft",
      closingApproval: bookState?.closingApproval ?? "draft",
      ...patch,
    };
    onChange({ ...profile, bookStates: [...profile.bookStates.filter((item) => item.projectId !== projectId), next] });
  };
  return (
    <div className="stack">
      <p className="small muted">{LABELS.narrativeOrderHint}</p>
      <div className="grid2">
        <label>
          {LABELS.presence}
          <select value={book?.presence ?? "present"} onChange={(event) => patchImportance({ presence: event.target.value as "present" })}>
            {PRESENCE_STATES.map((presence) => (
              <option key={presence} value={presence}>
                {presence}
              </option>
            ))}
          </select>
        </label>
        <label>
          {LABELS.importance} in this book
          <select
            value={book?.importance ?? ""}
            onChange={(event) => patchImportance({ importance: (event.target.value || null) as ImportanceLevel | null })}
          >
            <option value="">{LABELS.unset}</option>
            {IMPORTANCE_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <label>
          {LABELS.narrativeOrder}
          <HelpPopover label={LABELS.narrativeOrder}>{LABELS.narrativeOrderHint}</HelpPopover>
          <input
            type="number"
            value={bookState?.narrativeIndex ?? ""}
            onChange={(event) => patchState({ narrativeIndex: event.target.value === "" ? null : Number(event.target.value) })}
          />
        </label>
      </div>
      <label>
        {LABELS.opening}
        <textarea rows={2} value={bookState?.openingNote ?? ""} onChange={(event) => patchState({ openingNote: event.target.value })} />
      </label>
      <label>
        {LABELS.closing}
        <textarea rows={2} value={bookState?.closingNote ?? ""} onChange={(event) => patchState({ closingNote: event.target.value })} />
      </label>
      <fieldset className="stack">
        <legend>State changes</legend>
        {profile.stateChanges.map((change) => (
          <StateRow
            key={change.id}
            change={change}
            catalog={catalog}
            onChange={(next) => onChange({ ...profile, stateChanges: profile.stateChanges.map((item) => (item.id === change.id ? next : item)) })}
            onRemove={() => onChange({ ...profile, stateChanges: profile.stateChanges.filter((item) => item.id !== change.id) })}
          />
        ))}
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            onChange({
              ...profile,
              stateChanges: [
                ...profile.stateChanges,
                {
                  id: newId("state"),
                  facet: "belief",
                  presence: "set",
                  text: "",
                  approval: "draft",
                  planned: true,
                  bookProjectId: projectId,
                  storyEventId: null,
                  sceneRecordId: null,
                  sequence: null,
                  note: "",
                },
              ],
            })
          }
        >
          {LABELS.addState}
        </Button>
      </fieldset>
      <fieldset className="stack">
        <legend>{LABELS.variant}</legend>
        <p className="small muted">{LABELS.inheritHint}</p>
        <label>
          {LABELS.foundation}
          <select
            value={profile.variant?.foundationRecordId ?? ""}
            onChange={(event) =>
              onChange({
                ...profile,
                variant: event.target.value
                  ? { foundationRecordId: event.target.value, inheritedKeys: profile.variant?.inheritedKeys ?? [] }
                  : null,
              })
            }
          >
            <option value="">{LABELS.none}</option>
            {catalog.characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.label}
              </option>
            ))}
          </select>
        </label>
        {profile.variant
          ? INHERITABLE_KEYS.map((key) => (
              <label key={key} className="small">
                <input
                  type="checkbox"
                  checked={profile.variant?.inheritedKeys.includes(key) ?? false}
                  onChange={(event) => {
                    const current = profile.variant?.inheritedKeys ?? [];
                    const inheritedKeys = event.target.checked
                      ? [...current, key as InheritableKey]
                      : current.filter((item) => item !== key);
                    onChange({
                      ...profile,
                      variant: profile.variant ? { ...profile.variant, inheritedKeys } : null,
                    });
                  }}
                />{" "}
                {key}
              </label>
            ))
          : null}
      </fieldset>
      {profile.reviewNotes.length ? (
        <ul className="small">
          {profile.reviewNotes.map((note) => (
            <li key={note.id}>
              {note.accepted ? "Kept" : "Suggestion"} · {note.check}: {note.text}
              {note.evidence ? <span className="muted"> — {note.evidence}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function StateRow({
  change,
  catalog,
  onChange,
  onRemove,
}: {
  change: StateChange;
  catalog: DevelopmentCatalog;
  onChange: (change: StateChange) => void;
  onRemove: () => void;
}) {
  return (
    <div className="stack">
      <label>
        {LABELS.stateFacet}
        <select value={change.facet} onChange={(event) => onChange({ ...change, facet: event.target.value as StateChange["facet"] })}>
          {STATE_FACETS.map((facet) => (
            <option key={facet} value={facet}>
              {facet}
            </option>
          ))}
        </select>
      </label>
      <label className="small">
        <input
          type="checkbox"
          checked={change.presence === "unknown"}
          onChange={(event) => onChange({ ...change, presence: event.target.checked ? "unknown" : "set", text: event.target.checked ? "" : change.text })}
        />{" "}
        {LABELS.explicitUnknown}
      </label>
      {change.presence === "set" ? (
        <label>
          {LABELS.stateValue}
          <input value={change.text} onChange={(event) => onChange({ ...change, text: event.target.value })} />
        </label>
      ) : null}
      <label className="small">
        <input type="checkbox" checked={change.planned} onChange={(event) => onChange({ ...change, planned: event.target.checked })} /> {LABELS.planned}
      </label>
      <label>
        {LABELS.approval}
        <select value={change.approval} onChange={(event) => onChange({ ...change, approval: event.target.value as StateChange["approval"] })}>
          {AUTHORITY_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <Choice label="Timeline event" value={change.storyEventId} choices={catalog.events} onChange={(storyEventId) => onChange({ ...change, storyEventId })} />
      <label>
        Sequence
        <input
          type="number"
          value={change.sequence ?? ""}
          onChange={(event) => onChange({ ...change, sequence: event.target.value === "" ? null : Number(event.target.value) })}
        />
      </label>
      <Button type="button" variant="secondary" onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}

function Choice({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string | null;
  choices: DevelopmentChoice[];
  onChange: (value: string | null) => void;
}) {
  const known = useMemo(() => new Set(choices.map((choice) => choice.id)), [choices]);
  return (
    <label>
      {label}
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">{LABELS.none}</option>
        {value && !known.has(value) ? <option value={value}>{value}</option> : null}
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}
