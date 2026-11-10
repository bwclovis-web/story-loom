import { z } from "zod";
import {
  CHANGE_PACKAGE_FORMAT,
  CHANGE_PACKAGE_FORMAT_VERSION,
  type ChangePackageV1Input,
} from "@/changePackage/schema.v1";
import type { JsonObject, JsonValue } from "@/domain/json";
import { STANDALONE_REFERENCE_TYPES, type RecordType } from "@/domain/recordTypes";
import { AUTHORITY_STATUSES } from "@/domain/statuses";

/*
 * What the model returns when asked to prepare a change proposal.
 *
 * The change package JSON Schema (src/changePackage/jsonSchema.ts) cannot be
 * used for OpenAI Structured Outputs in strict mode: `fields` is an object with
 * arbitrary keys and values, and many properties are optional. Strict mode
 * needs every object closed (`additionalProperties: false`), every property
 * required (optional ones become nullable) and a plain object at the root.
 * So the model gets this narrower draft shape:
 *
 * - structured fields are `{ key, valueJson }` pairs, with the value written as JSON text;
 * - no package ID, workspace, project, scope, approval, protected overrides,
 *   expected revisions or new record IDs: trusted server code assigns those;
 * - only reference record types can be created.
 *
 * The server parses the draft with `proposalDraftSchema`, converts it with
 * `draftToPackage`, and validates the result again with the full package schema.
 */

export const PROPOSAL_SCHEMA_NAME = "wordly_change_proposal";

export const REFERENCE_RECORD_TYPES = STANDALONE_REFERENCE_TYPES as Exclude<
  RecordType,
  "manuscript_chapter" | "manuscript_scene" | "scene_note"
>[];

/** Statuses a new record may start with; "superseded" needs an existing record. */
const CREATE_STATUSES = AUTHORITY_STATUSES.filter((s) => s !== "superseded");

export const MAX_PROPOSAL_OPERATIONS = 100;

const nullableString = (description: string) => ({ type: ["string", "null"], description });

const fieldPair = {
  type: "object",
  additionalProperties: false,
  required: ["key", "valueJson"],
  properties: {
    key: { type: "string", description: "Structured field name, e.g. age." },
    valueJson: {
      type: "string",
      description: 'The field value written as JSON text, e.g. 34, "Mara Venn", ["Mara"], true or {"city": "Vell"}.',
    },
  },
};

const createOp = {
  type: "object",
  additionalProperties: false,
  required: ["op", "type", "title", "body", "fields", "authorityStatus", "note"],
  properties: {
    op: { type: "string", enum: ["create_record"] },
    type: { type: "string", enum: REFERENCE_RECORD_TYPES },
    title: { type: "string" },
    body: { type: "string" },
    fields: { type: "array", items: fieldPair },
    authorityStatus: { type: "string", enum: CREATE_STATUSES },
    note: nullableString("Why this record is proposed, or null."),
  },
};

const updateOp = {
  type: "object",
  additionalProperties: false,
  required: ["op", "recordId", "title", "body", "setFields", "unsetFields", "authorityStatus", "note"],
  properties: {
    op: { type: "string", enum: ["update_record"] },
    recordId: { type: "string", description: "The id of a record in the source material." },
    title: nullableString("The complete new title, or null to keep it."),
    body: nullableString("The complete new body text, or null to keep it."),
    setFields: { type: "array", items: fieldPair },
    unsetFields: { type: "array", items: { type: "string" } },
    authorityStatus: { anyOf: [{ type: "string", enum: AUTHORITY_STATUSES }, { type: "null" }] },
    note: nullableString("Why this change is proposed, or null."),
  },
};

const statusOp = {
  type: "object",
  additionalProperties: false,
  required: ["op", "recordId", "status", "supersededBy", "note"],
  properties: {
    op: { type: "string", enum: ["set_authority_status"] },
    recordId: { type: "string", description: "The id of a record in the source material." },
    status: { type: "string", enum: AUTHORITY_STATUSES },
    supersededBy: nullableString("For status superseded: the id of the replacing record from the source material, or null."),
    note: nullableString("Why this change is proposed, or null."),
  },
};

