"use client";

import { useActionState, useMemo, useState } from "react";
import { IssueList } from "@/components/IssueList";
import { Button } from "@/components/ui/Atoms/Button";
import { Checkbox } from "@/components/ui/Atoms/Checkbox";
import { TextField } from "@/components/ui/TextField";
import { submitWithoutReset } from "@/components/submitWithoutReset";
import type { WorldCalendarView } from "@/server/services/worldCalendarService";
import { WORLD } from "@/ui/labels";
import {
  daysInAbsoluteYear,
  emptyCalendarDefs,
  formatStructuredDate,
  type CalendarDefs,
  type IntercalaryLeapMode,
} from "@/world/calendarDate";
import { saveWorldCalendarAction, type CalendarFormResult } from "./actions";

const MAX_MONTHS = 24;
const MAX_ERAS = 32;
const MAX_WEEKDAYS = 31;
const MAX_INTERCALARIES = 24;
const MAX_FESTIVALS = 32;

type MonthDraft = { key: string; name: string; days: string };
type EraDraft = { key: string; name: string; shortLabel: string; offset: string; countsDown: boolean };
type WeekdayDraft = { key: string; name: string };
type IntercalaryDraft = {
  key: string;
  name: string;
  days: string;
  afterMonthPosition: string;
  leapMode: string;
};
type FestivalDraft = {
  key: string;
  name: string;
  startMonth: string;
  startDay: string;
  endMonth: string;
  endDay: string;
};

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
    countsDown: era.countsDown,
  }));
}

function startingWeekdays(calendar: WorldCalendarView | null): WeekdayDraft[] {
  return (calendar?.weekdays ?? []).map((day) => ({ key: day.id, name: day.name }));
}

function startingIntercalaries(calendar: WorldCalendarView | null): IntercalaryDraft[] {
  return (calendar?.intercalaries ?? []).map((period) => ({
    key: period.id,
    name: period.name,
    days: String(period.days),
    afterMonthPosition: String(period.afterMonthPosition),
    leapMode: period.leapMode,
  }));
}

function startingFestivals(calendar: WorldCalendarView | null): FestivalDraft[] {
  return (calendar?.festivals ?? []).map((festival) => ({
    key: festival.id,
    name: festival.name,
    startMonth: String(festival.startMonthPosition),
    startDay: String(festival.startDay),
    endMonth: String(festival.endMonthPosition),
    endDay: String(festival.endDay),
  }));
}

