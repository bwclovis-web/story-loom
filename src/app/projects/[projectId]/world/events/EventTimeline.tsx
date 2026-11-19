"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition, type KeyboardEvent } from "react";
import { IssueList } from "@/components/IssueList";
import { ContextRail, ContextRailToggle, useContextRail } from "@/components/shell/ContextRail";
import { CloseIcon } from "@/components/shell/icons";
import { IconButton } from "@/components/ui/IconButton";
import { Button, ButtonLink } from "@/components/ui/Button";
import type { Issue } from "@/domain/issues";
import type { StoryEventDetail, StoryMapChoice, StoryTimeline } from "@/server/services/storyEventService";
import { WORLD, WRITE } from "@/ui/labels";
import { mapListHandlesKey } from "@/world/mapKeyboard";
import {
  addStoryEventEvidenceAction,
  createStoryEventAction,
  linkStoryEventLocationAction,
  linkStoryEventSceneAction,
  orderStoryEventsAction,
  removeStoryEventEvidenceAction,
  removeStoryEventOrderAction,
  unlinkStoryEventLocationAction,
  unlinkStoryEventSceneAction,
  updateStoryEventAction,
} from "./actions";

export function EventTimeline({ projectId, timeline }: { projectId: string; timeline: StoryTimeline }) {
  const router = useRouter();
  const rail = useContextRail();
  const listId = useId();
  const railId = useId();
  const titleId = useId();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();
  const selected = timeline.selected;
  const base = `/projects/${encodeURIComponent(projectId)}/world/events`;

  const openEvent = (eventId: string) => {
    const draft = timeline.draft === "all" ? "" : `&draft=${encodeURIComponent(timeline.draft)}`;
    router.push(`${base}?event=${encodeURIComponent(eventId)}${draft}`);
    if (!rail.visible) rail.toggle();
  };

  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!mapListHandlesKey(event.target, event.currentTarget)) return;
    const index = timeline.events.findIndex((item) => item.id === selected?.id);
    const move = (next: number) => {
      const item = timeline.events[next];
      if (!item) return;
      event.preventDefault();
      openEvent(item.id);
    };
    if (event.key === "ArrowDown") move(Math.min(timeline.events.length - 1, index < 0 ? 0 : index + 1));
    if (event.key === "ArrowUp") move(Math.max(0, index < 0 ? 0 : index - 1));
    if (event.key === "Home") move(0);
    if (event.key === "End") move(timeline.events.length - 1);
    if (event.key === "Enter" && index >= 0) {
      event.preventDefault();
      openEvent(timeline.events[index]!.id);
    }
  };

  return (
    <div className="write-layout reference-write-layout board-layout">
      <div className="write-main board-main">
        <div className="doc-toolbar">
          <h2 className="board-title-display">{WORLD.storyTimeline}</h2>
          <div className="doc-toolbar-end">
            <ContextRailToggle rail={rail} controls={railId} />
          </div>
        </div>
        <p className="small muted">{WORLD.storyEventNote}</p>
        <IssueList issues={issues} />
        <label>
          {WORLD.sceneDraftFilter}
          <select
            value={timeline.draft}
            onChange={(event) => {
              const draft = event.target.value;
              const query = new URLSearchParams();
              if (draft !== "all") query.set("draft", draft);
              if (selected) query.set("event", selected.id);
              const text = query.toString();
              router.push(text ? `${base}?${text}` : base);
            }}
          >
            <option value="all">{WORLD.allDrafts}</option>
            <option value="unscoped">{WORLD.unscopedDraft}</option>
            {timeline.drafts.map((draft) => (
              <option key={draft.id} value={draft.id}>
                {draft.title}
              </option>
            ))}
          </select>
        </label>
        <CreateEvent
          pending={pending}
          drafts={timeline.drafts}
          onCreate={(input) =>
            startTransition(async () => {
              const result = await createStoryEventAction(projectId, input);
              if (!result.ok) {
                setIssues(result.issues);
                return;
              }
              setIssues([]);
              openEvent(result.id);
              router.refresh();
            })
          }
        />
        {timeline.events.length === 0 ? (
          <p className="muted">{WORLD.noStoryEvents}</p>
        ) : (
          <ul className="map-pin-list" role="listbox" aria-labelledby={listId} tabIndex={0} onKeyDown={onListKey}>
            <li className="sr-only" id={listId}>
              {WORLD.storyTimeline}
            </li>
            {timeline.events.map((event) => (
              <li key={event.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected?.id === event.id}
                  className={`map-pin-list-item${selected?.id === event.id ? " selected" : ""}`}
                  onClick={() => openEvent(event.id)}
                >
                  <span>{event.title}</span>
                  <span className="small muted">
                    {event.planned ? `${WORLD.plannedEvent} · ` : ""}
                    {event.timeLabel || WORLD.timeUnknown}
                    {` · ${event.draftLabel}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ContextRail id={railId} labelledBy={titleId} rail={rail}>
        <div className="context-head">
          <h2 id={titleId}>{WORLD.storyEventRail}</h2>
          {!rail.wide ? (
            <IconButton tip="none" aria-label={WRITE.hideContext} onClick={rail.close}>
              <CloseIcon />
            </IconButton>
          ) : null}
        </div>
        <div className="context-body">
          {!selected ? (
            <p className="muted">{WORLD.noStoryEvents}</p>
          ) : (
            <EventRail
              projectId={projectId}
              event={selected}
              timeline={timeline}
              pending={pending}
              onIssues={setIssues}
              onDone={() => {
                setIssues([]);
                router.refresh();
              }}
              startTransition={startTransition}
            />
          )}
        </div>
      </ContextRail>
    </div>
  );
}

function CreateEvent({
  drafts,
  pending,
  onCreate,
}: {
  drafts: StoryTimeline["drafts"];
  pending: boolean;
  onCreate: (input: { title: string; summary: string; timeLabel: string; planned: boolean; draftScope: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [timeLabel, setTimeLabel] = useState("");
  const [planned, setPlanned] = useState(false);
  const [draftScope, setDraftScope] = useState("all");
  return (
    <form
      className="stack panel"
      onSubmit={(event) => {
        event.preventDefault();
        onCreate({ title, summary, timeLabel, planned, draftScope });
        setTitle("");
        setSummary("");
        setTimeLabel("");
        setPlanned(false);
      }}
    >
      <h3>{WORLD.newEvent}</h3>
      <label>
        {WORLD.storyEventTitle}
        <input value={title} required maxLength={200} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        {WORLD.storyEventSummary}
        <textarea value={summary} maxLength={4000} rows={3} onChange={(event) => setSummary(event.target.value)} />
      </label>
      <label>
        {WORLD.storyEventTime}
        <input value={timeLabel} maxLength={200} placeholder={WORLD.timeUnknown} onChange={(event) => setTimeLabel(event.target.value)} />
      </label>
      <label className="scene-location-check">
        <input type="checkbox" checked={planned} onChange={(event) => setPlanned(event.target.checked)} />
        {WORLD.storyEventPlanned}
      </label>
      <DraftSelect drafts={drafts} value={draftScope} onChange={setDraftScope} />
      <Button type="submit" size="sm" disabled={pending}>
        {WORLD.newEvent}
      </Button>
    </form>
  );
}

function DraftSelect({ drafts, value, onChange }: { drafts: StoryTimeline["drafts"]; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      {WORLD.storyEventDraft}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">{WORLD.allDrafts}</option>
        <option value="unscoped">{WORLD.unscopedDraft}</option>
        {drafts.map((draft) => (
          <option key={draft.id} value={draft.id}>
            {draft.title}
          </option>
        ))}
      </select>
    </label>
  );
}

function EventRail({
  projectId,
  event,
  timeline,
  pending,
  onIssues,
  onDone,
  startTransition,
}: {
  projectId: string;
  event: StoryEventDetail;
  timeline: StoryTimeline;
  pending: boolean;
  onIssues: (issues: Issue[]) => void;
  onDone: () => void;
  startTransition: (callback: () => void) => void;
}) {
  const [title, setTitle] = useState(event.title);
  const [summary, setSummary] = useState(event.summary);
  const [timeLabel, setTimeLabel] = useState(event.timeLabel);
  const [planned, setPlanned] = useState(event.planned);
  const [draftScope, setDraftScope] = useState(event.draftScope);
  const [locationId, setLocationId] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [otherId, setOtherId] = useState("");
  const [direction, setDirection] = useState<"before" | "after">("before");
  const [sourceId, setSourceId] = useState("");
  const [passageStart, setPassageStart] = useState("0");
  const [passageEnd, setPassageEnd] = useState("");

  useEffect(() => {
    setTitle(event.title);
    setSummary(event.summary);
    setTimeLabel(event.timeLabel);
    setPlanned(event.planned);
    setDraftScope(event.draftScope);
  }, [event.id, event.revision, event.title, event.summary, event.timeLabel, event.planned, event.draftScope]);

  const run = (work: () => Promise<{ ok: true } | { ok: false; issues: Issue[] }>) => {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        onIssues(result.issues);
        return;
      }
      onDone();
    });
  };

  return (
    <div className="stack">
      <form
        className="stack"
        onSubmit={(submit) => {
          submit.preventDefault();
          run(() =>
            updateStoryEventAction(projectId, event.id, {
              title,
              summary,
              timeLabel,
              planned,
              draftScope,
              expectedRevision: event.revision,
            }),
          );
        }}
      >
        {planned ? <p className="small">{WORLD.plannedEvent}</p> : null}
        <p className="small muted">{timeLabel.trim() ? timeLabel : WORLD.timeUnknown}</p>
        <label>
          {WORLD.storyEventTitle}
          <input value={title} required maxLength={200} onChange={(input) => setTitle(input.target.value)} />
        </label>
        <label>
          {WORLD.storyEventSummary}
          <textarea value={summary} maxLength={4000} rows={4} onChange={(input) => setSummary(input.target.value)} />
        </label>
        <label>
          {WORLD.storyEventTime}
          <input value={timeLabel} maxLength={200} placeholder={WORLD.timeUnknown} onChange={(input) => setTimeLabel(input.target.value)} />
        </label>
        <label className="scene-location-check">
          <input type="checkbox" checked={planned} onChange={(input) => setPlanned(input.target.checked)} />
          {WORLD.storyEventPlanned}
        </label>
        <DraftSelect drafts={timeline.drafts} value={draftScope} onChange={setDraftScope} />
        <Button type="submit" size="sm" disabled={pending}>
          {WORLD.saveEvent}
        </Button>
      </form>

      <section className="stack">
        <h3>{WORLD.eventLocations}</h3>
        <ul className="context-list">
          {event.locations.map((location) => (
            <li key={location.id}>
              <span className="context-item-title">{location.title}</span>
              {location.unavailable ? <span className="small muted">{WORLD.pinUnavailable}</span> : null}
              <ShowOnMap maps={location.maps} projectId={projectId} />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => run(() => unlinkStoryEventLocationAction(projectId, event.id, location.id, event.revision))}
              >
                {WORLD.removeEventLocation}
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="stack"
          onSubmit={(submit) => {
            submit.preventDefault();
            if (!locationId) return;
            run(() => linkStoryEventLocationAction(projectId, event.id, locationId, event.revision));
          }}
        >
          <label>
            {WORLD.linkEventLocation}
            <select value={locationId} onChange={(input) => setLocationId(input.target.value)}>
              <option value="">{WORLD.choosePlace}</option>
              {timeline.locationChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.title}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm" variant="secondary" disabled={pending || !locationId}>
            {WORLD.linkEventLocation}
          </Button>
        </form>
      </section>

      <section className="stack">
        <h3>{WORLD.revealingScenes}</h3>
        <p className="small muted">{WORLD.revealingScenesNote}</p>
        <ul className="context-list">
          {event.scenes.map((scene) => (
            <li key={scene.id}>
              <span className="context-item-title">{scene.title}</span>
              {scene.unavailable ? (
                <span className="small muted">{WORLD.pinUnavailable}</span>
              ) : (
                <ButtonLink href={`/projects/${projectId}/records/${scene.recordId}`} variant="secondary" size="sm">
                  {scene.type === "manuscript_scene" ? WORLD.openSceneInWrite : WORLD.openChapterInWrite}
                  <span className="sr-only"> {scene.title}</span>
                </ButtonLink>
              )}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => run(() => unlinkStoryEventSceneAction(projectId, event.id, scene.id, event.revision))}
              >
                {WORLD.removeEventScene}
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="stack"
          onSubmit={(submit) => {
            submit.preventDefault();
            if (!sceneId) return;
            run(() => linkStoryEventSceneAction(projectId, event.id, sceneId, event.revision));
          }}
        >
          <label>
            {WORLD.linkEventScene}
            <select value={sceneId} onChange={(input) => setSceneId(input.target.value)}>
              <option value="">{WORLD.linkEventScene}</option>
              {timeline.sceneChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.title}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm" variant="secondary" disabled={pending || !sceneId}>
            {WORLD.linkEventScene}
          </Button>
        </form>
      </section>

      <section className="stack">
        <h3>{WORLD.eventOrder}</h3>
        <p className="small muted">{WORLD.eventOrderNote}</p>
        <ul className="context-list">
          {event.orders.map((order) => (
            <li key={order.id}>
              <span>
                {order.direction === "before" ? WORLD.eventIsBefore(order.otherTitle) : WORLD.eventIsAfter(order.otherTitle)}
              </span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => run(() => removeStoryEventOrderAction(projectId, event.id, order.id, event.revision))}
              >
                {WORLD.removeOrder}
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="stack"
          onSubmit={(submit) => {
            submit.preventDefault();
            if (!otherId) return;
            run(() =>
              orderStoryEventsAction(projectId, {
                eventId: event.id,
                otherEventId: otherId,
                direction,
                expectedRevision: event.revision,
              }),
            );
          }}
        >
          <label>
            {WORLD.eventOrder}
            <select value={direction} onChange={(input) => setDirection(input.target.value as "before" | "after")}>
              <option value="before">{WORLD.thisEventBefore}</option>
              <option value="after">{WORLD.thisEventAfter}</option>
            </select>
          </label>
          <label>
            <span className="sr-only">{WORLD.otherEvent}</span>
            <select value={otherId} onChange={(input) => setOtherId(input.target.value)}>
              <option value="">{WORLD.otherEvent}</option>
              {timeline.events
                .filter((item) => item.id !== event.id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
            </select>
          </label>
          <Button type="submit" size="sm" variant="secondary" disabled={pending || !otherId}>
            {WORLD.recordOrder}
          </Button>
        </form>
      </section>

      <section className="stack">
        <h3>{WORLD.eventEvidence}</h3>
        <ul className="context-list">
          {event.evidence.map((item) => (
            <li key={item.id}>
              <span className="context-item-title">{item.sourceTitle}</span>
              <span className="small muted">
                {item.evidenceKindLabel}
                {item.needsRecheck ? ` · ${WORLD.evidenceStale}` : ""}
              </span>
              <p className="small">{item.passageExcerpt}</p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => run(() => removeStoryEventEvidenceAction(projectId, event.id, item.id, event.revision))}
              >
                {WORLD.removePassage}
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="stack"
          onSubmit={(submit) => {
            submit.preventDefault();
            if (!sourceId) return;
            run(() =>
              addStoryEventEvidenceAction(projectId, event.id, {
                sourceRecordId: sourceId,
                passageStart: Number(passageStart),
                passageEnd: Number(passageEnd),
                expectedRevision: event.revision,
              }),
            );
          }}
        >
          <label>
            {WORLD.pinPassage}
            <select value={sourceId} onChange={(input) => setSourceId(input.target.value)}>
              <option value="">{WORLD.pinPassage}</option>
              {timeline.sourceChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {WORLD.passageStart}
            <input type="number" min={0} value={passageStart} onChange={(input) => setPassageStart(input.target.value)} />
          </label>
          <label>
            {WORLD.passageEnd}
            <input type="number" min={0} value={passageEnd} onChange={(input) => setPassageEnd(input.target.value)} />
          </label>
          <Button type="submit" size="sm" variant="secondary" disabled={pending || !sourceId}>
            {WORLD.pinPassage}
          </Button>
        </form>
      </section>
    </div>
  );
}

function ShowOnMap({ maps, projectId }: { maps: StoryMapChoice[]; projectId: string }) {
  const [mapId, setMapId] = useState(maps[0]?.mapId ?? "");
  useEffect(() => {
    setMapId(maps[0]?.mapId ?? "");
  }, [maps]);
  if (maps.length === 0) return <p className="small muted">{WORLD.noMarkerForPlace}</p>;
  const chosen = maps.find((map) => map.mapId === mapId) ?? maps[0]!;
  const href = `/projects/${projectId}/world/maps/${chosen.mapId}?pin=${encodeURIComponent(chosen.pinId)}`;
  return (
    <div className="stack">
      {maps.length > 1 ? (
        <label>
          {WORLD.chooseMap}
          <select value={chosen.mapId} onChange={(event) => setMapId(event.target.value)}>
            {maps.map((map) => (
              <option key={map.mapId} value={map.mapId}>
                {map.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <ButtonLink href={href} variant="secondary" size="sm">
        {WORLD.showOnMap}
      </ButtonLink>
    </div>
  );
}