export const PROPOSAL_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "operations", "relatedRecords", "fieldTextDisagreements"],
  properties: {
    summary: { type: "string", description: "One or two sentences describing the proposed change set." },
    operations: { type: "array", items: { anyOf: [createOp, updateOp, statusOp] } },
    relatedRecords: {
      type: "array",
      description: "Records from the source material that may need review because of these changes. They are not changed.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["recordId", "note"],
        properties: { recordId: { type: "string" }, note: { type: "string" } },
      },
    },
    fieldTextDisagreements: {
      type: "array",
      description: "Places where a record's structured fields and its prose disagree.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["recordId", "field", "note"],
        properties: { recordId: { type: "string" }, field: { type: "string" }, note: { type: "string" } },
      },
    },
  },
};

/* ---------- parsing the model's draft ---------- */

const pair = z.object({ key: z.string(), valueJson: z.string() }).strict();

const draftOperation = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("create_record"),
      type: z.enum(REFERENCE_RECORD_TYPES as [string, ...string[]]),
      title: z.string(),
      body: z.string(),
      fields: z.array(pair),
      authorityStatus: z.enum(CREATE_STATUSES as [string, ...string[]]),
      note: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      op: z.literal("update_record"),
      recordId: z.string(),
      title: z.string().nullable(),
      body: z.string().nullable(),
      setFields: z.array(pair),
      unsetFields: z.array(z.string()),
      authorityStatus: z.enum(AUTHORITY_STATUSES).nullable(),
      note: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      op: z.literal("set_authority_status"),
      recordId: z.string(),
      status: z.enum(AUTHORITY_STATUSES),
      supersededBy: z.string().nullable(),
      note: z.string().nullable(),
    })
    .strict(),
]);

export const proposalDraftSchema = z
  .object({
    summary: z.string(),
    operations: z.array(draftOperation).max(MAX_PROPOSAL_OPERATIONS),
    relatedRecords: z.array(z.object({ recordId: z.string(), note: z.string() }).strict()),
    fieldTextDisagreements: z.array(z.object({ recordId: z.string(), field: z.string(), note: z.string() }).strict()),
  })
  .strict();

export type ProposalDraft = z.output<typeof proposalDraftSchema>;

export type DraftParseResult = { ok: true; draft: ProposalDraft } | { ok: false; problems: string[] };

/** Parses the model's text. Anything that is not exactly the draft shape is rejected, never repaired. */
export function parseProposalDraft(text: string): DraftParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, problems: ["The response was not valid JSON."] };
  }
  const parsed = proposalDraftSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.slice(0, 10).map((i) => `${i.path.length ? i.path.join(".") : "response"}: ${i.message}`),
    };
  }
  return { ok: true, draft: parsed.data };
}

/* ---------- converting a draft into a change package ---------- */

/** Values only trusted server code supplies. */
export interface TrustedPackageValues {
  packageId: string;
  workspaceId: string;
  projectId: string;
  conversationLabel: string;
  /** Revision of each record sent to the model; these become the expected revisions. */
  sentRevisions: ReadonlyMap<string, number>;
  /** Records sent only as some of their sections; the model never saw their whole text. */
  partialRecords?: ReadonlySet<string>;
  newRecordId: () => string;
}

export const PROPOSED_STATEMENT = "Prepared by the in-app assistant. Not approved: the author has not applied it.";

export type ConversionResult =
  | { ok: true; pkg: ChangePackageV1Input; disagreements: ProposalDraft["fieldTextDisagreements"] }
  | { ok: false; problems: string[] };

function fieldsFromPairs(pairs: { key: string; valueJson: string }[], where: string, problems: string[]): JsonObject {
  const out: JsonObject = {};
  for (const p of pairs) {
    const key = p.key.trim();
    if (!key) {
      problems.push(`${where}: a structured field has no name.`);
      continue;
    }
    if (key in out) {
      problems.push(`${where}: field "${key}" is set twice.`);
      continue;
    }
    try {
      out[key] = JSON.parse(p.valueJson) as JsonValue;
    } catch {
      problems.push(`${where}: the value for field "${key}" is not valid JSON.`);
    }
  }
  return out;
}

