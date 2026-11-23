"use client";

import { useActionState, useState } from "react";
import { IssueList } from "@/components/IssueList";
import { Button } from "@/components/ui/Atoms/Button";
import { TextField } from "@/components/ui/TextField";
import { submitWithoutReset } from "@/components/submitWithoutReset";
import type { WorldCalendarView } from "@/server/services/worldCalendarService";
import { WORLD } from "@/ui/labels";
import { saveWorldCalendarAction, type CalendarFormResult } from "./actions";

const MAX_MONTHS = 24;
const MAX_ERAS = 32;

type MonthDraft = { key: string; name: string; days: string };
type EraDraft = { key: string; name: string; shortLabel: string; offset: string };

function startingMonths(calendar: WorldCalendarView | null): MonthDraft[] {
  const months = calendar?.months.length
    ? calendar.months
    : [
        { id: "starter-1", name: "Frost", daysInMonth: 30 },
        { id: "starter-2", name: "Bloom", daysInMonth: 30 },
      ];
  return months.map((month) => ({
    key: month.id,
    name: month.name,
    days: String(month.daysInMonth),
  }));
}

function startingEras(calendar: WorldCalendarView | null): EraDraft[] {
  return (calendar?.eras ?? []).map((era) => ({
    key: era.id,
    name: era.name,
    shortLabel: era.shortLabel,
    offset: String(era.yearOffset),
  }));
}

export function WorldCalendarForm({ projectId, calendar }: { projectId: string; calendar: WorldCalendarView | null }) {
  const [state, save, pending] = useActionState<CalendarFormResult, FormData>(
    saveWorldCalendarAction.bind(null, projectId),
    { ok: true },
  );
  const [months, setMonths] = useState<MonthDraft[]>(() => startingMonths(calendar));
  const [eras, setEras] = useState<EraDraft[]>(() => startingEras(calendar));

  const addMonth = () => {
    setMonths((rows) =>
      rows.length >= MAX_MONTHS ? rows : [...rows, { key: `month-${crypto.randomUUID()}`, name: "", days: "30" }],
    );
  };
  const addEra = () => {
    setEras((rows) =>
      rows.length >= MAX_ERAS
        ? rows
        : [...rows, { key: `era-${crypto.randomUUID()}`, name: "", shortLabel: "", offset: "0" }],
    );
  };

  return (
    <form onSubmit={submitWithoutReset(save)} className="stack panel">
      <input type="hidden" name="expectedRevision" value={calendar?.revision ?? 0} />
      <input type="hidden" name="monthCount" value={months.length} />
      <input type="hidden" name="eraCount" value={eras.length} />
      <TextField name="title" label={WORLD.worldCalendarTitle} defaultValue={calendar?.title ?? ""} maxLength={120} />
      <section className="stack">
        <h3 style={{ marginBottom: 0 }}>{WORLD.worldCalendarMonths}</h3>
        {months.map((month, index) => (
          <div key={month.key} className="row calendar-fields">
            <TextField
              name={`monthName${index}`}
              label={WORLD.worldCalendarMonthName}
              defaultValue={month.name}
              maxLength={80}
              required={month.name.length > 0}
            />
            <TextField
              className="calendar-days"
              name={`monthDays${index}`}
              label={WORLD.worldCalendarDays}
              type="number"
              min={1}
              max={100}
              defaultValue={month.days}
              required={month.name.length > 0}
            />
            <Button
              className="calendar-remove"
              variant="secondary"
              size="sm"
              disabled={months.length === 1 || pending}
              onClick={() => setMonths((rows) => rows.filter((row) => row.key !== month.key))}
            >
              {WORLD.worldCalendarRemoveMonth}
            </Button>
          </div>
        ))}
        <div>
          <Button variant="secondary" size="sm" disabled={pending || months.length >= MAX_MONTHS} onClick={addMonth}>
            {WORLD.worldCalendarAddMonth}
          </Button>
        </div>
      </section>
      <section className="stack">
        <h3 style={{ marginBottom: 0 }}>{WORLD.worldCalendarEras}</h3>
        <p className="small muted">{WORLD.worldCalendarEraOffsetHint}</p>
        {eras.length ? null : <p className="small muted">{WORLD.structuredDateOptional}</p>}
        {eras.map((era, index) => (
          <div key={era.key} className="row calendar-fields">
            <TextField
              name={`eraName${index}`}
              label={WORLD.worldCalendarEraName}
              defaultValue={era.name}
              maxLength={80}
              required={era.name.length > 0}
            />
            <TextField
              className="calendar-short"
              name={`eraShort${index}`}
              label={WORLD.worldCalendarEraShort}
              defaultValue={era.shortLabel}
              maxLength={20}
            />
            <TextField
              className="calendar-days"
              name={`eraOffset${index}`}
              label={WORLD.worldCalendarEraOffset}
              type="number"
              defaultValue={era.offset}
            />
            <Button
              className="calendar-remove"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => setEras((rows) => rows.filter((row) => row.key !== era.key))}
            >
              {WORLD.worldCalendarRemoveEra}
            </Button>
          </div>
        ))}
        <div>
          <Button variant="secondary" size="sm" disabled={pending || eras.length >= MAX_ERAS} onClick={addEra}>
            {WORLD.worldCalendarAddEra}
          </Button>
        </div>
      </section>
      <IssueList issues={state.ok ? [] : state.issues} />
      <Button type="submit" disabled={pending}>
        {WORLD.worldCalendarSave}
      </Button>
    </form>
  );
}
