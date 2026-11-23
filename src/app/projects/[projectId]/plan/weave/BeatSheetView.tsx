"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { IssueList } from "@/components/IssueList";
import { ContextRail, ContextRailToggle, useContextRail } from "@/components/shell/ContextRail";
import { Button } from "@/components/ui/Atoms/Button";
import { Select } from "@/components/ui/Atoms/Select";
import { HelpPopover } from "@/components/ui/HelpPopover";
import { IconButton } from "@/components/ui/IconButton";
import { TextField } from "@/components/ui/TextField";
import type { Issue } from "@/domain/issues";
import type { WeaveBeatView } from "@/server/services/weaveService";
import type {
  WeaveStructureStageView,
  WeaveStructureView,
} from "@/server/services/weaveStructureService";
import { WEAVE } from "@/ui/labels";
import {
  addIdeaToWeaveStageAction,
  forkIdeaOnWeaveStageAction,
  unlinkIdeaFromWeaveStageAction,
  updateWeaveIdeaTextAction,
  updateWeaveStageNotesAction,
} from "./actions";
import { CustomStructureForm } from "./CustomStructureForm";
import { DeleteWeavePlanButton } from "./DeleteWeavePlanButton";
import { PlanBreakdownView } from "./PlanBreakdownView";
import { StructureAdoptInline } from "./StructureAdoptInline";

type SaveState = "idle" | "saving" | "saved" | "failed";

const SAVE_DEBOUNCE_MS = 700;

