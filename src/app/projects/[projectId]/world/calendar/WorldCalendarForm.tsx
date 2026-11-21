"use client";

import { useActionState } from "react";
import { IssueList } from "@/components/IssueList";
import { Button } from "@/components/ui/Button";
import { submitWithoutReset } from "@/components/submitWithoutReset";
import type { WorldCalendarView } from "@/server/services/worldCalendarService";
import { WORLD } from "@/ui/labels";
import { saveWorldCalendarAction, type CalendarFormResult } from "./actions";

export function WorldCalendarForm({ projectId, calendar }: { projectId: string; calendar: WorldCalendarView | null }) {
  const [state, save, pending] = useActionState<CalendarFormResult, FormData>(
    saveWorldCalendarAction.bind(null, projectId),
    { ok: true },
  );
  const months = calendar?.months.length
    ? calendar.months
    : [
        { id: "", position: 1, name: "Frost", daysInMonth: 30 },
        { id: "", position: 2, name: "Bloom", daysInMonth: 30 },
      ];
  const eras = calendar?.eras ?? [];

  return (
    <form onSubmit={submitWithoutReset(save)} className="stack panel">
      <input type="hidden" name="expectedRevision" value={calendar?.revision ?? 0} />
      <input type="hidden" name="monthCount" value={months.length} />
      <input type="hidden" name="eraCount" value={eras.length} />
      <label>
        {WORLD.worldCalendarTitle}
        <input name="title" defaultValue={calendar?.title ?? ""} maxLength={120} />
      </label>
      <section className="stack">
        <h3 style={{ marginBottom: 0 }}>{WORLD.worldCalendarMonths}</h3>
        {months.map((month, index) => (
          <div key={month.position} className="row">
            <label>
              {WORLD.worldCalendarMonthName}
              <input name={`monthName${index}`} defaultValue={month.name} maxLength={80} required />
            </label>
            <label>
              {WORLD.worldCalendarDays}
              <input name={`monthDays${index}`} type="number" min={1} max={100} defaultValue={month.daysInMonth} required />
            </label>
          </div>
        ))}
      </section>
      <section className="stack">
        <h3 style={{ marginBottom: 0 }}>{WORLD.worldCalendarEras}</h3>
        <p className="small muted">{WORLD.worldCalendarEraOffsetHint}</p>
        {eras.length ? null : <p className="small muted">{WORLD.structuredDateOptional}</p>}
        {eras.map((era, index) => (
          <div key={era.position} className="row">
            <label>
              {WORLD.worldCalendarEraName}
              <input name={`eraName${index}`} defaultValue={era.name} maxLength={80} required />
            </label>
            <label>
              {WORLD.worldCalendarEraShort}
              <input name={`eraShort${index}`} defaultValue={era.shortLabel} maxLength={20} />
            </label>
            <label>
              {WORLD.worldCalendarEraOffset}
              <input name={`eraOffset${index}`} type="number" defaultValue={era.yearOffset} />
            </label>
          </div>
        ))}
      </section>
      <IssueList issues={state.ok ? [] : state.issues} />
      <Button type="submit" disabled={pending}>
        {WORLD.worldCalendarSave}
      </Button>
    </form>
  );
}