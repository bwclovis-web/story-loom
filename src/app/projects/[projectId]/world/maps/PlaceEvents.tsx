"use client";

import { useEffect, useId, useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import type { PlaceEventItem } from "@/server/services/storyEventService";
import { WORLD } from "@/ui/labels";
import { listEventsAtLocationAction } from "../events/actions";

export function PlaceEvents({
  projectId,
  locationRecordId,
  compact = false,
}: {
  projectId: string;
  locationRecordId: string;
  compact?: boolean;
}) {
  const headingId = useId();
  const [events, setEvents] = useState<PlaceEventItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    void listEventsAtLocationAction(projectId, locationRecordId).then((result) => {
      if (cancelled) return;
      setEvents(result.ok ? result.events : []);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, locationRecordId]);

  return (
    <section className="stack" aria-labelledby={compact ? undefined : headingId}>
      {compact ? null : <h3 id={headingId}>{WORLD.eventsAtPlace}</h3>}
      {compact ? null : <p className="small muted">{WORLD.eventsAtPlaceNote}</p>}
      {events === null ? (
        <p className="small muted" role="status">
          {WORLD.inspectorLoading}
        </p>
      ) : events.length === 0 ? (
        <p className="small muted">{WORLD.noEventsAtPlace}</p>
      ) : (
        <ul className="context-list">
          {events.map((event) => (
            <li key={event.id}>
              <span className="context-item-title">{event.title}</span>
              <span className="small muted">
                {event.planned ? `${WORLD.plannedEvent} · ` : ""}
                {event.timeLabel || WORLD.timeUnknown}
              </span>
              <ButtonLink href={`/projects/${projectId}/world/events?event=${encodeURIComponent(event.id)}`} variant="secondary" size="sm">
                {WORLD.openEvent}
                <span className="sr-only"> {event.title}</span>
              </ButtonLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
