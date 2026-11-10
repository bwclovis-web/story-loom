import type { JsonObject, JsonValue } from "@/domain/json";

/*
 * Conservative checks for structured fields that disagree with a record's
 * prose after a proposed change. Findings become review notes; nothing is
 * rewritten. Only simple values (numbers, short strings) are compared.
 */

export interface FieldTextFinding {
  field: string;
  message: string;
}

interface Snapshot {
  body: string;
  fields: JsonObject;
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function numberWords(n: number): string[] {
  if (!Number.isInteger(n) || n < 0 || n > 99) return [];
  if (n < 20) return [ONES[n]];
  const tens = TENS[Math.floor(n / 10)];
  const ones = n % 10;
  return ones === 0 ? [tens] : [`${tens}-${ONES[ones]}`, `${tens} ${ONES[ones]}`];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Text forms in which a simple field value could appear in prose; empty when the value is not comparable. */
function textForms(value: JsonValue | undefined): string[] {
  if (typeof value === "number") return [String(value), ...numberWords(value)];
  if (typeof value === "string") {
    const v = value.trim();
    if (v.length < 2 || v.length > 80) return [];
    const asNumber = /^\d{1,2}$/.test(v) ? Number(v) : NaN;
    return Number.isNaN(asNumber) ? [v] : [v, ...numberWords(asNumber)];
  }
  return [];
}

function mentions(body: string, forms: string[]): string | null {
  for (const form of forms) {
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(form)}(?=$|[^\\p{L}\\p{N}])`, "iu").test(body)) return form;
  }
  return null;
}

const show = (value: JsonValue | undefined) => JSON.stringify(value);

export function findFieldTextDisagreements(before: Snapshot | null, after: Snapshot): FieldTextFinding[] {
  const findings: FieldTextFinding[] = [];
  for (const [field, afterValue] of Object.entries(after.fields)) {
    const newForms = textForms(afterValue);
    if (!newForms.length) continue;
    const beforeValue = before?.fields[field];
    const fieldChanged = before !== null && show(beforeValue) !== show(afterValue);

    if (fieldChanged) {
      const oldForms = textForms(beforeValue).filter((f) => !newForms.some((n) => n.toLowerCase() === f.toLowerCase()));
      const stale = mentions(after.body, oldForms);
      if (stale && !mentions(after.body, newForms)) {
        findings.push({
          field,
          message: `Field "${field}" becomes ${show(afterValue)}, but the text still says "${stale}" (the old value ${show(beforeValue)}).`,
        });
      }
      continue;
    }

    if (before !== null && before.body !== after.body && mentions(before.body, newForms) && !mentions(after.body, newForms)) {
      findings.push({
        field,
        message: `The text no longer mentions ${show(afterValue)}, the value of field "${field}". Check that the field still agrees with the text.`,
      });
    }
  }
  return findings;
}
