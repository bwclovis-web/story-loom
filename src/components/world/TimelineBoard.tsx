"use client";

import { useMemo, useState } from "react";
import type { TimelineBoard as TimelineBoardModel, TimelineLaneKind, TimelineWarning } from "@/world/timelineBoard";
import { unassignedLaneId } from "@/world/timelineBoard";
import { WORLD } from "@/ui/labels";

const KINDS: { id: TimelineLaneKind; label: string }[] = [
  { id: "character", label: WORLD.timelineLaneCharacters },
  { id: "faction", label: WORLD.timelineLaneFactions },
  { id: "location", label: WORLD.timelineLaneLocations },
];

export function TimelineBoard({
  board,
  selectedId,
  onSelect,
}: {
  board: TimelineBoardModel;
  selectedId: string | null;
  onSelect: (eventId: string) => void;
}) {
  const [kind, setKind] = useState<TimelineLaneKind>("character");
  const [laneId, setLaneId] = useState("all");
  const lanes = board.lanes.filter((lane) => lane.kind === kind);
  const visibleLanes = laneId === "all" ? lanes : lanes.filter((lane) => lane.id === laneId);
  const marks = useMemo(
    () => board.marks.filter((mark) => mark.laneKind === kind && (laneId === "all" || mark.laneId === laneId)),
    [board.marks, kind, laneId],
  );
  return (
    <section className="timeline-board" aria-label={WORLD.timelineBoard}>
      <div className="timeline-board-filters">
        <label>
          {WORLD.timelineLanes}
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as TimelineLaneKind);
              setLaneId("all");
            }}
          >
            {KINDS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">{WORLD.timelineAllLanes}</span>
          <select value={laneId} onChange={(event) => setLaneId(event.target.value)}>
            <option value="all">{WORLD.timelineAllLanes}</option>
            {lanes.map((lane) => (
              <option key={lane.id} value={lane.id}>
                {lane.title || WORLD.timelineUnassigned}
              </option>
            ))}
          </select>
        </label>
      </div>
      {board.warnings.length > 0 ? (
        <ul className="timeline-warnings">
          <li className="sr-only">{WORLD.timelineWarnings}</li>
          {board.warnings.map((warning) => (
            <li key={warningKey(warning)}>{warningText(warning)}</li>
          ))}
        </ul>
      ) : null}
      {visibleLanes.length === 0 ? (
        <p className="small muted">{WORLD.timelineUnassigned}</p>
      ) : (
        <div className="timeline-lanes">
          {visibleLanes.map((lane) => (
            <div key={lane.id} className="timeline-lane">
              <span className="timeline-lane-label">{lane.id === unassignedLaneId(kind) ? WORLD.timelineUnassigned : lane.title}</span>
              <div className="timeline-track">
                {marks
                  .filter((mark) => mark.laneId === lane.id)
                  .map((mark) => (
                    <button
                      key={`${mark.laneId}:${mark.eventId}`}
                      type="button"
                      className={`timeline-mark${selectedId === mark.eventId ? " selected" : ""}`}
                      style={{ left: `${mark.x * 100}%` }}
                      onClick={() => onSelect(mark.eventId)}
                    >
                      <span>{mark.title}</span>
                      {mark.axis === "order" && board.mode === "date" ? (
                        <span className="small muted">{WORLD.timelineUnknownTime}</span>
                      ) : null}
                      {mark.ageYears != null && mark.ageName ? (
                        <span className="small">{WORLD.timelineAge(mark.ageName, mark.ageYears)}</span>
                      ) : null}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function warningText(warning: TimelineWarning): string {
  if (warning.kind === "same_date") return WORLD.timelineSameDate(warning.character, warning.places.join(", "));
  if (warning.kind === "reveal_order") return WORLD.timelineRevealOrder(warning.laterTitle, warning.earlierTitle);
  return WORLD.timelineBeforeBirth(warning.character, warning.birthTitle);
}

function warningKey(warning: TimelineWarning): string {
  if (warning.kind === "same_date") return `date:${warning.character}:${warning.places.join("|")}`;
  if (warning.kind === "reveal_order") return `reveal:${warning.earlierTitle}:${warning.laterTitle}`;
  return `birth:${warning.character}:${warning.birthTitle}`;
}