export function BeatSheetView({
  projectId,
  gridId,
  gridTitle,
  structures,
  beats,
}: {
  projectId: string;
  gridId: string;
  gridTitle: string;
  structures: WeaveStructureView[];
  beats: WeaveBeatView[];
}) {
  const router = useRouter();
  const railId = useId();
  const titleId = useId();
  const rail = useContextRail();
  const [activeStructureId, setActiveStructureId] = useState(structures[0]?.id ?? "");
  const [compareStructureId, setCompareStructureId] = useState(structures[1]?.id ?? structures[0]?.id ?? "");
  const [compare, setCompare] = useState(false);
  const [narrowCompareFocus, setNarrowCompareFocus] = useState<"a" | "b">("a");
  const [selectedStageId, setSelectedStageId] = useState<string | null>(structures[0]?.stages[0]?.id ?? null);
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [addingStructure, setAddingStructure] = useState(false);
  const [addingCustom, setAddingCustom] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const creatingStages = useRef(new Set<string>());
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const localBodies = useRef(new Map<string, string>());

  const active = useMemo(
    () => structures.find((structure) => structure.id === activeStructureId) ?? structures[0] ?? null,
    [structures, activeStructureId],
  );
  const compareTarget = useMemo(
    () => structures.find((structure) => structure.id === compareStructureId) ?? structures[0] ?? null,
    [structures, compareStructureId],
  );
  const selectedStage = useMemo(() => {
    for (const structure of structures) {
      const found = structure.stages.find((stage) => stage.id === selectedStageId);
      if (found) return found;
    }
    return active?.stages[0] ?? null;
  }, [structures, selectedStageId, active]);

  const selectedIdea = useMemo(() => {
    if (!selectedStage) return null;
    if (selectedIdeaId) {
      return selectedStage.ideas.find((idea) => idea.beatId === selectedIdeaId) ?? selectedStage.ideas[0] ?? null;
    }
    return selectedStage.ideas[0] ?? null;
  }, [selectedStage, selectedIdeaId]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty && saveState !== "saving") return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, saveState]);

  useEffect(() => {
    return () => {
      for (const timer of saveTimers.current.values()) clearTimeout(timer);
      saveTimers.current.clear();
    };
  }, []);

  const refreshQuiet = useEffectEvent(() => {
    router.refresh();
  });

  const persistIdeaBody = useCallback(
    async (stageId: string, beatId: string | null, body: string, expectedRevision: number | null) => {
      setSaveState("saving");
      setIssues([]);
      if (!beatId) {
        if (creatingStages.current.has(stageId)) return;
        creatingStages.current.add(stageId);
        const result = await addIdeaToWeaveStageAction(projectId, stageId, {
          title: structures.flatMap((s) => s.stages).find((s) => s.id === stageId)?.title ?? "Story idea",
          body,
        });
        creatingStages.current.delete(stageId);
        if (!result.ok) {
          setSaveState("failed");
          setIssues(result.issues);
          setDirty(true);
          return;
        }
        localBodies.current.set(result.idea.beatId, body);
        setSelectedIdeaId(result.idea.beatId);
        setSaveState("saved");
        setDirty(false);
        refreshQuiet();
        return;
      }
      const result = await updateWeaveIdeaTextAction(projectId, beatId, {
        body,
        expectedRevision: expectedRevision ?? 1,
      });
      if (!result.ok) {
        setSaveState("failed");
        setIssues(result.issues);
        setDirty(true);
        return;
      }
      localBodies.current.set(beatId, body);
      setSaveState("saved");
      setDirty(false);
      refreshQuiet();
    },
    [projectId, structures, refreshQuiet],
  );

  const scheduleIdeaSave = useCallback(
    (stageId: string, beatId: string | null, body: string, expectedRevision: number | null) => {
      const key = beatId ?? `new:${stageId}`;
      localBodies.current.set(key, body);
      setDirty(true);
      const existing = saveTimers.current.get(key);
      if (existing) clearTimeout(existing);
      // Empty body on a brand-new field: do not create an idea until there is text.
      if (!beatId && !body.trim()) {
        setDirty(false);
        return;
      }
      saveTimers.current.set(
        key,
        setTimeout(() => {
          saveTimers.current.delete(key);
          void persistIdeaBody(stageId, beatId, body, expectedRevision);
        }, SAVE_DEBOUNCE_MS),
      );
    },
    [persistIdeaBody],
  );

  if (!structures.length) {
    return (
      <section className="panel weave-beat-sheet" aria-labelledby="beat-sheet-empty">
        <div className="weave-beat-sheet-heading-row">
          <h2 id="beat-sheet-empty">{WEAVE.beatSheetHeading}</h2>
          <HelpPopover label={WEAVE.beatSheetHelpStructures}>{WEAVE.beatSheetHelpProse}</HelpPopover>
          <div className="weave-beat-sheet-heading-actions">
            <DeleteWeavePlanButton
              projectId={projectId}
              gridId={gridId}
              title={gridTitle}
              redirectToLibrary
            />
          </div>
        </div>
        <p className="small muted">{WEAVE.beatSheetEmpty}</p>
        <div style={{ marginTop: "0.75rem" }}>
          <Button type="button" size="sm" onClick={() => setAddingStructure(true)}>
            {WEAVE.beatSheetAddStructure}
          </Button>
        </div>
        {addingStructure ? (
          <StructureAdoptInline
            projectId={projectId}
            gridId={gridId}
            onDone={(structureIds) => {
              setAddingStructure(false);
              const newest = structureIds[structureIds.length - 1];
              if (newest) {
                setActiveStructureId(newest);
                setSelectedStageId(null);
                setSelectedIdeaId(null);
                setCompare(false);
                setShowBreakdown(false);
              }
              router.refresh();
            }}
            onCancel={() => setAddingStructure(false)}
          />
        ) : null}
      </section>
    );
  }

  const openStage = (stageId: string) => {
    setSelectedStageId(stageId);
    setSelectedIdeaId(null);
    if (!rail.visible) rail.toggle();
  };

  const worksheet = (structure: WeaveStructureView, keyPrefix: string) => (
    <BeatSheetWorksheet
      key={`${keyPrefix}-${structure.id}`}
      structure={structure}
      selectedStageId={selectedStage?.id ?? null}
      selectedIdeaId={selectedIdea?.beatId ?? null}
      localBodies={localBodies.current}
      onSelectStage={openStage}
      onSelectIdea={(beatId) => setSelectedIdeaId(beatId)}
      onScheduleSave={scheduleIdeaSave}
      onUseExisting={(stageId) => {
        openStage(stageId);
        if (!rail.visible) rail.toggle();
      }}
      onAddIdea={(stageId) => {
        startTransition(async () => {
          setSaveState("saving");
          const stage = structure.stages.find((s) => s.id === stageId);
          const result = await addIdeaToWeaveStageAction(projectId, stageId, {
            title: stage?.title ?? "Story idea",
            body: "",
          });
          if (!result.ok) {
            setSaveState("failed");
            setIssues(result.issues);
            return;
          }
          setSelectedIdeaId(result.idea.beatId);
          setSaveState("saved");
          router.refresh();
        });
      }}
    />
  );

  return (
    <div className="write-layout reference-write-layout weave-beat-sheet-shell">
      <div className="write-main weave-beat-sheet">
        <div className="weave-beat-sheet-toolbar">
          <div className="weave-beat-sheet-heading-row">
            <h2 id={titleId}>{WEAVE.beatSheetHeading}</h2>
            <HelpPopover label={WEAVE.beatSheetHelpStructures}>
              {WEAVE.beatSheetHelpStructures} {WEAVE.beatSheetHelpShared} {WEAVE.beatSheetHelpProse}
            </HelpPopover>
            <div className="weave-beat-sheet-heading-actions">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowBreakdown((open) => !open)}
              >
                {showBreakdown ? WEAVE.beatSheetHeading : WEAVE.breakdownExport}
              </Button>
              <DeleteWeavePlanButton
                projectId={projectId}
                gridId={gridId}
                title={gridTitle}
                redirectToLibrary
              />
              <ContextRailToggle rail={rail} controls={railId} />
            </div>
          </div>
          {showBreakdown ? <PlanBreakdownView structures={structures} beats={beats} /> : null}
          <div className="weave-structure-tabs" role="tablist" aria-label="Adopted structures">
            <div className="weave-structure-tab-list">
              {structures.map((structure) => (
                <button
                  key={structure.id}
                  type="button"
                  role="tab"
                  aria-selected={!compare && structure.id === active?.id}
                  className={!compare && structure.id === active?.id ? "is-selected" : undefined}
                  onClick={() => {
                    setCompare(false);
                    setShowBreakdown(false);
                    setActiveStructureId(structure.id);
                    setSelectedStageId(structure.stages[0]?.id ?? null);
                  }}
                >
                  {structure.title}
                </button>
              ))}
              <Button type="button" size="sm" variant="ghost" onClick={() => setAddingStructure((open) => !open)}>
                {WEAVE.beatSheetAddStructure}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAddingCustom((open) => !open)}>
                {WEAVE.customStructureHeading}
              </Button>
            </div>
            {structures.length > 1 ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="weave-compare-action"
                onClick={() => {
                  setCompare((on) => !on);
                  if (!compare && active) {
                    const other = structures.find((s) => s.id !== active.id) ?? active;
                    setCompareStructureId(other.id);
                  }
                }}
              >
                {compare ? WEAVE.beatSheetExitCompare : WEAVE.beatSheetCompare}
              </Button>
            ) : null}
          </div>
          {addingStructure ? (
            <StructureAdoptInline
              projectId={projectId}
              gridId={gridId}
              onDone={(structureIds) => {
                setAddingStructure(false);
                const newest = structureIds[structureIds.length - 1];
                if (newest) {
                  setActiveStructureId(newest);
                  setSelectedStageId(null);
                  setSelectedIdeaId(null);
                  setCompare(false);
                  setShowBreakdown(false);
                }
                router.refresh();
              }}
              onCancel={() => setAddingStructure(false)}
            />
          ) : null}
          {addingCustom ? (
            <CustomStructureForm
              projectId={projectId}
              gridId={gridId}
              onDone={() => setAddingCustom(false)}
              onCancel={() => setAddingCustom(false)}
            />
          ) : null}
        </div>

        <IssueList issues={issues} />

        {showBreakdown ? null : compare && compareTarget && active ? (
          <div className="weave-compare">
            <p className="small muted">{WEAVE.beatSheetCompareHint}</p>
            <Select
              className="weave-compare-switcher"
              label={WEAVE.beatSheetSwitchFramework}
              value={narrowCompareFocus}
              onChange={(event) => setNarrowCompareFocus(event.target.value as "a" | "b")}
            >
              <option value="a">{active.title}</option>
              <option value="b">{compareTarget.title}</option>
            </Select>
            <div className="weave-compare-panes">
              <div className={narrowCompareFocus === "a" ? "weave-compare-pane is-focus" : "weave-compare-pane"}>
                <h3 className="weave-compare-pane-title">{active.title}</h3>
                {worksheet(active, "a")}
              </div>
              <div className={narrowCompareFocus === "b" ? "weave-compare-pane is-focus" : "weave-compare-pane"}>
                <h3 className="weave-compare-pane-title">{compareTarget.title}</h3>
                {worksheet(compareTarget, "b")}
              </div>
            </div>
          </div>
        ) : active ? (
          worksheet(active, "main")
        ) : null}

        <div className="weave-beat-sheet-footer">
          <p className="small muted">{WEAVE.beatSheetDisclaimer}</p>
          <p className="small weave-save-status" role="status" aria-live="polite">
            {saveState === "saving" || pending
              ? WEAVE.beatSheetSaving
              : saveState === "failed"
                ? WEAVE.beatSheetSaveFailed
                : saveState === "saved"
                  ? WEAVE.savedStatus
                  : null}
          </p>
        </div>
      </div>

      <ContextRail id={railId} labelledBy={titleId} rail={rail} className="weave-stage-rail" focusOnOverlayOpen>
        {selectedStage ? (
          <StageRail
            projectId={projectId}
            stage={selectedStage}
            structures={structures}
            beats={beats}
            selectedIdea={selectedIdea}
            onSelectIdea={setSelectedIdeaId}
            onClose={rail.close}
            onIssues={(next) => {
              setIssues(next);
              if (next.length) setSaveState("failed");
            }}
            onRefresh={() => router.refresh()}
          />
        ) : (
          <p className="small muted">Select a beat to see guidance, notes, and structure links.</p>
        )}
      </ContextRail>
    </div>
  );
}

