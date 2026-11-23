"use client";

import { useEffect, useMemo, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { HelpPopover } from "@/components/ui/HelpPopover";
import { Select } from "@/components/ui/Select";
import { IssueList } from "@/components/IssueList";
import { setUnsaved } from "@/components/shell/unsaved";
import {
  AI_VISIBILITY,
  ARCHETYPE_LIBRARY,
  ARCHETYPE_RANKS,
  ARC_MOVEMENTS,
  ARC_TEMPLATES,
  BEHAVIOR_TEXT_KEYS,
  CAPABILITIES_TEXT_KEYS,
  ENNEAGRAM_GUIDE,
  ENNEAGRAM_TYPES,
  fieldMetaOf,
  IMPORTANCE_LEVELS,
  INHERITABLE_KEYS,
  KNOWLEDGE_HOLDERS,
  KNOWLEDGE_KINDS,
  LIVED_EXPERIENCE_TEXT_KEYS,
  MILESTONE_STATUSES,
  NARRATIVE_ROLES,
  PRESENCE_STATES,
  BOOK_PLAN_TEXT_KEYS,
  MILESTONE_KINDS,
  NARRATIVE_BOUNDARIES,
  PROFILE_SECTIONS,
  proposeProfileFillFromBody,
  applyProfileFillSuggestions,
  PSYCHOLOGY_TEXT_KEYS,
  SERIES_PLAN_TEXT_KEYS,
  setFieldMeta,
  STATE_FACETS,
  VARIANT_RELATIONSHIP_KINDS,
  VOICE_TEXT_KEYS,
  adjacentWings,
  buildCharacterTimeline,
  characterProfileMarkdown,
  compareCharacterStates,
  developmentIsEmpty,
  emptyBookState,
  emptyCharacterDevelopment,
  emptySeriesPlan,
  emptyVoice,
  forgottenArcs,
  milestoneFreshness,
  normalizeImportance,
  profileCompleteness,
  profileFreshness,
  resolveCharacterState,
  resolveKnowledgeAtPoint,
  sectionIsEmpty,
  supersedeStateChange,
  visibleProfileSections,
  type ArchetypeAssignment,
  type ArchetypeRank,
  type BehaviorTextKey,
  type CapabilitiesTextKey,
  type CharacterDevelopment,
  type DevelopmentArc,
  type EnneagramChoice,
  type EnneagramNumber,
  type FacetValue,
  type FoundationTextKey,
  type ImportanceLevel,
  type InheritableKey,
  type InheritedTrait,
  type KnowledgeItem,
  type LivedExperienceTextKey,
  type MilestoneKind,
  type MilestoneLink,
  type NarrativeBoundary,
  type NarrativePoint,
  type NarrativeRole,
  type ProfileFillSuggestion,
  type ProfileSection,
  type ProfileSuggestion,
  type ReviewObservation,
  type StateChange,
  type StateFacet,
  type VariantRelationshipKind,
  type VoiceTextKey,
} from "@/domain/characterDevelopment";
import type { OrderEdge } from "@/world/storyOrder";
import { AUTHORITY_STATUSES, type AuthorityStatus } from "@/domain/statuses";
import type { Issue } from "@/domain/issues";
import type { DossierMarkdownArchive } from "@/domain/characterDossierUpgrade";
import { emptyDossierMarkdownArchive } from "@/domain/characterDossierUpgrade";
import { CHARACTER_DEVELOPMENT as LABELS, CHARACTER_DOSSIER_UPGRADE, CHARACTER_MIGRATION_HOLD } from "@/ui/labels";
import {
  acceptCharacterReviewAction,
  acceptCharacterSuggestionsAction,
  markCharacterProfileCheckedAction,
  saveCharacterDevelopmentAction,
} from "@/app/projects/[projectId]/records/[recordId]/characterDevelopmentActions";
import { CharacterAnalysisWorkspace } from "./CharacterAnalysisWorkspace";
import { MigrationHoldArchivePanel } from "./MigrationHoldArchivePanel";

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
  facts: DevelopmentChoice[];
  worldRefs: DevelopmentChoice[];
  assistantConfigured: boolean;
  eventOrders?: OrderEdge[];
  sceneEventLinks?: Array<{ eventId: string; manuscriptRecordId: string; projectId: string }>;
}

const SECTION_TO_TAB: Record<ProfileSection, ProfileSection> = {
  identity: "identity",
  psychology: "psychology",
  voice: "voice",
  behavior: "behavior",
  lived: "lived",
  relationships: "relationships",
  capabilities: "capabilities",
  development: "development",
  continuity: "continuity",
};

type TabId = ProfileSection;

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
    kind: "milestone",
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

function blankStateChange(projectId: string): StateChange {
  return {
    id: newId("state"),
    facet: "belief",
    presence: "set",
    text: "",
    approval: "draft",
    planned: true,
    bookProjectId: projectId,
    storyEventId: null,
    chapterRecordId: null,
    sceneRecordId: null,
    sequence: null,
    note: "",
    supersedesId: null,
    correctionNote: "",
    correctedAt: null,
  };
}

