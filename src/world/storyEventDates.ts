import {
  compareStructuredDates,
  structuredDateFromRow,
  structuredDateIsComplete,
  type CalendarEraDef,
  type CalendarMonthDef,
  type StructuredDateParts,
} from "./calendarDate";

export interface DateConflictWarning {
  otherEventId: string;
  otherTitle: string;
  message: string;
}

export function dateConflictWarningsForEvent(
  eventId: string,
  parts: StructuredDateParts,
  orders: readonly { earlierEventId: string; laterEventId: string }[],
  peers: readonly {
    id: string;
    title: string;
    structEraId: string | null;
    structYear: number | null;
    structMonthPosition: number | null;
    structDay: number | null;
  }[],
  months: readonly CalendarMonthDef[],
  eras: readonly CalendarEraDef[],
): DateConflictWarning[] {
  if (!structuredDateIsComplete(parts, months, eras)) return [];
  const byId = new Map(
    peers.map((peer) => [
      peer.id,
      { title: peer.title, parts: structuredDateFromRow(peer) },
    ]),
  );
  const out: DateConflictWarning[] = [];
  for (const order of orders) {
    let otherId: string | null = null;
    let thisMustBeEarlier = false;
    if (order.earlierEventId === eventId) {
      otherId = order.laterEventId;
      thisMustBeEarlier = true;
    } else if (order.laterEventId === eventId) {
      otherId = order.earlierEventId;
      thisMustBeEarlier = false;
    } else continue;
    const other = byId.get(otherId);
    if (!other) continue;
    const cmp = compareStructuredDates(parts, other.parts, months, eras);
    if (cmp == null) continue;
    if (thisMustBeEarlier && cmp > 0) {
      out.push({
        otherEventId: otherId,
        otherTitle: other.title,
        message: `This event is set before "${other.title}", but its structured date is later.`,
      });
    } else if (!thisMustBeEarlier && cmp < 0) {
      out.push({
        otherEventId: otherId,
        otherTitle: other.title,
        message: `This event is set after "${other.title}", but its structured date is earlier.`,
      });
    }
  }
  return out;
}