function BeatSheetWorksheet({
  structure,
  selectedStageId,
  selectedIdeaId,
  localBodies,
  onSelectStage,
  onSelectIdea,
  onScheduleSave,
  onAddIdea,
  onUseExisting,
}: {
  structure: WeaveStructureView;
  selectedStageId: string | null;
  selectedIdeaId: string | null;
  localBodies: Map<string, string>;
  onSelectStage: (stageId: string) => void;
  onSelectIdea: (beatId: string) => void;
  onScheduleSave: (stageId: string, beatId: string | null, body: string, expectedRevision: number | null) => void;
  onAddIdea: (stageId: string) => void;
  onUseExisting: (stageId: string) => void;
}) {
  return (
    <div className="weave-beat-sheet-worksheet" role="table" aria-label={`${structure.title} beat sheet`}>
      <div className="weave-beat-sheet-head" role="row">
        <div role="columnheader">{WEAVE.beatSheetBeatColumn}</div>
        <div role="columnheader">{WEAVE.beatSheetStoryColumn}</div>
      </div>
      {structure.stages.map((stage, index) => {
        const prevGroup = index > 0 ? structure.stages[index - 1]?.groupTitle : null;
        const showGroup = Boolean(stage.groupTitle && stage.groupTitle !== prevGroup);
        const selected = stage.id === selectedStageId;
        return (
          <div key={stage.id}>
            {showGroup ? (
              <div className="weave-beat-sheet-group" role="row">
                <div role="cell">{stage.groupTitle}</div>
              </div>
            ) : null}
            <div
              className={selected ? "weave-beat-sheet-row is-selected" : "weave-beat-sheet-row"}
              role="row"
              tabIndex={0}
              onClick={() => onSelectStage(stage.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectStage(stage.id);
                }
              }}
            >
              <div className="weave-beat-sheet-beat" role="rowheader">
                <div className="weave-beat-sheet-beat-title">
                  <span className="weave-beat-num">{String(stage.position + 1).padStart(2, "0")}</span>
                  <strong>{stage.title}</strong>
                  <HelpPopover label={`Guidance: ${stage.title}`}>{stage.guidance}</HelpPopover>
                </div>
                <p className="small muted">{stage.guidance}</p>
              </div>
              <div className="weave-beat-sheet-story" role="cell">
                {stage.ideas.length === 0 ? (
                  <TextField
                    multiline
                    className="weave-beat-sheet-field"
                    label={`${WEAVE.beatSheetStoryColumn}: ${stage.title}`}
                    labelClassName="sr-only"
                    rows={4}
                    placeholder={WEAVE.beatSheetDescribe}
                    defaultValue={localBodies.get(`new:${stage.id}`) ?? ""}
                    onClick={(event) => event.stopPropagation()}
                    onFocus={() => onSelectStage(stage.id)}
                    onChange={(event) => onScheduleSave(stage.id, null, event.target.value, null)}
                    onBlur={(event) => {
                      const body = event.target.value;
                      if (!body.trim()) return;
                      onScheduleSave(stage.id, null, body, null);
                    }}
                  />
                ) : (
                  stage.ideas.map((idea) => (
                    <div key={idea.linkId} className="weave-beat-sheet-idea">
                      {idea.sharedStageCount > 1 ? (
                        <span className="small muted">{WEAVE.beatSheetShared(idea.sharedStageCount)}</span>
                      ) : null}
                      <TextField
                        multiline
                        className={
                          selected && idea.beatId === selectedIdeaId
                            ? "weave-beat-sheet-field is-focused"
                            : "weave-beat-sheet-field"
                        }
                        label={`${WEAVE.beatSheetStoryColumn}: ${stage.title}`}
                        labelClassName="sr-only"
                        rows={4}
                        placeholder={WEAVE.beatSheetDescribe}
                        defaultValue={localBodies.get(idea.beatId) ?? idea.body}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelectStage(stage.id);
                          onSelectIdea(idea.beatId);
                        }}
                        onFocus={() => {
                          onSelectStage(stage.id);
                          onSelectIdea(idea.beatId);
                        }}
                        onChange={(event) =>
                          onScheduleSave(stage.id, idea.beatId, event.target.value, idea.contentRevision)
                        }
                      />
                    </div>
                  ))
                )}
                <div className="weave-beat-sheet-row-actions">
                  {stage.ideas.length > 0 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={(event) => {
                        event.stopPropagation();
                        onAddIdea(stage.id);
                      }}
                    >
                      {WEAVE.beatSheetAddIdea}
                    </Button>
                  ) : null}
                  {selected ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={(event) => {
                        event.stopPropagation();
                        onUseExisting(stage.id);
                      }}
                    >
                      {WEAVE.beatSheetUseExisting}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StageRail({
  projectId,
  stage,
  structures,
  beats,
  selectedIdea,
  onSelectIdea,
  onClose,
  onIssues,
  onRefresh,
}: {
  projectId: string;
  stage: WeaveStructureStageView;
  structures: WeaveStructureView[];
  beats: WeaveBeatView[];
  selectedIdea: { beatId: string; title: string; sharedStageCount: number; contentRevision: number } | null;
  onSelectIdea: (beatId: string) => void;
  onClose: () => void;
  onIssues: (issues: Issue[]) => void;
  onRefresh: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const linkedIds = new Set(stage.ideas.map((idea) => idea.beatId));
  const availableIdeas = beats.filter((beat) => !linkedIds.has(beat.id));
  const otherStages = structures.flatMap((structure) =>
    structure.stages
      .filter((s) => s.id !== stage.id)
      .map((s) => ({ id: s.id, label: `${structure.title}: ${s.title}` })),
  );

  return (
    <div className="weave-stage-rail-body">
      <div className="weave-stage-rail-head">
        <h3 id="weave-stage-rail-title">{stage.title}</h3>
        <IconButton aria-label={WEAVE.beatSheetCloseRail} onClick={onClose}>
          ×
        </IconButton>
      </div>
      <p className="small muted">{stage.guidance}</p>
      <TextField
        key={`${stage.id}:${stage.contentRevision}`}
        multiline
        className="weave-stage-notes"
        label={WEAVE.beatSheetNotes}
        defaultValue={stage.notes}
        rows={4}
        placeholder={WEAVE.beatSheetNotesHint}
        onBlur={(event) => {
          if (event.target.value === stage.notes) return;
          startTransition(async () => {
            const result = await updateWeaveStageNotesAction(projectId, stage.id, {
              notes: event.target.value,
              expectedRevision: stage.contentRevision,
            });
            if (!result.ok) onIssues(result.issues);
            else onRefresh();
          });
        }}
      />

      <div className="weave-stage-rail-section">
        <h4>{WEAVE.beatSheetStructureLinks}</h4>
        <p className="small muted">{WEAVE.beatSheetLinkPrompt}</p>
        {selectedIdea ? (
          <p className="small">
            Selected idea: <strong>{selectedIdea.title}</strong>
            {selectedIdea.sharedStageCount > 1 ? ` · ${WEAVE.beatSheetShared(selectedIdea.sharedStageCount)}` : null}
          </p>
        ) : (
          <p className="small muted">Select an idea in the worksheet to link it.</p>
        )}
        <Select
          label={WEAVE.beatSheetLinkStage}
          disabled={!selectedIdea || pending || otherStages.length === 0}
          defaultValue=""
          onChange={(event) => {
            const targetStageId = event.target.value;
            if (!targetStageId || !selectedIdea) return;
            event.target.value = "";
            startTransition(async () => {
              const result = await addIdeaToWeaveStageAction(projectId, targetStageId, {
                existingBeatId: selectedIdea.beatId,
              });
              if (!result.ok) onIssues(result.issues);
              else onRefresh();
            });
          }}
        >
          <option value="">{WEAVE.beatSheetChooseStage}</option>
          {otherStages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
        <Select
          className="weave-stage-use-existing"
          label={WEAVE.beatSheetUseExisting}
          disabled={pending || availableIdeas.length === 0}
          defaultValue=""
          onChange={(event) => {
            const beatId = event.target.value;
            if (!beatId) return;
            event.target.value = "";
            startTransition(async () => {
              const result = await addIdeaToWeaveStageAction(projectId, stage.id, { existingBeatId: beatId });
              if (!result.ok) onIssues(result.issues);
              else {
                onSelectIdea(beatId);
                onRefresh();
              }
            });
          }}
        >
          <option value="">{WEAVE.beatSheetChooseExisting}</option>
          {availableIdeas.map((beat) => (
            <option key={beat.id} value={beat.id}>
              {beat.title}
            </option>
          ))}
        </Select>
        {selectedIdea ? (
          <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap", marginTop: "0.65rem" }}>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await unlinkIdeaFromWeaveStageAction(projectId, stage.id, selectedIdea.beatId);
                  if (!result.ok) onIssues(result.issues);
                  else onRefresh();
                })
              }
            >
              {WEAVE.beatSheetUnlink}
            </Button>
            {selectedIdea.sharedStageCount > 1 ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await forkIdeaOnWeaveStageAction(projectId, stage.id, selectedIdea.beatId);
                    if (!result.ok) onIssues(result.issues);
                    else {
                      onSelectIdea(result.idea.beatId);
                      onRefresh();
                    }
                  })
                }
              >
                {WEAVE.beatSheetMakeCopy}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