export function WorldCalendarForm({ projectId, calendar }: { projectId: string; calendar: WorldCalendarView | null }) {
  const [state, save, pending] = useActionState<CalendarFormResult, FormData>(
    saveWorldCalendarAction.bind(null, projectId),
    { ok: true },
  );
  const [months, setMonths] = useState<MonthDraft[]>(() => startingMonths(calendar));
  const [eras, setEras] = useState<EraDraft[]>(() => startingEras(calendar));
  const [weekdays, setWeekdays] = useState<WeekdayDraft[]>(() => startingWeekdays(calendar));
  const [intercalaries, setIntercalaries] = useState<IntercalaryDraft[]>(() => startingIntercalaries(calendar));
  const [festivals, setFestivals] = useState<FestivalDraft[]>(() => startingFestivals(calendar));
  const [leapEvery, setLeapEvery] = useState(calendar?.leapEveryYears != null ? String(calendar.leapEveryYears) : "");
  const [leapSkip, setLeapSkip] = useState(calendar?.leapSkipYears != null ? String(calendar.leapSkipYears) : "");
  const [leapInclude, setLeapInclude] = useState(
    calendar?.leapIncludeYears != null ? String(calendar.leapIncludeYears) : "",
  );
  const [leapOffset, setLeapOffset] = useState(String(calendar?.leapOffset ?? 0));
  const [weekStartOffset, setWeekStartOffset] = useState(String(calendar?.weekStartOffset ?? 0));

  const summary = useMemo(() => {
    const previewMonths = months
      .map((month, index) => ({
        position: index + 1,
        name: month.name.trim() || `Month ${index + 1}`,
        daysInMonth: Math.max(1, Number(month.days) || 1),
      }))
      .filter((month) => month.name);
    if (!previewMonths.length) return null;
    const defs: CalendarDefs = {
      ...emptyCalendarDefs(),
      months: previewMonths,
      weekdays: weekdays
        .filter((day) => day.name.trim())
        .map((day, index) => ({ position: index + 1, name: day.name.trim() })),
      intercalaries: intercalaries
        .filter((period) => period.name.trim())
        .map((period, index) => ({
          position: index + 1,
          name: period.name.trim(),
          days: Math.max(1, Number(period.days) || 1),
          afterMonthPosition: Number(period.afterMonthPosition) || 0,
          leapMode: (
            period.leapMode === "leap_only" || period.leapMode === "non_leap_only" ? period.leapMode : "always"
          ) as IntercalaryLeapMode,
        })),
      leap: {
        everyYears: leapEvery.trim() ? Number(leapEvery) : null,
        skipYears: leapSkip.trim() ? Number(leapSkip) : null,
        includeYears: leapInclude.trim() ? Number(leapInclude) : null,
        offset: Number(leapOffset) || 0,
      },
      weekStartOffset: Number(weekStartOffset) || 0,
    };
    const standard = daysInAbsoluteYear(1, { ...defs, leap: { ...defs.leap, everyYears: null } });
    const leapYearDays = daysInAbsoluteYear(defs.leap.everyYears ? defs.leap.offset + defs.leap.everyYears : 1, defs);
    const sample = formatStructuredDate(
      { eraId: null, year: 1, monthPosition: previewMonths[0]!.position, intercalaryPosition: null, day: 1 },
      defs,
    );
    return {
      standard,
      leap: leapYearDays,
      weekLength: defs.weekdays.length,
      sample,
    };
  }, [months, weekdays, intercalaries, leapEvery, leapSkip, leapInclude, leapOffset, weekStartOffset, projectId]);

  const namedMonths = months
    .map((month, index) => ({ position: index + 1, name: month.name.trim() || `Month ${index + 1}` }))
    .filter((month) => month.name);

  return (
    <form onSubmit={submitWithoutReset(save)} className="stack panel">
      <input type="hidden" name="expectedRevision" value={calendar?.revision ?? 0} />
      <input type="hidden" name="monthCount" value={months.length} />
      <input type="hidden" name="eraCount" value={eras.length} />
      <input type="hidden" name="weekdayCount" value={weekdays.length} />
      <input type="hidden" name="intercalaryCount" value={intercalaries.length} />
      <input type="hidden" name="festivalCount" value={festivals.length} />
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
          <Button
            variant="secondary"
            size="sm"
            disabled={pending || months.length >= MAX_MONTHS}
            onClick={() =>
              setMonths((rows) =>
                rows.length >= MAX_MONTHS
                  ? rows
                  : [...rows, { key: `month-${crypto.randomUUID()}`, name: "", days: "30" }],
              )
            }
          >
            {WORLD.worldCalendarAddMonth}
          </Button>
        </div>
      </section>

      <section className="stack">
        <h3 style={{ marginBottom: 0 }}>{WORLD.worldCalendarWeekdays}</h3>
        <p className="small muted">{WORLD.worldCalendarWeekdaysHint}</p>
        {weekdays.map((day, index) => (
          <div key={day.key} className="row calendar-fields">
            <TextField
              name={`weekdayName${index}`}
              label={WORLD.worldCalendarWeekdayName}
              defaultValue={day.name}
              maxLength={80}
              onChange={(event) => {
                const value = event.target.value;
                setWeekdays((rows) => rows.map((row) => (row.key === day.key ? { ...row, name: value } : row)));
              }}
            />
            <Button
              className="calendar-remove"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => setWeekdays((rows) => rows.filter((row) => row.key !== day.key))}
            >
              {WORLD.worldCalendarRemoveWeekday}
            </Button>
          </div>
        ))}
        {weekdays.some((day) => day.name.trim()) ? (
          <label>
            {WORLD.worldCalendarWeekStart}
            <select name="weekStartOffset" value={weekStartOffset} onChange={(event) => setWeekStartOffset(event.target.value)}>
              {weekdays
                .filter((day) => day.name.trim())
                .map((day, index) => (
                  <option key={day.key} value={String(index)}>
                    {day.name.trim()}
                  </option>
                ))}
            </select>
          </label>
        ) : (
          <input type="hidden" name="weekStartOffset" value="0" />
        )}
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending || weekdays.length >= MAX_WEEKDAYS}
            onClick={() =>
              setWeekdays((rows) =>
                rows.length >= MAX_WEEKDAYS ? rows : [...rows, { key: `weekday-${crypto.randomUUID()}`, name: "" }],
              )
            }
          >
            {WORLD.worldCalendarAddWeekday}
          </Button>
        </div>
      </section>

      <section className="stack">
        <h3 style={{ marginBottom: 0 }}>{WORLD.worldCalendarLeap}</h3>
        <p className="small muted">{WORLD.worldCalendarLeapHint}</p>
        <div className="row calendar-fields">
          <TextField
            className="calendar-days"
            name="leapEveryYears"
            label={WORLD.worldCalendarLeapEvery}
            type="number"
            min={1}
            max={10000}
            value={leapEvery}
            onChange={(event) => setLeapEvery(event.target.value)}
          />
          <TextField
            className="calendar-days"
            name="leapSkipYears"
            label={WORLD.worldCalendarLeapSkip}
            type="number"
            min={1}
            max={10000}
            value={leapSkip}
            onChange={(event) => setLeapSkip(event.target.value)}
          />
          <TextField
            className="calendar-days"
            name="leapIncludeYears"
            label={WORLD.worldCalendarLeapInclude}
            type="number"
            min={1}
            max={10000}
            value={leapInclude}
            onChange={(event) => setLeapInclude(event.target.value)}
          />
          <TextField
            className="calendar-days"
            name="leapOffset"
            label={WORLD.worldCalendarLeapOffset}
            type="number"
            value={leapOffset}
            onChange={(event) => setLeapOffset(event.target.value)}
          />
        </div>
      </section>

      <section className="stack">
        <h3 style={{ marginBottom: 0 }}>{WORLD.worldCalendarIntercalaries}</h3>
        <p className="small muted">{WORLD.worldCalendarIntercalariesHint}</p>
        {intercalaries.map((period, index) => (
          <div key={period.key} className="stack calendar-intercalary">
            <div className="row calendar-fields">
              <TextField
                name={`intercalaryName${index}`}
                label={WORLD.worldCalendarIntercalaryName}
                defaultValue={period.name}
                maxLength={80}
                onChange={(event) => {
                  const value = event.target.value;
                  setIntercalaries((rows) =>
                    rows.map((row) => (row.key === period.key ? { ...row, name: value } : row)),
                  );
                }}
              />
              <TextField
                className="calendar-days"
                name={`intercalaryDays${index}`}
                label={WORLD.worldCalendarIntercalaryDays}
                type="number"
                min={1}
                max={30}
                defaultValue={period.days}
              />
              <label>
                {WORLD.worldCalendarIntercalaryAfter}
                <select
                  name={`intercalaryAfter${index}`}
                  defaultValue={period.afterMonthPosition}
                  onChange={(event) => {
                    const value = event.target.value;
                    setIntercalaries((rows) =>
                      rows.map((row) => (row.key === period.key ? { ...row, afterMonthPosition: value } : row)),
                    );
                  }}
                >
                  <option value="0">{WORLD.worldCalendarIntercalaryBeforeFirst}</option>
                  {namedMonths.map((month) => (
                    <option key={month.position} value={String(month.position)}>
                      {WORLD.worldCalendarIntercalaryAfterMonth(month.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {WORLD.worldCalendarIntercalaryLeapMode}
                <select
                  name={`intercalaryLeapMode${index}`}
                  defaultValue={period.leapMode}
                  onChange={(event) => {
                    const value = event.target.value;
                    setIntercalaries((rows) =>
                      rows.map((row) => (row.key === period.key ? { ...row, leapMode: value } : row)),
                    );
                  }}
                >
                  <option value="always">{WORLD.worldCalendarIntercalaryAlways}</option>
                  <option value="leap_only">{WORLD.worldCalendarIntercalaryLeapOnly}</option>
                  <option value="non_leap_only">{WORLD.worldCalendarIntercalaryNonLeapOnly}</option>
                </select>
              </label>
              <Button
                className="calendar-remove"
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() => setIntercalaries((rows) => rows.filter((row) => row.key !== period.key))}
              >
                {WORLD.worldCalendarRemoveIntercalary}
              </Button>
            </div>
          </div>
        ))}
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending || intercalaries.length >= MAX_INTERCALARIES}
            onClick={() =>
              setIntercalaries((rows) =>
                rows.length >= MAX_INTERCALARIES
                  ? rows
                  : [
                      ...rows,
                      {
                        key: `intercalary-${crypto.randomUUID()}`,
                        name: "",
                        days: "1",
                        afterMonthPosition: namedMonths.length ? String(namedMonths[namedMonths.length - 1]!.position) : "0",
                        leapMode: "always",
                      },
                    ],
              )
            }
          >
            {WORLD.worldCalendarAddIntercalary}
          </Button>
        </div>
      </section>

      <section className="stack">
        <h3 style={{ marginBottom: 0 }}>{WORLD.worldCalendarFestivals}</h3>
        <p className="small muted">{WORLD.worldCalendarFestivalsHint}</p>
        {festivals.map((festival, index) => (
          <div key={festival.key} className="row calendar-fields">
            <TextField
              name={`festivalName${index}`}
              label={WORLD.worldCalendarFestivalName}
              defaultValue={festival.name}
              maxLength={80}
            />
            <label>
              {WORLD.worldCalendarFestivalStartMonth}
              <select name={`festivalStartMonth${index}`} defaultValue={festival.startMonth}>
                {namedMonths.map((month) => (
                  <option key={month.position} value={String(month.position)}>
                    {month.name}
                  </option>
                ))}
              </select>
            </label>
            <TextField
              className="calendar-days"
              name={`festivalStartDay${index}`}
              label={WORLD.worldCalendarFestivalStartDay}
              type="number"
              min={1}
              max={100}
              defaultValue={festival.startDay}
            />
            <label>
              {WORLD.worldCalendarFestivalEndMonth}
              <select name={`festivalEndMonth${index}`} defaultValue={festival.endMonth}>
                {namedMonths.map((month) => (
                  <option key={month.position} value={String(month.position)}>
                    {month.name}
                  </option>
                ))}
              </select>
            </label>
            <TextField
              className="calendar-days"
              name={`festivalEndDay${index}`}
              label={WORLD.worldCalendarFestivalEndDay}
              type="number"
              min={1}
              max={100}
              defaultValue={festival.endDay}
            />
            <Button
              className="calendar-remove"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => setFestivals((rows) => rows.filter((row) => row.key !== festival.key))}
            >
              {WORLD.worldCalendarRemoveFestival}
            </Button>
          </div>
        ))}
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending || festivals.length >= MAX_FESTIVALS || namedMonths.length === 0}
            onClick={() =>
              setFestivals((rows) =>
                rows.length >= MAX_FESTIVALS
                  ? rows
                  : [
                      ...rows,
                      {
                        key: `festival-${crypto.randomUUID()}`,
                        name: "",
                        startMonth: String(namedMonths[0]?.position ?? 1),
                        startDay: "1",
                        endMonth: String(namedMonths[0]?.position ?? 1),
                        endDay: "1",
                      },
                    ],
              )
            }
          >
            {WORLD.worldCalendarAddFestival}
          </Button>
        </div>
      </section>

      <section className="stack">
        <h3 style={{ marginBottom: 0 }}>{WORLD.worldCalendarEras}</h3>
        <p className="small muted">{WORLD.worldCalendarEraOffsetHint}</p>
        {eras.length ? null : <p className="small muted">{WORLD.structuredDateOptional}</p>}
        {eras.map((era, index) => (
          <div key={era.key} className="stack">
            <div className="row calendar-fields">
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
            <Checkbox
              name={`eraCountsDown${index}`}
              defaultChecked={era.countsDown}
              label={WORLD.worldCalendarEraCountsDown}
            />
          </div>
        ))}
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending || eras.length >= MAX_ERAS}
            onClick={() =>
              setEras((rows) =>
                rows.length >= MAX_ERAS
                  ? rows
                  : [
                      ...rows,
                      {
                        key: `era-${crypto.randomUUID()}`,
                        name: "",
                        shortLabel: "",
                        offset: "0",
                        countsDown: false,
                      },
                    ],
              )
            }
          >
            {WORLD.worldCalendarAddEra}
          </Button>
        </div>
      </section>

      {summary ? (
        <section className="stack">
          <h3 style={{ marginBottom: 0 }}>{WORLD.worldCalendarSummary}</h3>
          <p className="small muted">{WORLD.worldCalendarSummaryDays(summary.standard, summary.leap)}</p>
          <p className="small muted">{WORLD.worldCalendarSummaryWeek(summary.weekLength)}</p>
          {summary.sample ? <p className="small muted">{summary.sample}</p> : null}
        </section>
      ) : null}

      <IssueList issues={state.ok ? [] : state.issues} />
      <Button type="submit" disabled={pending}>
        {WORLD.worldCalendarSave}
      </Button>
    </form>
  );
}