export function CharacterDevelopmentPanel({
  projectId,
  recordId,
  title,
  body,
  revision,
  isProtected,
  initialProfile,
  fieldAge,
  catalog,
  traits,
  staleMilestoneIds,
  archive = emptyDossierMarkdownArchive(),
  archiveProblems = [],
}: {
  projectId: string;
  recordId: string;
  title: string;
  body: string;
  revision: number;
  isProtected: boolean;
  initialProfile: CharacterDevelopment;
  fieldAge: string;
  catalog: DevelopmentCatalog;
  traits: InheritedTrait[];
  staleMilestoneIds: string[];
  archive?: DossierMarkdownArchive;
  archiveProblems?: string[];
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(initialProfile));
  const [tab, setTab] = useState<TabId>("identity");
  const [showAllSections, setShowAllSections] = useState(false);
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
  const [fillSuggestions, setFillSuggestions] = useState<ProfileFillSuggestion[]>([]);
  const [pickedFills, setPickedFills] = useState<string[]>([]);
  const freshness = profileFreshness(profile, expectedRevision);
  const forgotten = forgottenArcs(profile);
  const completeness = useMemo(() => profileCompleteness(profile), [profile]);
  const dirty = JSON.stringify(profile) !== savedSnapshot;
  useEffect(() => {
    if (revision === expectedRevision || dirty) return;
    setProfile(initialProfile);
    setSavedSnapshot(JSON.stringify(initialProfile));
    setExpectedRevision(revision);
  }, [revision, expectedRevision, dirty, initialProfile]);
  const unsavedKey = `character-development-${recordId}`;
  useEffect(() => {
    setUnsaved(unsavedKey, dirty);
    return () => setUnsaved(unsavedKey, false);
  }, [unsavedKey, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const relationshipArcs = profile.arcs.filter(
    (arc) => arc.template === "relationship" || arc.relationId || arc.perceptions.length > 0,
  );
  const openSections = showAllSections ? [...PROFILE_SECTIONS] : visibleProfileSections(profile);
  const tabs = openSections.map((section) => SECTION_TO_TAB[section]);
  const activeTabs = tabs.length ? tabs : (["identity"] as TabId[]);
  if (!activeTabs.includes(tab) && activeTabs[0]) {
    // Keep render stable; switch on next interaction via effect-free guard in tab click.
  }

  const applyResult = (result: { ok: boolean; message?: string; issues?: Issue[]; revision?: number }) => {
    setMessage(result.message ?? null);
    setIssues(result.issues ?? []);
    if (result.ok && result.revision) setExpectedRevision(result.revision);
    return result;
  };

  const save = async () => {
    setPending(true);
    try {
      const result = applyResult(
        await saveCharacterDevelopmentAction(
          projectId,
          recordId,
          expectedRevision,
          JSON.stringify(profile),
          unlock,
          allowRewrite,
        ),
      );
      if (result.ok) setSavedSnapshot(JSON.stringify(profile));
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

  const download = (mode: "redacted" | "full") => {
    const markdown = characterProfileMarkdown(title, profile, mode === "full" ? "full" : "redacted");
    const payload =
      mode === "full"
        ? `${markdown}\n\n\`\`\`json\n${JSON.stringify(profile, null, 2)}\n\`\`\`\n`
        : markdown;
    const blob = new Blob([payload], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/[^\w.-]+/g, "-").slice(0, 40) || "character"}-profile-${mode}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const proposeFill = () => {
    const next = proposeProfileFillFromBody(body, profile);
    setFillSuggestions(next);
    setPickedFills(next.map((item) => item.id));
    setMessage(next.length ? LABELS.fillFromHeadingsHint : "No empty matching headings were found.");
  };

  const acceptFills = () => {
    const accepted = fillSuggestions.filter((item) => pickedFills.includes(item.id));
    setProfile(applyProfileFillSuggestions(profile, accepted));
    setFillSuggestions([]);
    setPickedFills([]);
    setMessage(accepted.length ? "Selected fills were applied locally. Save development to keep them." : null);
  };

  const tabLabels: Record<TabId, string> = {
    identity: LABELS.identityTab,
    psychology: LABELS.psychology,
    voice: LABELS.voiceTab,
    behavior: LABELS.behaviorTab,
    lived: LABELS.livedTab,
    relationships: LABELS.relationships,
    capabilities: LABELS.capabilitiesTab,
    development: LABELS.developmentTab,
    continuity: LABELS.continuityTab,
  };
  const currentTab = activeTabs.includes(tab) ? tab : activeTabs[0]!;

  const importanceValue = normalizeImportance(profile.importance) ?? profile.importance;

  return (
    <div className="stack">
      <p className="small muted">{LABELS.lead}</p>
      <p className="small muted">{LABELS.aid}</p>
      <p className="small muted">{LABELS.separate}</p>
      <p className="small muted">{LABELS.metaNotDuplicated}</p>
      {importanceValue === "minor" || importanceValue === "background" ? (
        <p className="small">{importanceValue === "background" ? LABELS.backgroundHint : LABELS.minorHint}</p>
      ) : null}
      {dirty ? <Banner>{LABELS.unsavedHint}</Banner> : null}
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
            value={importanceValue ?? ""}
            onChange={(event) =>
              setProfile({ ...profile, importance: (event.target.value || null) as ImportanceLevel | null })
            }
          >
            <option value="">{LABELS.unset}</option>
            {IMPORTANCE_LEVELS.map((level) => (
              <option key={level} value={level}>
                {LABELS.importanceLevels[level]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {LABELS.narrativeRole}
          <HelpPopover label={LABELS.narrativeRole}>{LABELS.roleHint}</HelpPopover>
          <select
            value={profile.narrativeRole ?? ""}
            onChange={(event) => {
              const narrativeRole = (event.target.value || null) as NarrativeRole | null;
              setProfile(
                setFieldMeta(
                  { ...profile, narrativeRole },
                  "narrativeRole",
                  {
                    approval: fieldMetaOf(profile, "narrativeRole").approval,
                    provenance: {
                      origin: "author",
                      note: fieldMetaOf(profile, "narrativeRole").provenance.note,
                      updatedAt: new Date().toISOString(),
                    },
                  },
                ),
              );
            }}
          >
            <option value="">{LABELS.unset}</option>
            {NARRATIVE_ROLES.map((role) => (
              <option key={role} value={role}>
                {role.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <FieldAuthorityControl
            profile={profile}
            fieldPath="narrativeRole"
            onChange={setProfile}
          />
        </label>
      </div>

      <div className="stack" aria-live="polite">
        <p className="small">
          {LABELS.completeness}
          <HelpPopover label={LABELS.completeness}>{LABELS.completenessHint}</HelpPopover>
          {": "}
          {completeness.importance ? (
            <span>
              {completeness.suggestedFilledCount}/{completeness.suggestedTotal}
              {completeness.suggestedEmpty.length
                ? ` — open ${completeness.suggestedEmpty.map((section) => tabLabels[section]).join(", ")} when ready`
                : ""}
            </span>
          ) : (
            <span className="muted">{LABELS.completenessUnset}</span>
          )}
        </p>
        <p className="small muted" aria-label={LABELS.canonLegend}>
          <span className="badge approved">{LABELS.canonApproved}</span>{" "}
          <span className="badge proposed">{LABELS.canonProposed}</span>{" "}
          <span className="badge">{LABELS.canonDraft}</span>{" "}
          <span className="badge manuscript">{LABELS.canonManuscript}</span>{" "}
          <span className="badge">{LABELS.canonAi}</span>{" "}
          <span className="badge unresolved">{LABELS.canonContradiction}</span>{" "}
          <span className="badge">{LABELS.canonPlanned}</span>
        </p>
      </div>

      <div className="context-tabs" role="tablist" aria-label={LABELS.heading}>
        {activeTabs.map((id) => (
          <button
            key={id}
            type="button"
            className="context-tab"
            role="tab"
            aria-selected={currentTab === id}
            aria-controls={`character-profile-panel-${id}`}
            id={`character-profile-tab-${id}`}
            tabIndex={currentTab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              const index = activeTabs.indexOf(currentTab);
              if (event.key === "ArrowRight") {
                event.preventDefault();
                setTab(activeTabs[(index + 1) % activeTabs.length]!);
              }
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                setTab(activeTabs[(index - 1 + activeTabs.length) % activeTabs.length]!);
              }
              if (event.key === "Home") {
                event.preventDefault();
                setTab(activeTabs[0]!);
              }
              if (event.key === "End") {
                event.preventDefault();
                setTab(activeTabs[activeTabs.length - 1]!);
              }
            }}
          >
            {tabLabels[id]}
            {!sectionIsEmpty(id, profile) ? <span className="badge" aria-hidden="true">·</span> : null}
          </button>
        ))}
      </div>
      {activeTabs.length < PROFILE_SECTIONS.length || showAllSections ? (
        <Button type="button" variant="secondary" onClick={() => setShowAllSections((value) => !value)}>
          {showAllSections ? LABELS.hideExtraSections : LABELS.showMoreSections}
        </Button>
      ) : null}

      <div
        role="tabpanel"
        id={`character-profile-panel-${currentTab}`}
        aria-labelledby={`character-profile-tab-${currentTab}`}
        className="stack"
      >
        {currentTab === "identity" ? (
          <FoundationFields profile={profile} fieldAge={fieldAge} onChange={setProfile} />
        ) : null}
        {currentTab === "psychology" ? (
          <div className="stack">
            <PsychologyFields profile={profile} onChange={setProfile} traits={traits} />
            <details className="stack">
              <summary>
                {LABELS.archetypes}
                <HelpPopover label={LABELS.archetypes}>{LABELS.conceptHelp.primaryShadowArchetype}</HelpPopover>
              </summary>
              <ArchetypeFields profile={profile} catalog={catalog} onChange={setProfile} />
            </details>
          </div>
        ) : null}
        {currentTab === "voice" ? (
          sectionIsEmpty("voice", profile) ? (
            <div className="stack">
              <EmptyState>{LABELS.emptyVoice}</EmptyState>
              <VoiceFields profile={profile} catalog={catalog} projectId={projectId} onChange={setProfile} />
            </div>
          ) : (
            <VoiceFields profile={profile} catalog={catalog} projectId={projectId} onChange={setProfile} />
          )
        ) : null}
        {currentTab === "behavior" ? (
          sectionIsEmpty("behavior", profile) ? (
            <div className="stack">
              <EmptyState>{LABELS.emptyBehavior}</EmptyState>
              <BehaviorFields profile={profile} onChange={setProfile} />
            </div>
          ) : (
            <BehaviorFields profile={profile} onChange={setProfile} />
          )
        ) : null}
        {currentTab === "lived" ? <LivedExperienceFields profile={profile} onChange={setProfile} /> : null}
        {currentTab === "relationships" ? (
          <div className="stack">
            <p className="small muted">{LABELS.metaNotDuplicated}</p>
            {relationshipArcs.length ? (
              <ArcFields profile={profile} catalog={catalog} onChange={setProfile} arcs={relationshipArcs} staleMilestoneIds={staleMilestoneIds} />
            ) : (
              <EmptyState>{LABELS.noArcs}</EmptyState>
            )}
          </div>
        ) : null}
        {currentTab === "capabilities" ? (
          sectionIsEmpty("capabilities", profile) ? (
            <div className="stack">
              <EmptyState>{LABELS.emptyCapabilities}</EmptyState>
              <CapabilitiesFields profile={profile} catalog={catalog} onChange={setProfile} />
            </div>
          ) : (
            <CapabilitiesFields profile={profile} catalog={catalog} onChange={setProfile} />
          )
        ) : null}
        {currentTab === "development" ? (
          <div className="stack">
            <p className="small muted">
              {LABELS.developmentLead}
              <HelpPopover label={LABELS.developmentTab}>{LABELS.conceptHelp.characterArcs}</HelpPopover>
            </p>
            <SeriesPlanFields profile={profile} onChange={setProfile} />
            <BookPlanFields profile={profile} catalog={catalog} projectId={projectId} onChange={setProfile} />
            <MilestoneSummary profile={profile} />
            {profile.arcs.length === 0 ? <EmptyState>{LABELS.noArcs}</EmptyState> : null}
            <ArcFields profile={profile} catalog={catalog} onChange={setProfile} arcs={profile.arcs} staleMilestoneIds={staleMilestoneIds} />
          </div>
        ) : null}
        {currentTab === "continuity" ? (
          <div className="stack">
            <p className="small muted">{LABELS.continuityLead}</p>
            {sectionIsEmpty("continuity", profile) ? <EmptyState>{LABELS.emptyContinuity}</EmptyState> : null}
            <DevelopmentTimeline profile={profile} catalog={catalog} />
            <HistoricalStateViewer profile={profile} catalog={catalog} projectId={projectId} onChange={setProfile} />
            <KnowledgeFields profile={profile} catalog={catalog} projectId={projectId} onChange={setProfile} />
            <HistoryFields profile={profile} catalog={catalog} projectId={projectId} onChange={setProfile} />
          </div>
        ) : null}
      </div>

      <details className="stack">
        <summary>{LABELS.originalDossier}</summary>
        <p className="small muted">{LABELS.originalDossierLead}</p>
        <ButtonLink
          href={`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(recordId)}/upgrade`}
          variant="secondary"
        >
          {CHARACTER_DOSSIER_UPGRADE.openUpgrade}
        </ButtonLink>
        {profile.migrationHold.length > 0 || archive.entries.length > 0 || archiveProblems.length > 0 ? (
          <MigrationHoldArchivePanel
            projectId={projectId}
            recordId={recordId}
            profile={profile}
            archive={archive}
            archiveProblems={archiveProblems}
            onChange={setProfile}
          />
        ) : (
          <EmptyState>{LABELS.emptyOriginalDossier}</EmptyState>
        )}
      </details>
      {profile.migrationHold.length ? (
        <p className="small muted">
          {CHARACTER_MIGRATION_HOLD.heading}: {profile.migrationHold.length} held item
          {profile.migrationHold.length === 1 ? "" : "s"} (open Original dossier to review).
        </p>
      ) : null}

      {fillSuggestions.length ? (
        <fieldset className="stack">
          <legend>{LABELS.fillFromHeadings}</legend>
          {fillSuggestions.map((suggestion) => (
            <Checkbox
              key={suggestion.id}
              className="small"
              checked={pickedFills.includes(suggestion.id)}
              onChange={(event) =>
                setPickedFills((current) =>
                  event.target.checked ? [...current, suggestion.id] : current.filter((id) => id !== suggestion.id),
                )
              }
              label={
                <>
                  {suggestion.heading} → {suggestion.target}.{suggestion.key}
                  <span className="muted"> — {suggestion.value.slice(0, 120)}</span>
                </>
              }
            />
          ))}
          <Button type="button" variant="secondary" onClick={acceptFills}>
            {LABELS.acceptFill}
          </Button>
        </fieldset>
      ) : null}

      {suggestions.length ? (
        <fieldset className="stack">
          <legend>{LABELS.extract}</legend>
          {suggestions.map((suggestion) => (
            <Checkbox
              key={suggestion.id}
              className="small"
              checked={pickedSuggestions.includes(suggestion.id)}
              onChange={(event) =>
                setPickedSuggestions((current) =>
                  event.target.checked ? [...current, suggestion.id] : current.filter((id) => id !== suggestion.id),
                )
              }
              label={
                <>
                  {suggestion.kind}: {suggestion.value}
                  {suggestion.evidence ? <span className="muted"> — {suggestion.evidence}</span> : null}
                </>
              }
            />
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
            <Checkbox
              key={`${observation.check}-${index}`}
              className="small"
              checked={pickedNotes.includes(index)}
              onChange={(event) =>
                setPickedNotes((current) =>
                  event.target.checked ? [...current, index] : current.filter((item) => item !== index),
                )
              }
              label={
                <>
                  <span className="badge unresolved">{LABELS.canonContradiction}</span>{" "}
                  <span className="badge proposed">{LABELS.canonAi}</span>{" "}
                  {observation.check}: {observation.summary}
                  {observation.uncertainty ? <span className="muted"> ({observation.uncertainty})</span> : null}
                  {observation.evidence ? <span className="muted"> — {observation.evidence}</span> : null}
                </>
              }
            />
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
        <Button type="button" variant="secondary" onClick={proposeFill}>
          {LABELS.fillFromHeadings}
        </Button>
        <ButtonLink
          href={`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(recordId)}/upgrade`}
          variant="secondary"
        >
          {CHARACTER_DOSSIER_UPGRADE.openUpgrade}
        </ButtonLink>
        <Button type="button" variant="secondary" onClick={() => download("redacted")}>
          {LABELS.exportRedacted}
        </Button>
        <Button type="button" variant="secondary" onClick={() => download("full")}>
          {LABELS.exportFull}
        </Button>
      </div>
      <p className="small muted">{LABELS.extractHint}</p>
      <p className="small muted">{LABELS.reviewHint}</p>
      <p className="small muted">{LABELS.fillFromHeadingsHint}</p>
      <p className="small muted">{LABELS.evidenceAnalysisHint}</p>
      <p className="small muted">{CHARACTER_DOSSIER_UPGRADE.openUpgradeHint}</p>
      <CharacterAnalysisWorkspace
        projectId={projectId}
        characterIds={[recordId]}
        characters={[{ id: recordId, label: title }]}
        chapters={catalog.chapters}
        scenes={catalog.scenes}
        books={catalog.books}
        assistantConfigured={catalog.assistantConfigured}
      />
      {isProtected ? (
        <Checkbox className="small" checked={unlock} onChange={(event) => setUnlock(event.target.checked)} label={LABELS.unlock} />
      ) : null}
      <Checkbox className="small" checked={allowRewrite} onChange={(event) => setAllowRewrite(event.target.checked)} label={LABELS.confirmRewrite} />
    </div>
  );
}

function FieldHelp({ field }: { field: keyof typeof LABELS.fieldHelp }) {
  const text = LABELS.fieldHelp[field];
  if (!text) return null;
  return <HelpPopover label={`Explain ${String(field)}`}>{text}</HelpPopover>;
}

function authorityBadgeClass(status: AuthorityStatus): string {
  if (status === "approved") return "badge approved";
  if (status === "proposed") return "badge proposed";
  if (status === "unresolved") return "badge unresolved";
  if (status === "superseded") return "badge superseded";
  return "badge";
}

function FieldAuthorityControl({
  profile,
  fieldPath,
  onChange,
}: {
  profile: CharacterDevelopment;
  fieldPath: string;
  onChange: (next: CharacterDevelopment) => void;
}) {
  const meta = fieldMetaOf(profile, fieldPath);
  const originLabel =
    meta.provenance.origin === "extracted"
      ? LABELS.canonAi
      : meta.provenance.origin === "imported"
        ? LABELS.canonManuscript
        : LABELS.fieldProvenance;
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginTop: "0.25rem" }}>
      <span className={authorityBadgeClass(meta.approval)} aria-label={`${LABELS.fieldAuthority}: ${meta.approval}`}>
        {meta.approval === "approved"
          ? LABELS.canonApproved
          : meta.approval === "proposed"
            ? LABELS.canonProposed
            : meta.approval === "unresolved"
              ? LABELS.canonContradiction
              : LABELS.canonDraft}
      </span>
      <Button
        type="button"
        variant="secondary"
        onClick={() =>
          onChange(
            setFieldMeta(profile, fieldPath, {
              approval: "approved",
              provenance: {
                ...meta.provenance,
                origin: meta.provenance.origin === "extracted" || meta.provenance.origin === "imported" ? meta.provenance.origin : "author",
                updatedAt: new Date().toISOString(),
              },
            }),
          )
        }
      >
        {LABELS.markFieldApproved}
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={() =>
          onChange(
            setFieldMeta(profile, fieldPath, {
              approval: "draft",
              provenance: {
                ...meta.provenance,
                origin: meta.provenance.origin === "extracted" || meta.provenance.origin === "imported" ? meta.provenance.origin : "author",
                updatedAt: new Date().toISOString(),
              },
            }),
          )
        }
      >
        {LABELS.markFieldDraft}
      </Button>
      <span className="small muted">
        {originLabel}
        {meta.provenance.origin ? `: ${meta.provenance.origin}` : ""}
        {meta.provenance.sourceHeading ? ` · ${meta.provenance.sourceHeading}` : ""}
      </span>
      <Select
        label={LABELS.fieldAuthority}
        labelPosition="bottom"
        size="sm"
        value={meta.approval}
        onChange={(event) =>
          onChange(
            setFieldMeta(profile, fieldPath, {
              approval: event.target.value as AuthorityStatus,
              provenance: {
                ...meta.provenance,
                origin: meta.provenance.origin === "extracted" || meta.provenance.origin === "imported" ? meta.provenance.origin : "author",
                updatedAt: new Date().toISOString(),
              },
            }),
          )
        }
      >
        {AUTHORITY_STATUSES.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </Select>
    </div>
  );
}

function FoundationFields({
  profile,
  fieldAge,
  onChange,
}: {
  profile: CharacterDevelopment;
  fieldAge: string;
  onChange: (next: CharacterDevelopment) => void;
}) {
  const overview: FoundationTextKey[] = ["pronouns", "lifeStage", "occupation", "externalGoal"];
  const appearance: FoundationTextKey[] = ["appearance", "physicalCharacteristics"];
  const background: FoundationTextKey[] = ["ancestry", "culturalIdentity", "formativeBackground", "publicRole", "privateSelf"];
  const empty = sectionIsEmpty("identity", profile);
  return (
    <div className="stack">
      <p className="small muted">{LABELS.foundationLead}</p>
      {empty ? <EmptyState>{LABELS.emptyIdentity}</EmptyState> : null}
      {fieldAge ? (
        <p className="small">
          {LABELS.ageBeside}: {fieldAge}{" "}
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              onChange({
                ...profile,
                foundation: { ...profile.foundation, lifeStage: profile.foundation.lifeStage || fieldAge },
              })
            }
          >
            {LABELS.copyAge}
          </Button>
        </p>
      ) : null}
      {overview.map((key) => (
        <label key={key}>
          {LABELS.foundationFields[key]}
          {key in LABELS.fieldHelp ? <FieldHelp field={key as keyof typeof LABELS.fieldHelp} /> : null}
          <textarea
            rows={2}
            value={profile.foundation[key]}
            onChange={(event) => onChange({ ...profile, foundation: { ...profile.foundation, [key]: event.target.value } })}
          />
        </label>
      ))}
      <details className="stack" open={!appearance.every((key) => !profile.foundation[key].trim())}>
        <summary>{LABELS.appearanceGroup}</summary>
        {appearance.map((key) => (
          <label key={key}>
            {LABELS.foundationFields[key]}
            {key in LABELS.fieldHelp ? <FieldHelp field={key as keyof typeof LABELS.fieldHelp} /> : null}
            <textarea
              rows={key === "appearance" ? 3 : 2}
              value={profile.foundation[key]}
              onChange={(event) => onChange({ ...profile, foundation: { ...profile.foundation, [key]: event.target.value } })}
            />
          </label>
        ))}
      </details>
      <details className="stack" open={!background.every((key) => !profile.foundation[key].trim())}>
        <summary>{LABELS.backgroundGroup}</summary>
        {background.map((key) => (
          <label key={key}>
            {LABELS.foundationFields[key]}
            {key in LABELS.fieldHelp ? <FieldHelp field={key as keyof typeof LABELS.fieldHelp} /> : null}
            <textarea
              rows={key === "formativeBackground" ? 3 : 2}
              value={profile.foundation[key]}
              onChange={(event) => onChange({ ...profile, foundation: { ...profile.foundation, [key]: event.target.value } })}
            />
          </label>
        ))}
      </details>
    </div>
  );
}

function VoiceFields({
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
  const bookVoice = profile.bookVoices.find((item) => item.projectId === projectId);
  const primary: VoiceTextKey[] = ["diction", "vocabulary", "speechPatterns", "exampleDialogue", "consistencyGuardrails"];
  const advanced = VOICE_TEXT_KEYS.filter((key) => !primary.includes(key));
  return (
    <div className="stack">
      <p className="small muted">{LABELS.voiceLead}</p>
      {primary.map((key) => (
        <label key={key}>
          {LABELS.voiceFields[key]}
          {key in LABELS.fieldHelp ? <FieldHelp field={key as keyof typeof LABELS.fieldHelp} /> : null}
          <textarea
            rows={key === "exampleDialogue" || key === "consistencyGuardrails" ? 4 : 2}
            value={profile.voice[key]}
            onChange={(event) => onChange({ ...profile, voice: { ...profile.voice, [key]: event.target.value } })}
          />
        </label>
      ))}
      <details className="stack">
        <summary>More voice detail</summary>
        {advanced.map((key) => (
          <label key={key}>
            {LABELS.voiceFields[key]}
            {key in LABELS.fieldHelp ? <FieldHelp field={key as keyof typeof LABELS.fieldHelp} /> : null}
            <textarea
              rows={key === "approvedExamples" || key === "internalNarrative" ? 4 : 2}
              value={profile.voice[key]}
              onChange={(event) => onChange({ ...profile, voice: { ...profile.voice, [key]: event.target.value } })}
            />
          </label>
        ))}
      </details>
      <fieldset className="stack">
        <legend>{LABELS.bookVoice}</legend>
        <p className="small muted">{LABELS.bookVoiceHint}</p>
        {bookVoice ? (
          primary.map((key) => (
            <label key={`book-${key}`}>
              {LABELS.voiceFields[key]}
              <textarea
                rows={2}
                value={bookVoice.voice[key]}
                onChange={(event) =>
                  onChange({
                    ...profile,
                    bookVoices: profile.bookVoices.map((item) =>
                      item.projectId === projectId
                        ? { ...item, voice: { ...item.voice, [key]: event.target.value } }
                        : item,
                    ),
                  })
                }
              />
            </label>
          ))
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              onChange({
                ...profile,
                bookVoices: [...profile.bookVoices, { projectId, voice: emptyVoice() }],
              })
            }
          >
            {LABELS.addBookVoice}
          </Button>
        )}
        {catalog.books.length > 1 && bookVoice ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => onChange({ ...profile, bookVoices: profile.bookVoices.filter((item) => item.projectId !== projectId) })}
          >
            Remove
          </Button>
        ) : null}
      </fieldset>
    </div>
  );
}

function BehaviorFields({
  profile,
  onChange,
}: {
  profile: CharacterDevelopment;
  onChange: (next: CharacterDevelopment) => void;
}) {
  return (
    <div className="stack">
      <p className="small muted">{LABELS.behaviorLead}</p>
      {BEHAVIOR_TEXT_KEYS.map((key) => (
        <label key={key}>
          {LABELS.behaviorFields[key as BehaviorTextKey]}
          {key in LABELS.fieldHelp ? <FieldHelp field={key as keyof typeof LABELS.fieldHelp} /> : null}
          <textarea
            rows={3}
            value={profile.behavior[key]}
            onChange={(event) => onChange({ ...profile, behavior: { ...profile.behavior, [key]: event.target.value } })}
          />
        </label>
      ))}
    </div>
  );
}

function CapabilitiesFields({
  profile,
  catalog,
  onChange,
}: {
  profile: CharacterDevelopment;
  catalog: DevelopmentCatalog;
  onChange: (next: CharacterDevelopment) => void;
}) {
  return (
    <div className="stack">
      <p className="small muted">{LABELS.capabilitiesLead}</p>
      {CAPABILITIES_TEXT_KEYS.map((key) => (
        <label key={key}>
          {LABELS.capabilitiesFields[key as CapabilitiesTextKey]}
          {key in LABELS.fieldHelp ? <FieldHelp field={key as keyof typeof LABELS.fieldHelp} /> : null}
          <textarea
            rows={3}
            value={profile.capabilities[key]}
            onChange={(event) =>
              onChange({ ...profile, capabilities: { ...profile.capabilities, [key]: event.target.value } })
            }
          />
        </label>
      ))}
      <fieldset className="stack">
        <legend>{LABELS.linkedCapabilityRefs}</legend>
        <p className="small muted">{LABELS.linkedCapabilityRefsHint}</p>
        {catalog.worldRefs.map((ref) => (
          <Checkbox
            key={ref.id}
            className="small"
            checked={profile.capabilities.linkedRecordIds.includes(ref.id)}
            onChange={(event) => {
              const linkedRecordIds = event.target.checked
                ? [...profile.capabilities.linkedRecordIds, ref.id]
                : profile.capabilities.linkedRecordIds.filter((id) => id !== ref.id);
              onChange({ ...profile, capabilities: { ...profile.capabilities, linkedRecordIds } });
            }}
            label={ref.label}
          />
        ))}
        {!catalog.worldRefs.length ? <p className="small muted">{LABELS.none}</p> : null}
      </fieldset>
    </div>
  );
}

function LivedExperienceFields({
  profile,
  onChange,
}: {
  profile: CharacterDevelopment;
  onChange: (next: CharacterDevelopment) => void;
}) {
  const lived = profile.livedExperience;
  const primary: LivedExperienceTextKey[] = ["formativeExperiences", "coping", "portrayalGuidance", "stereotypesToAvoid"];
  const sensitive = LIVED_EXPERIENCE_TEXT_KEYS.filter((key) => !primary.includes(key));
  return (
    <div className="stack">
      <p className="small muted">{LABELS.livedLead}</p>
      {primary.map((key) => (
        <label key={key}>
          {LABELS.livedFields[key]}
          {key in LABELS.fieldHelp ? <FieldHelp field={key as keyof typeof LABELS.fieldHelp} /> : null}
          <textarea
            rows={3}
            value={lived[key]}
            onChange={(event) =>
              onChange({ ...profile, livedExperience: { ...lived, [key]: event.target.value } })
            }
          />
        </label>
      ))}
      <details className="stack">
        <summary>Neurodivergence, disability, trauma, and boundaries</summary>
        {sensitive.map((key) => (
          <label key={key}>
            {LABELS.livedFields[key]}
            {key in LABELS.fieldHelp ? <FieldHelp field={key as keyof typeof LABELS.fieldHelp} /> : null}
            <textarea
              rows={3}
              value={lived[key]}
              onChange={(event) =>
                onChange({ ...profile, livedExperience: { ...lived, [key]: event.target.value } })
              }
            />
          </label>
        ))}
      </details>
      <label>
        {LABELS.approval}
        <select
          value={lived.approval}
          onChange={(event) =>
            onChange({ ...profile, livedExperience: { ...lived, approval: event.target.value as typeof lived.approval } })
          }
        >
          {AUTHORITY_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <label>
        {LABELS.livedAiVisibility}
        <select
          value={lived.aiVisibility}
          onChange={(event) =>
            onChange({
              ...profile,
              livedExperience: { ...lived, aiVisibility: event.target.value as typeof lived.aiVisibility },
            })
          }
        >
          {AI_VISIBILITY.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function KnowledgeFields({
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
  const blank = (): KnowledgeItem => ({
    id: newId("know"),
    kind: "knowledge",
    statement: "",
    approval: "draft",
    planned: false,
    bookProjectId: projectId,
    fromStoryEventId: null,
    untilStoryEventId: null,
    sceneRecordId: null,
    holder: "character",
    aiVisibility: "include",
    establishedFactId: null,
    provenance: { origin: "author", note: "" },
  });
  return (
    <div className="stack">
      <p className="small muted">{LABELS.knowledgeLead}</p>
      {profile.knowledge.map((item) => (
        <div key={item.id} className="stack">
          <label>
            {LABELS.knowledgeKind}
            <select
              value={item.kind}
              onChange={(event) => {
                const kind = event.target.value as KnowledgeItem["kind"];
                onChange({
                  ...profile,
                  knowledge: profile.knowledge.map((row) =>
                    row.id === item.id
                      ? {
                          ...row,
                          kind,
                          aiVisibility: kind === "secret" && row.aiVisibility === "include" ? "omit" : row.aiVisibility,
                        }
                      : row,
                  ),
                });
              }}
            >
              {KNOWLEDGE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <label>
            {LABELS.knowledgeStatement}
            <textarea
              rows={2}
              value={item.statement}
              onChange={(event) =>
                onChange({
                  ...profile,
                  knowledge: profile.knowledge.map((row) => (row.id === item.id ? { ...row, statement: event.target.value } : row)),
                })
              }
            />
          </label>
          <label>
            {LABELS.knowledgeHolder}
            <select
              value={item.holder}
              onChange={(event) =>
                onChange({
                  ...profile,
                  knowledge: profile.knowledge.map((row) =>
                    row.id === item.id ? { ...row, holder: event.target.value as KnowledgeItem["holder"] } : row,
                  ),
                })
              }
            >
              {KNOWLEDGE_HOLDERS.map((holder) => (
                <option key={holder} value={holder}>
                  {holder}
                </option>
              ))}
            </select>
          </label>
          <label>
            {LABELS.approval}
            <select
              value={item.approval}
              onChange={(event) =>
                onChange({
                  ...profile,
                  knowledge: profile.knowledge.map((row) =>
                    row.id === item.id ? { ...row, approval: event.target.value as KnowledgeItem["approval"] } : row,
                  ),
                })
              }
            >
              {AUTHORITY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <Checkbox
            className="small"
            checked={item.planned}
            onChange={(event) =>
              onChange({
                ...profile,
                knowledge: profile.knowledge.map((row) => (row.id === item.id ? { ...row, planned: event.target.checked } : row)),
              })
            }
            label={LABELS.planned}
          />
          <label>
            {LABELS.livedAiVisibility}
            <select
              value={item.aiVisibility}
              onChange={(event) =>
                onChange({
                  ...profile,
                  knowledge: profile.knowledge.map((row) =>
                    row.id === item.id ? { ...row, aiVisibility: event.target.value as KnowledgeItem["aiVisibility"] } : row,
                  ),
                })
              }
            >
              {AI_VISIBILITY.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <Choice
            label={LABELS.knowledgeFrom}
            value={item.fromStoryEventId}
            choices={catalog.events}
            onChange={(fromStoryEventId) =>
              onChange({
                ...profile,
                knowledge: profile.knowledge.map((row) => (row.id === item.id ? { ...row, fromStoryEventId } : row)),
              })
            }
          />
          <Choice
            label={LABELS.knowledgeUntil}
            value={item.untilStoryEventId}
            choices={catalog.events}
            onChange={(untilStoryEventId) =>
              onChange({
                ...profile,
                knowledge: profile.knowledge.map((row) => (row.id === item.id ? { ...row, untilStoryEventId } : row)),
              })
            }
          />
          <Choice
            label={LABELS.scene}
            value={item.sceneRecordId}
            choices={catalog.scenes}
            onChange={(sceneRecordId) =>
              onChange({
                ...profile,
                knowledge: profile.knowledge.map((row) => (row.id === item.id ? { ...row, sceneRecordId } : row)),
              })
            }
          />
          <Choice
            label={LABELS.knowledgeFact}
            value={item.establishedFactId}
            choices={catalog.facts}
            onChange={(establishedFactId) =>
              onChange({
                ...profile,
                knowledge: profile.knowledge.map((row) => (row.id === item.id ? { ...row, establishedFactId } : row)),
              })
            }
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => onChange({ ...profile, knowledge: profile.knowledge.filter((row) => row.id !== item.id) })}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" variant="secondary" onClick={() => onChange({ ...profile, knowledge: [...profile.knowledge, blank()] })}>
        {LABELS.addKnowledge}
      </Button>
    </div>
  );
}

function stampAuthorField(
  profile: CharacterDevelopment,
  fieldPath: string,
  patch: CharacterDevelopment,
): CharacterDevelopment {
  const previous = fieldMetaOf(profile, fieldPath);
  return setFieldMeta(patch, fieldPath, {
    approval: previous.approval,
    provenance: {
      origin: "author",
      note: previous.provenance.note,
      sourceHeading: previous.provenance.sourceHeading,
      sourceBodyHash: previous.provenance.sourceBodyHash,
      updatedAt: new Date().toISOString(),
    },
  });
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
  const primaryKeys = [
    "coreDesire",
    "coreFear",
    "coreMotivation",
    "consciousWants",
    "unconsciousNeeds",
    "internalMisbelief",
    "strengths",
    "blindSpots",
    "contradictions",
  ] as const;
  const advancedKeys = PSYCHOLOGY_TEXT_KEYS.filter((key) => !(primaryKeys as readonly string[]).includes(key));
  return (
    <div className="stack">
      {empty && !psychology.enneagram ? <EmptyState>{LABELS.empty}</EmptyState> : null}
      <p className="small muted">{LABELS.psychologyLead}</p>
      <p className="small muted">{LABELS.unknownVsUnset}</p>
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
          <HelpPopover label={LABELS.enneagram}>{LABELS.conceptHelp.enneagram}</HelpPopover>
          <select
            value={type === null ? "" : String(type)}
            onChange={(event) => {
              const raw = event.target.value;
              const enneagram: EnneagramChoice | null =
                raw === "" ? null : raw === "unknown" || raw === "undecided" || raw === "not_applicable" ? raw : (Number(raw) as EnneagramChoice);
              onChange(
                stampAuthorField(profile, "psychology.enneagram", {
                  ...profile,
                  psychology: { ...psychology, enneagram, wing: null },
                }),
              );
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
          <FieldAuthorityControl profile={profile} fieldPath="psychology.enneagram" onChange={onChange} />
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
      <p className="small muted">
        {LABELS.conceptHelp.wantVersusNeed}
        <HelpPopover label="Want versus need">{LABELS.conceptHelp.wantVersusNeed}</HelpPopover>
      </p>
      {primaryKeys.map((key) => (
        <label key={key}>
          {LABELS.fields[key]}
          {key === "coreFear" ? <HelpPopover label={LABELS.fields.coreFear}>{LABELS.conceptHelp.coreFear}</HelpPopover> : null}
          {key === "internalMisbelief" ? (
            <HelpPopover label={LABELS.fields.internalMisbelief}>{LABELS.conceptHelp.internalMisbelief}</HelpPopover>
          ) : null}
          {key in LABELS.fieldHelp ? <FieldHelp field={key as keyof typeof LABELS.fieldHelp} /> : null}
          <textarea
            rows={2}
            value={psychology[key]}
            onChange={(event) =>
              onChange(
                stampAuthorField(profile, `psychology.${key}`, {
                  ...profile,
                  psychology: { ...psychology, [key]: event.target.value },
                }),
              )
            }
          />
          <FieldAuthorityControl profile={profile} fieldPath={`psychology.${key}`} onChange={onChange} />
        </label>
      ))}
      <details className="stack">
        <summary>More psychology detail</summary>
        {advancedKeys.map((key) => (
          <label key={key}>
            {LABELS.fields[key]}
            {key in LABELS.fieldHelp ? <FieldHelp field={key as keyof typeof LABELS.fieldHelp} /> : null}
            <textarea
              rows={2}
              value={psychology[key]}
              onChange={(event) =>
                onChange(
                  stampAuthorField(profile, `psychology.${key}`, {
                    ...profile,
                    psychology: { ...psychology, [key]: event.target.value },
                  }),
                )
              }
            />
            <FieldAuthorityControl profile={profile} fieldPath={`psychology.${key}`} onChange={onChange} />
          </label>
        ))}
      </details>
      <fieldset className="stack">
        <legend>{LABELS.frameworks}</legend>
        {psychology.frameworks.map((framework) => (
          <div key={framework.id} className="stack">
            <div className="grid2">
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
                          item.id === framework.id
                            ? {
                                ...item,
                                name: event.target.value,
                                provenance: { ...item.provenance, origin: "author", updatedAt: new Date().toISOString() },
                              }
                            : item,
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
            <label className="small">
              {LABELS.fieldAuthority}
              <select
                value={framework.approval}
                onChange={(event) =>
                  onChange({
                    ...profile,
                    psychology: {
                      ...psychology,
                      frameworks: psychology.frameworks.map((item) =>
                        item.id === framework.id ? { ...item, approval: event.target.value as AuthorityStatus } : item,
                      ),
                    },
                  })
                }
              >
                {AUTHORITY_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <span className="small muted">
              {LABELS.fieldProvenance}: {framework.provenance.origin}
            </span>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            onChange({
              ...profile,
              psychology: {
                ...psychology,
                frameworks: [
                  ...psychology.frameworks,
                  { id: newId("frame"), name: "", notes: "", approval: "draft", provenance: { origin: "author", note: "" } },
                ],
              },
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
    onChange({
      ...profile,
      archetypes: profile.archetypes.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              provenance: patch.provenance ?? {
                ...item.provenance,
                origin: patch.approval ? item.provenance.origin : "author",
                updatedAt: new Date().toISOString(),
              },
            }
          : item,
      ),
    });
  return (
    <div className="stack">
      <p className="small muted">{LABELS.archetypeLead}</p>
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
            Rank
            <select
              value={archetype.rank}
              onChange={(event) => update(archetype.id, { rank: event.target.value as ArchetypeRank })}
            >
              {ARCHETYPE_RANKS.map((rank) => (
                <option key={rank} value={rank}>
                  {rank === "shadow" ? LABELS.shadow : rank === "secondary" ? LABELS.secondary : LABELS.primary}
                </option>
              ))}
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
            {LABELS.evolvesFrom}
            <select
              value={archetype.evolvesFromId ?? ""}
              onChange={(event) => update(archetype.id, { evolvesFromId: event.target.value || null })}
            >
              <option value="">{LABELS.none}</option>
              {profile.archetypes
                .filter((item) => item.id !== archetype.id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name || item.id} ({item.rank})
                  </option>
                ))}
            </select>
          </label>
          <label>
            {LABELS.evolutionNote}
            <textarea rows={2} value={archetype.evolutionNote} onChange={(event) => update(archetype.id, { evolutionNote: event.target.value })} />
          </label>
          <label>
            {LABELS.archetypeBook}
            <select
              value={archetype.bookProjectId ?? ""}
              onChange={(event) => update(archetype.id, { bookProjectId: event.target.value || null })}
            >
              <option value="">{LABELS.none}</option>
              {catalog.books.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Description
            <textarea rows={2} value={archetype.description} onChange={(event) => update(archetype.id, { description: event.target.value })} />
          </label>
          <label className="small">
            {LABELS.fieldAuthority}
            <select
              value={archetype.approval}
              onChange={(event) => update(archetype.id, { approval: event.target.value as AuthorityStatus })}
            >
              {AUTHORITY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <span className="small muted">
            {LABELS.fieldProvenance}: {archetype.provenance.origin}
          </span>
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
                rank: profile.archetypes.some((item) => item.rank === "primary") ? "secondary" : "primary",
                periodLabel: "",
                relationshipRecordId: null,
                evolvesFromId: null,
                evolutionNote: "",
                bookProjectId: null,
                approval: "draft",
                provenance: { origin: "author", note: "" },
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
                <Checkbox
                  key={character.id}
                  className="small"
                  checked={arc.participantRecordIds.includes(character.id)}
                  onChange={(event) => {
                    const participantRecordIds = event.target.checked
                      ? [...arc.participantRecordIds, character.id]
                      : arc.participantRecordIds.filter((id) => id !== character.id);
                    replace({ ...arc, participantRecordIds });
                  }}
                  label={character.label}
                />
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
              {LABELS.milestoneKind}
              <select
                value={milestone.kind}
                onChange={(event) =>
                  onChange({
                    ...arc,
                    milestones: arc.milestones.map((item) =>
                      item.id === milestone.id ? { ...item, kind: event.target.value as MilestoneKind } : item,
                    ),
                  })
                }
              >
                {MILESTONE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
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
                    {status === "planned"
                      ? LABELS.canonPlanned
                      : status === "approved"
                        ? LABELS.canonApproved
                        : status === "manuscript_confirmed"
                          ? LABELS.canonManuscript
                          : LABELS.canonAi}
                  </option>
                ))}
              </select>
              <span
                className={
                  milestone.status === "approved"
                    ? "badge approved"
                    : milestone.status === "manuscript_confirmed"
                      ? "badge manuscript"
                      : milestone.status === "ai_suggested"
                        ? "badge proposed"
                        : "badge"
                }
              >
                {milestone.status === "planned"
                  ? LABELS.canonPlanned
                  : milestone.status === "approved"
                    ? LABELS.canonApproved
                    : milestone.status === "manuscript_confirmed"
                      ? LABELS.canonManuscript
                      : LABELS.canonAi}
              </span>
            </label>
            <Choice
              label={LABELS.selectBook}
              value={milestone.bookProjectId}
              choices={catalog.books}
              onChange={(bookProjectId) =>
                onChange({ ...arc, milestones: arc.milestones.map((item) => (item.id === milestone.id ? { ...item, bookProjectId } : item)) })
              }
            />
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
            <Choice
              label="Reference"
              value={milestone.referenceRecordId}
              choices={catalog.worldRefs}
              onChange={(referenceRecordId) =>
                onChange({
                  ...arc,
                  milestones: arc.milestones.map((item) => (item.id === milestone.id ? { ...item, referenceRecordId } : item)),
                })
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

function SeriesPlanFields({
  profile,
  onChange,
}: {
  profile: CharacterDevelopment;
  onChange: (next: CharacterDevelopment) => void;
}) {
  const plan = profile.seriesPlan ?? emptySeriesPlan();
  return (
    <details className="stack" open={SERIES_PLAN_TEXT_KEYS.some((key) => plan[key].trim())}>
      <summary>{LABELS.seriesPlan}</summary>
      <p className="small muted">{LABELS.seriesPlanLead}</p>
      {SERIES_PLAN_TEXT_KEYS.map((key) => (
        <label key={key}>
          {LABELS.seriesPlanFields[key]}
          <textarea
            rows={2}
            value={plan[key]}
            onChange={(event) =>
              onChange({
                ...profile,
                seriesPlan: { ...plan, [key]: event.target.value },
              })
            }
          />
        </label>
      ))}
      <label className="small">
        {LABELS.approval}
        <select
          value={plan.approval}
          onChange={(event) =>
            onChange({
              ...profile,
              seriesPlan: { ...plan, approval: event.target.value as AuthorityStatus },
            })
          }
        >
          {AUTHORITY_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
    </details>
  );
}

function BookPlanFields({
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
  const [bookId, setBookId] = useState(projectId);
  const bookState = profile.bookStates.find((item) => item.projectId === bookId) ?? emptyBookState(bookId);
  const patch = (next: Partial<typeof bookState>) => {
    const merged = { ...emptyBookState(bookId), ...bookState, ...next, projectId: bookId };
    onChange({
      ...profile,
      bookStates: [...profile.bookStates.filter((item) => item.projectId !== bookId), merged],
    });
  };
  return (
    <details className="stack" open>
      <summary>{LABELS.bookPlan}</summary>
      <p className="small muted">{LABELS.bookPlanLead}</p>
      <Select
        label={LABELS.selectBook}
        labelPosition="top"
        size="sm"
        value={bookId}
        onChange={(event) => setBookId(event.target.value)}
      >
        {catalog.books.map((book) => (
          <option key={book.id} value={book.id}>
            {book.label}
          </option>
        ))}
      </Select>
      <label>
        {LABELS.bookArcTemplate}
        <select
          value={bookState.arcTemplate ?? ""}
          onChange={(event) => patch({ arcTemplate: (event.target.value || null) as typeof bookState.arcTemplate })}
        >
          <option value="">{LABELS.unset}</option>
          {ARC_TEMPLATES.map((template) => (
            <option key={template} value={template}>
              {template.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      {BOOK_PLAN_TEXT_KEYS.map((key) => (
        <label key={key}>
          {LABELS.bookPlanFields[key]}
          <textarea rows={2} value={bookState[key]} onChange={(event) => patch({ [key]: event.target.value })} />
        </label>
      ))}
    </details>
  );
}

function MilestoneSummary({ profile }: { profile: CharacterDevelopment }) {
  const milestones = profile.arcs.flatMap((arc) => arc.milestones.map((milestone) => ({ arc, milestone })));
  const planned = milestones.filter(
    (item) => item.milestone.status === "planned" || item.milestone.status === "ai_suggested",
  );
  const completed = milestones.filter(
    (item) => item.milestone.status === "approved" || item.milestone.status === "manuscript_confirmed",
  );
  return (
    <p className="small">
      {LABELS.plannedMilestones}: {planned.length} · {LABELS.completedMilestones}: {completed.length}
    </p>
  );
}

function DevelopmentTimeline({
  profile,
  catalog,
}: {
  profile: CharacterDevelopment;
  catalog: DevelopmentCatalog;
}) {
  const entries = useMemo(() => buildCharacterTimeline(profile, catalog.books), [profile, catalog.books]);
  return (
    <details className="stack">
      <summary>{LABELS.timeline}</summary>
      <p className="small muted">{LABELS.timelineLead}</p>
      {entries.length === 0 ? (
        <EmptyState>{LABELS.emptySection}</EmptyState>
      ) : (
        <ul className="stack">
          {entries.map((entry) => (
            <li key={entry.id} className="small">
              <span className={entry.planned ? "badge proposed" : entry.status === "superseded" ? "badge superseded" : "badge approved"}>
                {entry.kind.replaceAll("_", " ")}
              </span>{" "}
              <strong>{entry.title}</strong>
              <div className="muted">{entry.detail}</div>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function pointFromControls(input: {
  boundary: NarrativeBoundary;
  bookProjectId: string;
  storyEventId: string;
  chapterRecordId: string;
  sceneRecordId: string;
}): NarrativePoint {
  return {
    bookProjectId: input.bookProjectId || null,
    storyEventId: input.storyEventId || null,
    chapterRecordId: input.chapterRecordId || null,
    sceneRecordId: input.sceneRecordId || null,
    sequence: null,
    boundary: input.boundary,
  };
}

function HistoricalStateViewer({
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
  const [boundary, setBoundary] = useState<NarrativeBoundary>("at_point");
  const [bookId, setBookId] = useState(projectId);
  const [storyEventId, setStoryEventId] = useState("");
  const [chapterRecordId, setChapterRecordId] = useState("");
  const [sceneRecordId, setSceneRecordId] = useState("");
  const [compareBoundary, setCompareBoundary] = useState<NarrativeBoundary>("baseline");
  const [compareBookId, setCompareBookId] = useState(projectId);
  const [showCompare, setShowCompare] = useState(false);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctionText, setCorrectionText] = useState("");
  const [correctionNote, setCorrectionNote] = useState("");
  const edges = catalog.eventOrders ?? [];
  const point = pointFromControls({ boundary, bookProjectId: bookId, storyEventId, chapterRecordId, sceneRecordId });
  const comparePoint = pointFromControls({
    boundary: compareBoundary,
    bookProjectId: compareBookId,
    storyEventId: "",
    chapterRecordId: "",
    sceneRecordId: "",
  });
  const resolved = resolveCharacterState(profile, point, edges);
  const knowledge = resolveKnowledgeAtPoint(profile, point, edges);
  const comparison = showCompare ? compareCharacterStates(profile, comparePoint, point, edges) : null;

  return (
    <details className="stack" open>
      <summary>{LABELS.historicalState}</summary>
      <p className="small muted">{LABELS.historicalStateLead}</p>
      <div className="grid2">
        <Select label={LABELS.stateBoundary} size="sm" value={boundary} onChange={(event) => setBoundary(event.target.value as NarrativeBoundary)}>
          {NARRATIVE_BOUNDARIES.map((item) => (
            <option key={item} value={item}>
              {LABELS.stateBoundaries[item]}
            </option>
          ))}
        </Select>
        <Select label={LABELS.selectBook} size="sm" value={bookId} onChange={(event) => setBookId(event.target.value)}>
          {catalog.books.map((book) => (
            <option key={book.id} value={book.id}>
              {book.label}
            </option>
          ))}
        </Select>
        {boundary === "at_point" ? (
          <>
            <Choice label="Timeline event" value={storyEventId || null} choices={catalog.events} onChange={(value) => setStoryEventId(value ?? "")} />
            <Choice label="Chapter" value={chapterRecordId || null} choices={catalog.chapters} onChange={(value) => setChapterRecordId(value ?? "")} />
            <Choice label={LABELS.scene} value={sceneRecordId || null} choices={catalog.scenes} onChange={(value) => setSceneRecordId(value ?? "")} />
          </>
        ) : null}
      </div>
      <ul className="stack">
        {STATE_FACETS.map((facet) => {
          const value = resolved.facets[facet];
          return (
            <li key={facet} className="small">
              <strong>{facet.replaceAll("_", " ")}</strong>:{" "}
              {value.presence === "unset"
                ? LABELS.unset
                : value.presence === "unknown"
                  ? LABELS.unknown
                  : value.text}
            </li>
          );
        })}
      </ul>
      {resolved.conflicts.length ? (
        <Banner tone="error">
          {LABELS.conflictsAtPoint}: {resolved.conflicts.map((item) => item.facet).join(", ")}
        </Banner>
      ) : null}
      {resolved.unplacedChangeIds.length ? (
        <p className="small muted">
          {LABELS.unplacedAtPoint}: {resolved.unplacedChangeIds.join(", ")}
        </p>
      ) : null}
      {resolved.supersededChangeIds.length ? (
        <p className="small muted">
          {LABELS.superseded}: {resolved.supersededChangeIds.length}
        </p>
      ) : null}
      <div className="stack">
        <p className="small">{LABELS.activeKnowledge}</p>
        {knowledge.length === 0 ? (
          <EmptyState>{LABELS.emptySection}</EmptyState>
        ) : (
          <ul className="small">
            {knowledge.map((item) => (
              <li key={item.id}>
                {item.kind}: {item.statement}
              </li>
            ))}
          </ul>
        )}
      </div>
      <fieldset className="stack">
        <legend>{LABELS.compareStates}</legend>
        <Select
          label={LABELS.compareFrom}
          size="sm"
          value={compareBoundary}
          onChange={(event) => setCompareBoundary(event.target.value as NarrativeBoundary)}
        >
          {NARRATIVE_BOUNDARIES.map((item) => (
            <option key={item} value={item}>
              {LABELS.stateBoundaries[item]}
            </option>
          ))}
        </Select>
        <Select label={LABELS.selectBook} size="sm" value={compareBookId} onChange={(event) => setCompareBookId(event.target.value)}>
          {catalog.books.map((book) => (
            <option key={book.id} value={book.id}>
              {book.label}
            </option>
          ))}
        </Select>
        <Button type="button" variant="secondary" onClick={() => setShowCompare(true)}>
          {LABELS.runComparison}
        </Button>
        {comparison ? (
          comparison.diffs.every((diff) => diff.kind === "unchanged") ? (
            <EmptyState>{LABELS.noStateDiffs}</EmptyState>
          ) : (
            <ul className="small">
              {comparison.diffs
                .filter((diff) => diff.kind !== "unchanged")
                .map((diff) => (
                  <li key={diff.facet}>
                    {diff.facet}: {diff.kind}
                    {diff.to.presence === "set" ? ` → ${diff.to.text}` : diff.to.presence === "unknown" ? ` → ${LABELS.unknown}` : ""}
                  </li>
                ))}
            </ul>
          )
        ) : null}
      </fieldset>
      <fieldset className="stack">
        <legend>{LABELS.recordCorrection}</legend>
        <Select
          label="Prior state change"
          size="sm"
          value={correctingId ?? ""}
          onChange={(event) => setCorrectingId(event.target.value || null)}
        >
          <option value="">{LABELS.none}</option>
          {profile.stateChanges
            .filter((change) => change.approval !== "superseded")
            .map((change) => (
              <option key={change.id} value={change.id}>
                {change.facet}: {change.text || change.note || change.id}
              </option>
            ))}
        </Select>
        <label>
          {LABELS.stateValue}
          <input value={correctionText} onChange={(event) => setCorrectionText(event.target.value)} />
        </label>
        <label>
          {LABELS.correctionNote}
          <input value={correctionNote} onChange={(event) => setCorrectionNote(event.target.value)} />
        </label>
        <Button
          type="button"
          variant="secondary"
          disabled={!correctingId}
          onClick={() => {
            if (!correctingId) return;
            const previous = profile.stateChanges.find((change) => change.id === correctingId);
            if (!previous) return;
            const result = supersedeStateChange(
              profile,
              correctingId,
              {
                ...previous,
                text: correctionText,
                presence: correctionText.trim() ? "set" : "unknown",
                approval: "approved",
                planned: false,
                correctionNote: correctionNote || "Author correction",
                correctedAt: null,
              },
              (prefix) => newId(prefix),
            );
            if (result.ok) {
              onChange(result.profile);
              setCorrectingId(null);
              setCorrectionText("");
              setCorrectionNote("");
            }
          }}
        >
          {LABELS.recordCorrection}
        </Button>
      </fieldset>
    </details>
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
  const [selectedBookId, setSelectedBookId] = useState(projectId);
  const book = profile.bookImportance.find((item) => item.projectId === selectedBookId);
  const bookState = profile.bookStates.find((item) => item.projectId === selectedBookId);
  const patchImportance = (patch: Partial<NonNullable<typeof book>>) => {
    const next = {
      projectId: selectedBookId,
      importance: book?.importance ?? null,
      narrativeRole: book?.narrativeRole ?? null,
      presence: book?.presence ?? "present",
      ...patch,
    };
    onChange({
      ...profile,
      bookImportance: [...profile.bookImportance.filter((item) => item.projectId !== selectedBookId), next],
    });
  };
  const patchState = (patch: Partial<NonNullable<typeof bookState>>) => {
    const next = {
      ...emptyBookState(selectedBookId),
      ...bookState,
      projectId: selectedBookId,
      ...patch,
    };
    onChange({ ...profile, bookStates: [...profile.bookStates.filter((item) => item.projectId !== selectedBookId), next] });
  };
  return (
    <div className="stack">
      <p className="small muted">{LABELS.narrativeOrderHint}</p>
      <Select
        label={LABELS.selectBook}
        size="sm"
        value={selectedBookId}
        onChange={(event) => setSelectedBookId(event.target.value)}
      >
        {catalog.books.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </Select>
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
            value={normalizeImportance(book?.importance ?? null) ?? book?.importance ?? ""}
            onChange={(event) => patchImportance({ importance: (event.target.value || null) as ImportanceLevel | null })}
          >
            <option value="">{LABELS.unset}</option>
            {IMPORTANCE_LEVELS.map((level) => (
              <option key={level} value={level}>
                {LABELS.importanceLevels[level]}
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
        {LABELS.openingApproval}
        <select
          value={bookState?.openingApproval ?? "draft"}
          onChange={(event) => patchState({ openingApproval: event.target.value as NonNullable<typeof bookState>["openingApproval"] })}
        >
          {AUTHORITY_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <FacetList
        legend={LABELS.openingFacets}
        facets={bookState?.opening ?? []}
        onChange={(opening) => patchState({ opening })}
      />
      <label>
        {LABELS.closing}
        <textarea rows={2} value={bookState?.closingNote ?? ""} onChange={(event) => patchState({ closingNote: event.target.value })} />
      </label>
      <label>
        {LABELS.closingApproval}
        <select
          value={bookState?.closingApproval ?? "draft"}
          onChange={(event) => patchState({ closingApproval: event.target.value as NonNullable<typeof bookState>["closingApproval"] })}
        >
          {AUTHORITY_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <FacetList
        legend={LABELS.closingFacets}
        facets={bookState?.closing ?? []}
        onChange={(closing) => patchState({ closing })}
      />
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
              stateChanges: [...profile.stateChanges, blankStateChange(selectedBookId)],
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
                  ? {
                      foundationRecordId: event.target.value,
                      inheritedKeys: profile.variant?.inheritedKeys ?? [],
                      relationshipKind: profile.variant?.relationshipKind ?? "other",
                      relationshipLabel: profile.variant?.relationshipLabel ?? "",
                    }
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
        {profile.variant ? (
          <>
            <Select
              label={LABELS.variantKind}
              size="sm"
              value={profile.variant.relationshipKind}
              onChange={(event) =>
                onChange({
                  ...profile,
                  variant: profile.variant
                    ? { ...profile.variant, relationshipKind: event.target.value as VariantRelationshipKind }
                    : null,
                })
              }
            >
              {VARIANT_RELATIONSHIP_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {LABELS.variantKinds[kind]}
                </option>
              ))}
            </Select>
            <label>
              {LABELS.variantLabel}
              <input
                value={profile.variant.relationshipLabel}
                onChange={(event) =>
                  onChange({
                    ...profile,
                    variant: profile.variant ? { ...profile.variant, relationshipLabel: event.target.value } : null,
                  })
                }
              />
            </label>
            {INHERITABLE_KEYS.map((key) => (
              <Checkbox
                key={key}
                className="small"
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
                label={key}
              />
            ))}
          </>
        ) : null}
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

function FacetList({
  legend,
  facets,
  onChange,
}: {
  legend: string;
  facets: FacetValue[];
  onChange: (next: FacetValue[]) => void;
}) {
  return (
    <fieldset className="stack">
      <legend>{legend}</legend>
      {facets.map((facet, index) => (
        <div key={`${facet.facet}-${index}`} className="stack">
          <label>
            {LABELS.stateFacet}
            <select
              value={facet.facet}
              onChange={(event) =>
                onChange(facets.map((item, i) => (i === index ? { ...item, facet: event.target.value as StateFacet } : item)))
              }
            >
              {STATE_FACETS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <Checkbox
            className="small"
            checked={facet.presence === "unknown"}
            onChange={(event) =>
              onChange(
                facets.map((item, i) =>
                  i === index
                    ? { ...item, presence: event.target.checked ? "unknown" : "set", text: event.target.checked ? "" : item.text }
                    : item,
                ),
              )
            }
            label={LABELS.explicitUnknown}
          />
          {facet.presence === "set" ? (
            <label>
              {LABELS.stateValue}
              <input
                value={facet.text}
                onChange={(event) => onChange(facets.map((item, i) => (i === index ? { ...item, text: event.target.value } : item)))}
              />
            </label>
          ) : null}
          <Button type="button" variant="secondary" onClick={() => onChange(facets.filter((_, i) => i !== index))}>
            Remove
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        onClick={() => onChange([...facets, { facet: "belief", presence: "set", text: "" }])}
      >
        {LABELS.addFacet}
      </Button>
    </fieldset>
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
      <Checkbox
        className="small"
        checked={change.presence === "unknown"}
        onChange={(event) => onChange({ ...change, presence: event.target.checked ? "unknown" : "set", text: event.target.checked ? "" : change.text })}
        label={LABELS.explicitUnknown}
      />
      {change.presence === "set" ? (
        <label>
          {LABELS.stateValue}
          <input value={change.text} onChange={(event) => onChange({ ...change, text: event.target.value })} />
        </label>
      ) : null}
      <Checkbox className="small" checked={change.planned} onChange={(event) => onChange({ ...change, planned: event.target.checked })} label={LABELS.planned} />
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
      <Choice
        label={LABELS.stateBook}
        value={change.bookProjectId}
        choices={catalog.books}
        onChange={(bookProjectId) => onChange({ ...change, bookProjectId })}
      />
      <Choice label="Timeline event" value={change.storyEventId} choices={catalog.events} onChange={(storyEventId) => onChange({ ...change, storyEventId })} />
      <Choice
        label="Chapter"
        value={change.chapterRecordId}
        choices={catalog.chapters}
        onChange={(chapterRecordId) => onChange({ ...change, chapterRecordId })}
      />
      <Choice
        label={LABELS.scene}
        value={change.sceneRecordId}
        choices={catalog.scenes}
        onChange={(sceneRecordId) => onChange({ ...change, sceneRecordId })}
      />
      <label>
        Sequence
        <input
          type="number"
          value={change.sequence ?? ""}
          onChange={(event) => onChange({ ...change, sequence: event.target.value === "" ? null : Number(event.target.value) })}
        />
      </label>
      {change.approval === "superseded" ? <span className="badge superseded">{LABELS.superseded}</span> : null}
      {change.supersedesId ? <p className="small muted">Corrects {change.supersedesId}</p> : null}
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