/**
 * Builds a v1 change package from the model's draft. The package is always
 * reference scope, marked "proposed", with no protected overrides, and may
 * only change records that were sent to the model, at the revision sent.
 */
export function draftToPackage(draft: ProposalDraft, trusted: TrustedPackageValues): ConversionResult {
  const problems: string[] = [];
  const sent = (id: string) => trusted.sentRevisions.get(id);
  const label = (i: number) => `Change ${i + 1}`;
  const requireSent = (id: string, where: string): number | null => {
    const revision = sent(id);
    if (revision === undefined) {
      problems.push(`${where} refers to record ${JSON.stringify(id)}, which was not among the records sent. Select it and prepare again.`);
      return null;
    }
    return revision;
  };

  const summary = draft.summary.trim();
  if (!summary) problems.push("The proposal has no summary.");

  const operations: ChangePackageV1Input["operations"] = [];
  draft.operations.forEach((op, i) => {
    const note = op.note?.trim() ? op.note.trim() : undefined;
    if (op.op === "create_record") {
      operations.push({
        op: "create_record",
        newRecordId: trusted.newRecordId(),
        type: op.type as RecordType,
        title: op.title,
        body: op.body,
        fields: fieldsFromPairs(op.fields, label(i), problems),
        authorityStatus: op.authorityStatus as (typeof CREATE_STATUSES)[number],
        ...(note ? { note } : {}),
      });
      return;
    }
    const expectedRevision = requireSent(op.recordId, label(i));
    if (expectedRevision === null) return;
    if (op.op === "update_record") {
      const set = fieldsFromPairs(op.setFields, label(i), problems);
      const unset = op.unsetFields.map((k) => k.trim()).filter(Boolean);
      const changes: Extract<ChangePackageV1Input["operations"][number], { op: "update_record" }>["changes"] = {};
      if (op.title !== null) changes.title = { replace: op.title };
      if (op.body !== null && trusted.partialRecords?.has(op.recordId)) {
        problems.push(
          `${label(i)} would replace the whole text of record ${JSON.stringify(op.recordId)}, but only some of its sections were sent. Send the whole document to change its text.`,
        );
        return;
      }
      if (op.body !== null) changes.body = { replace: op.body };
      if (Object.keys(set).length || unset.length) {
        changes.fields = { ...(Object.keys(set).length ? { set } : {}), ...(unset.length ? { unset } : {}) };
      }
      operations.push({
        op: "update_record",
        recordId: op.recordId,
        expectedRevision,
        changes,
        ...(op.authorityStatus ? { authorityStatus: op.authorityStatus } : {}),
        ...(note ? { note } : {}),
      });
      return;
    }
    if (op.supersededBy !== null) requireSent(op.supersededBy, `${label(i)} (superseded by)`);
    operations.push({
      op: "set_authority_status",
      recordId: op.recordId,
      expectedRevision,
      status: op.status,
      ...(op.supersededBy !== null ? { supersededBy: op.supersededBy } : {}),
      ...(note ? { note } : {}),
    });
  });

  const relatedRecords = draft.relatedRecords.flatMap((r, i) => {
    if (requireSent(r.recordId, `Related record ${i + 1}`) === null) return [];
    const note = r.note.trim();
    if (!note) {
      problems.push(`Related record ${i + 1} has no note.`);
      return [];
    }
    return [{ recordId: r.recordId, note }];
  });
  draft.fieldTextDisagreements.forEach((d, i) => requireSent(d.recordId, `Field/text disagreement ${i + 1}`));

  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    disagreements: draft.fieldTextDisagreements,
    pkg: {
      format: CHANGE_PACKAGE_FORMAT,
      formatVersion: CHANGE_PACKAGE_FORMAT_VERSION,
      packageId: trusted.packageId,
      workspaceId: trusted.workspaceId,
      projectId: trusted.projectId,
      summary,
      source: { conversationLabel: trusted.conversationLabel },
      approval: { status: "proposed", statement: PROPOSED_STATEMENT },
      scope: "reference",
      protectedOverrides: [],
      operations,
      relatedRecords,
    },
  };
}
