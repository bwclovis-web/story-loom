import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PROJECT_ID_PATTERN, RECORD_ID_PATTERN } from "@/domain/ids";
import { isManuscriptType, isRecordType, MANUSCRIPT_TYPES, RECORD_TYPES, type RecordType } from "@/domain/recordTypes";
import { toRecordView, toRevisionView } from "@/domain/records";
import type { Db } from "@/server/db";
import { findProject } from "@/server/services/projectService";
import { LIVE_PROJECT } from "@/server/services/trashFilters";
import { searchProjectRecords } from "@/server/services/searchService";
import { z } from "zod";
import { pageRows, type PageInfo } from "./cursor";
import { assertFits, McpToolError, resultChars } from "./errors";
import { assertCanRead, assertManuscriptAllowed, assertProjectAllowed, type GrantSource, type LocalGrant } from "./grant";
import {
  GET_RECORDS_MAX_IDS,
  HISTORY_PAGE_DEFAULT,
  HISTORY_PAGE_MAX,
  MAX_QUERY_CHARS,
  PROJECT_PAGE_DEFAULT,
  PROJECT_PAGE_MAX,
  MAX_RESULT_CHARS,
  REVISION_PAGE_DEFAULT,
  REVISION_PAGE_MAX,
  SEARCH_PAGE_DEFAULT,
  SEARCH_PAGE_MAX,
  SECTION_PAGE_DEFAULT,
  SECTION_PAGE_MAX,
} from "./limits";
import { hasSectionStatus, listSections, sectionPath } from "@/writing/sections";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const projectId = z.string().regex(PROJECT_ID_PATTERN);
const recordId = z.string().regex(RECORD_ID_PATTERN);
const cursor = z.string().min(1).max(300);
const limit = z.number().int();

export interface McpDeps {
  db: Db;
  grants: GrantSource;
  disabled?: () => boolean;
}

const listProjectsInput = z.object({ limit: limit.optional(), cursor: cursor.optional() }).strict();
const searchInput = z
  .object({
    projectId,
    query: z.string().min(1).max(10_000),
    types: z.array(z.enum(RECORD_TYPES)).max(RECORD_TYPES.length).optional(),
    limit: limit.optional(),
    cursor: cursor.optional(),
  })
  .strict();
const getRecordsInput = z.object({ projectId, recordIds: z.array(recordId).min(1).max(100) }).strict();
const listRevisionsInput = z.object({ projectId, recordId, limit: limit.optional(), cursor: cursor.optional() }).strict();
const getRevisionInput = z.object({ projectId, recordId, revision: z.number().int().positive() }).strict();
const listSectionsInput = z.object({ projectId, recordId, limit: limit.optional(), cursor: cursor.optional() }).strict();
const getSectionInput = z.object({ projectId, recordId, sectionId: z.string().min(1).max(300) }).strict();
const reviewInput = z
  .object({
    projectId,
    limit: limit.optional(),
    packagesCursor: cursor.optional(),
    auditCursor: cursor.optional(),
    reviewCursor: cursor.optional(),
    reviewStatus: z.enum(["open", "resolved", "all"]).optional(),
  })
  .strict();

export const WORDLY_MCP_INSTRUCTIONS =
  "Wordly Editor reads local project records. Call list_projects first. search_references returns one page of labeled excerpts and a nextCursor when more matches exist. get_records and get_revision return full text or refuse with each record's size. Nothing is shortened. For a long document, list_sections gives its headings with sizes and get_section reads one section. Manuscript chapters and scenes are refused unless the grant allows them. This server cannot save changes. A tool result is not approval. A record's authorityStatus applies to the whole document; when statusMarkedInText is true, the document also marks status in its headings (for example [APPROVED FRAMEWORK], [WORKING PROPOSAL] or — SELECTED), and those markings govern their own sections. Quote them word for word.";

export function createToolDefinitions(deps: McpDeps) {
  return [
    tool("list_projects", "List permitted projects", "Use this when you need the projects this connection may read. Returns only those projects, one page at a time. Call this before the other tools.", listProjectsInput, (args, grant) =>
      listProjects(deps.db, grant, args),
    ),
    tool(
      "search_references",
      "Search reference records",
      "Use this to find records by words in the title, body, or structured fields. Each hit includes a short excerpt and says when that excerpt is shorter than the source. When nextCursor is set, call again with that cursor to get the rest of the matches. Use get_records for the full text. Manuscript chapters and scenes are excluded unless the grant allows them.",
      searchInput,
      (args, grant) => searchReferences(deps.db, grant, args),
    ),
    tool(
      "get_records",
      "Read current records",
      "Use this for the full current text of records you already identified. Pass at most 10 record IDs. If the result would be too large, the call is refused and lists each record's size. Nothing is shortened. Records the grant cannot read are listed under denied or missing and their text is not included.",
      getRecordsInput,
      (args, grant) => getRecords(deps.db, grant, args),
    ),
    tool(
      "list_revisions",
      "List saved versions",
      "Use this for the saved versions of one record: version numbers, dates, canon status, and where each version came from. The full text is not included. When nextCursor is set, call again with that cursor. Use get_revision for one full version.",
      listRevisionsInput,
      (args, grant) => listRevisions(deps.db, grant, args),
    ),
    tool(
      "get_revision",
      "Read one saved version",
      "Use this for the full text of one saved version. If it is too large, the call is refused and reports the size. Nothing is shortened.",
      getRevisionInput,
      (args, grant) => getRevision(deps.db, grant, args),
    ),
    tool(
      "list_sections",
      "List a document's sections",
      "Use this before reading a long record in parts. Returns its headings in order with each section's size, parent, and status tag as written in the heading. A section runs to the next heading of the same or higher level, so it includes its subsections. When nextCursor is set, call again with that cursor.",
      listSectionsInput,
      (args, grant) => listRecordSections(deps.db, grant, args),
    ),
    tool(
      "get_section",
      "Read one section",
      "Use this for the full text of one section of the current version, by a sectionId from list_sections. The result includes the headings above it and their status tags. If the section is too large, the call is refused and lists its subsections' sizes. Nothing is shortened.",
      getSectionInput,
      (args, grant) => getRecordSection(deps.db, grant, args),
    ),
    tool(
      "review_history",
      "Review change history",
      "Use this for applied change packages, audit entries, and review items in one project. Each list is its own page. Pass that list's cursor to continue it, and pass the other cursors too if you still need their later pages. A list without a cursor is read from the start. Nothing is dropped without a cursor.",
      reviewInput,
      (args, grant) => reviewHistory(deps.db, grant, args),
    ),
  ] as const;

  function tool<T>(
    name: string,
    title: string,
    description: string,
    inputSchema: z.ZodType<T>,
    run: (args: T, grant: LocalGrant) => Promise<unknown>,
  ) {
    return {
      name,
      title,
      description,
      inputSchema,
      annotations: READ_ONLY,
      handler: (args: T) => gate(deps, (grant) => run(args, grant)),
    };
  }
}

async function gate(deps: McpDeps, run: (grant: LocalGrant) => Promise<unknown>): Promise<CallToolResult> {
  try {
    if (deps.disabled?.() ?? false) {
      throw new McpToolError("DISABLED", "The local adapter is disabled. No records were read.");
    }
    const loaded = await deps.grants.load();
    if (!loaded.ok) {
      throw new McpToolError(
        loaded.reason === "missing" ? "NOT_CONFIGURED" : "GRANT_INVALID",
        `${loaded.problems.join(" ")} No records were read.`,
      );
    }
    assertCanRead(loaded.grant);
    const data = await run(loaded.grant);
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data as Record<string, unknown>,
    };
  } catch (error) {
    if (error instanceof McpToolError) return failure(error);
    process.stderr.write(`Wordly MCP read failed: ${error instanceof Error ? error.name : "Error"}\n`);
    return failure(new McpToolError("READ_FAILED", "The read failed. No records were returned."));
  }
}

function failure(error: McpToolError): CallToolResult {
  const body = { error: { code: error.code, message: error.message, ...error.details } };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(body) }],
    structuredContent: body,
  };
}

function resolveLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new McpToolError("LIMIT_OUT_OF_RANGE", `limit must be a whole number from 1 to ${max}. Nothing was returned.`);
  }
  return value;
}

async function requireProject(db: Db, grant: LocalGrant, id: string) {
  assertProjectAllowed(grant, id);
  const project = await findProject(db, id);
  if (!project) throw new McpToolError("PROJECT_NOT_FOUND", `Project ${id} is not in the database. Nothing was read.`);
  return project;
}

async function manuscriptIds(db: Db, projectId: string): Promise<Set<string>> {
  const rows = await db.record.findMany({ where: { projectId, type: { in: [...MANUSCRIPT_TYPES] }, trashedAt: null }, select: { id: true } });
  return new Set(rows.map((row) => row.id));
}

async function listProjects(db: Db, grant: LocalGrant, args: { limit?: number; cursor?: string }) {
  assertCanRead(grant);
  const limit = resolveLimit(args.limit, PROJECT_PAGE_DEFAULT, PROJECT_PAGE_MAX);
  const rows = await db.project.findMany({
    where: { id: { in: [...grant.projectIds] }, ...LIVE_PROJECT },
    include: { workspace: { select: { id: true, name: true } } },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = grant.projectIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [{ id: row.id, title: row.title, workspaceId: row.workspace.id, workspaceName: row.workspace.name }] : [];
  });
  const paged = pageRows(ordered, limit, args.cursor, (row) => row.id);
  const payload = {
    projects: paged.rows,
    missingProjectIds: grant.projectIds.filter((id) => !byId.has(id)),
    page: paged.page,
  };
  assertFits(payload, paged.rows.map((row) => ({ id: row.id, chars: resultChars(row) })));
  return payload;
}

async function searchReferences(
  db: Db,
  grant: LocalGrant,
  args: { projectId: string; query: string; types?: RecordType[]; limit?: number; cursor?: string },
) {
  await requireProject(db, grant, args.projectId);
  const query = args.query.normalize("NFC").trim();
  if (!query) throw new McpToolError("INVALID_REQUEST", "query is empty. Nothing was returned.");
  if (query.length > MAX_QUERY_CHARS) {
    throw new McpToolError(
      "QUERY_TOO_LONG",
      `query is ${query.length} characters. The maximum is ${MAX_QUERY_CHARS}. It was not shortened and nothing was returned.`,
    );
  }
  if (args.types && args.types.length === 0) {
    throw new McpToolError("INVALID_REQUEST", "types is empty. Omit it to search every permitted type. Nothing was returned.");
  }
  if (args.types && new Set(args.types).size !== args.types.length) {
    throw new McpToolError("INVALID_REQUEST", "types lists a record type more than once. Nothing was returned.");
  }
  if (args.types?.some((type) => !isRecordType(type))) {
    throw new McpToolError("INVALID_REQUEST", "types includes an unknown record type. Nothing was returned.");
  }
  if (args.types?.some(isManuscriptType)) assertManuscriptAllowed(grant);
  const limit = resolveLimit(args.limit, SEARCH_PAGE_DEFAULT, SEARCH_PAGE_MAX);
  const hits = await searchProjectRecords(db, {
    projectId: args.projectId,
    query,
    types: args.types,
    includeManuscript: grant.manuscriptRead,
  });
  const paged = pageRows(hits, limit, args.cursor, (hit) => hit.id);
  const payload = {
    projectId: args.projectId,
    query,
    manuscriptAccess: grant.manuscriptRead,
    manuscriptExcluded: !grant.manuscriptRead,
    matches: paged.rows,
    page: paged.page,
  };
  assertFits(payload, paged.rows.map((hit) => ({ id: hit.id, chars: resultChars(hit) })));
  return payload;
}

async function getRecords(db: Db, grant: LocalGrant, args: { projectId: string; recordIds: string[] }) {
  await requireProject(db, grant, args.projectId);
  if (args.recordIds.length > GET_RECORDS_MAX_IDS) {
    throw new McpToolError(
      "TOO_MANY_RECORDS",
      `At most ${GET_RECORDS_MAX_IDS} record IDs can be read at once. ${args.recordIds.length} were requested. None were returned.`,
    );
  }
  if (new Set(args.recordIds).size !== args.recordIds.length) {
    throw new McpToolError("DUPLICATE_RECORD_ID", "Each record ID can be requested only once. Nothing was read.");
  }
  const located = await db.record.findMany({
    where: { projectId: args.projectId, id: { in: args.recordIds }, trashedAt: null },
    select: { id: true, type: true },
  });
  const byId = new Map(located.map((row) => [row.id, row]));
  const missing: { recordId: string; code: "RECORD_NOT_FOUND" }[] = [];
  const denied: { recordId: string; code: "MANUSCRIPT_NOT_PERMITTED" }[] = [];
  const allowed: string[] = [];
  for (const id of args.recordIds) {
    const row = byId.get(id);
    if (!row) missing.push({ recordId: id, code: "RECORD_NOT_FOUND" });
    else if (isManuscriptType(row.type) && !grant.manuscriptRead) denied.push({ recordId: id, code: "MANUSCRIPT_NOT_PERMITTED" });
    else allowed.push(id);
  }
  const records = [];
  for (const id of allowed) {
    const row = await db.record.findFirst({ where: { id, projectId: args.projectId, trashedAt: null } });
    if (!row) {
      missing.push({ recordId: id, code: "RECORD_NOT_FOUND" });
      continue;
    }
    const view = toRecordView(row);
    records.push({
      id: view.id,
      projectId: view.projectId,
      type: view.type,
      title: view.title,
      body: view.body,
      fields: view.fields,
      authorityStatus: view.authorityStatus,
      statusMarkedInText: hasSectionStatus(view.body),
      supersededByRecordId: view.supersededByRecordId,
      protected: view.protected,
      currentRevision: view.currentRevision,
      updatedAt: view.updatedAt.toISOString(),
    });
  }
  const payload = { projectId: args.projectId, manuscriptAccess: grant.manuscriptRead, records, missing, denied };
  assertFits(payload, records.map((record) => ({ id: record.id, chars: resultChars(record) })));
  return payload;
}

async function requireRecordMeta(db: Db, grant: LocalGrant, projectId: string, id: string) {
  await requireProject(db, grant, projectId);
  const row = await db.record.findFirst({ where: { id, projectId, trashedAt: null }, select: { id: true, type: true } });
  if (!row) throw new McpToolError("RECORD_NOT_FOUND", `Record ${id} was not found in this project. Nothing was read.`);
  if (isManuscriptType(row.type)) assertManuscriptAllowed(grant);
  return row;
}

async function listRevisions(db: Db, grant: LocalGrant, args: { projectId: string; recordId: string; limit?: number; cursor?: string }) {
  await requireRecordMeta(db, grant, args.projectId, args.recordId);
  const limit = resolveLimit(args.limit, REVISION_PAGE_DEFAULT, REVISION_PAGE_MAX);
  const rows = await db.revision.findMany({
    where: { recordId: args.recordId },
    orderBy: { revisionNumber: "desc" },
    select: {
      revisionNumber: true,
      createdAt: true,
      title: true,
      authorityStatus: true,
      source: { select: { kind: true, actor: true, conversationLabel: true, packageId: true, originalFilename: true } },
    },
  });
  const revisions = rows.map((row) => ({
    revisionNumber: row.revisionNumber,
    createdAt: row.createdAt.toISOString(),
    title: row.title,
    authorityStatus: row.authorityStatus,
    source: row.source,
  }));
  const paged = pageRows(revisions, limit, args.cursor, (row) => String(row.revisionNumber));
  const payload = { projectId: args.projectId, recordId: args.recordId, revisions: paged.rows, page: paged.page };
  assertFits(payload, paged.rows.map((row) => ({ id: String(row.revisionNumber), chars: resultChars(row) })));
  return payload;
}

async function getRevision(db: Db, grant: LocalGrant, args: { projectId: string; recordId: string; revision: number }) {
  await requireRecordMeta(db, grant, args.projectId, args.recordId);
  const row = await db.revision.findUnique({
    where: { recordId_revisionNumber: { recordId: args.recordId, revisionNumber: args.revision } },
    include: { source: true },
  });
  if (!row) {
    throw new McpToolError("REVISION_NOT_FOUND", `Saved version ${args.revision} was not found. Nothing was read.`);
  }
  const view = toRevisionView(row);
  const payload = {
    projectId: args.projectId,
    recordId: view.recordId,
    revisionNumber: view.revisionNumber,
    createdAt: view.createdAt.toISOString(),
    title: view.title,
    body: view.body,
    fields: view.fields,
    authorityStatus: view.authorityStatus,
    statusMarkedInText: hasSectionStatus(view.body),
    supersededByRecordId: view.supersededByRecordId,
    contentHash: view.contentHash,
    source: {
      kind: row.source.kind,
      actor: row.source.actor,
      conversationLabel: row.source.conversationLabel,
      packageId: row.source.packageId,
      originalFilename: row.source.originalFilename,
    },
  };
  assertFits(payload, [{ id: `${args.recordId}#${args.revision}`, chars: resultChars(payload) }]);
  return payload;
}

async function loadCurrentRecord(db: Db, grant: LocalGrant, projectId: string, id: string) {
  await requireRecordMeta(db, grant, projectId, id);
  const row = await db.record.findFirst({ where: { id, projectId, trashedAt: null } });
  if (!row) throw new McpToolError("RECORD_NOT_FOUND", `Record ${id} was not found in this project. Nothing was read.`);
  return toRecordView(row);
}

async function listRecordSections(db: Db, grant: LocalGrant, args: { projectId: string; recordId: string; limit?: number; cursor?: string }) {
  const view = await loadCurrentRecord(db, grant, args.projectId, args.recordId);
  const limit = resolveLimit(args.limit, SECTION_PAGE_DEFAULT, SECTION_PAGE_MAX);
  const sections = listSections(view.body).map((s) => ({
    sectionId: s.id,
    parentId: s.parentId,
    level: s.level,
    title: s.title,
    statusTag: s.statusTag,
    chars: s.end - s.start,
  }));
  const paged = pageRows(sections, limit, args.cursor, (row) => row.sectionId);
  const payload = {
    projectId: args.projectId,
    recordId: view.id,
    title: view.title,
    authorityStatus: view.authorityStatus,
    currentRevision: view.currentRevision,
    statusMarkedInText: sections.some((s) => s.statusTag !== null),
    bodyChars: view.body.length,
    sections: paged.rows,
    page: paged.page,
  };
  assertFits(payload, paged.rows.map((row) => ({ id: row.sectionId, chars: resultChars(row) })));
  return payload;
}

async function getRecordSection(db: Db, grant: LocalGrant, args: { projectId: string; recordId: string; sectionId: string }) {
  const view = await loadCurrentRecord(db, grant, args.projectId, args.recordId);
  const sections = listSections(view.body);
  const section = sections.find((s) => s.id === args.sectionId);
  if (!section) {
    throw new McpToolError(
      "SECTION_NOT_FOUND",
      `Section ${args.sectionId} is not in the current version of record ${view.id}. Call list_sections for its sections. Nothing was read.`,
    );
  }
  const path = sectionPath(sections, section.id);
  const payload = {
    projectId: args.projectId,
    recordId: view.id,
    recordTitle: view.title,
    authorityStatus: view.authorityStatus,
    currentRevision: view.currentRevision,
    statusMarkedInText: sections.some((s) => s.statusTag !== null),
    sectionId: section.id,
    title: section.title,
    statusTag: section.statusTag,
    path: path.map((s) => ({ sectionId: s.id, title: s.title, statusTag: s.statusTag })),
    text: view.body.slice(section.start, section.end),
  };
  const chars = resultChars(payload);
  if (chars > MAX_RESULT_CHARS) {
    const subsections = sections
      .filter((s) => s.parentId === section.id)
      .map((s) => ({ id: s.id, title: s.title, chars: s.end - s.start }));
    throw new McpToolError(
      "RESULT_TOO_LARGE",
      `The section is ${chars} characters, over the limit of ${MAX_RESULT_CHARS}. Nothing was shortened and nothing was returned.` +
        (subsections.length ? " Read its subsections with get_section instead." : ""),
      { chars, limit: MAX_RESULT_CHARS, items: subsections },
    );
  }
  return payload;
}

async function reviewHistory(
  db: Db,
  grant: LocalGrant,
  args: {
    projectId: string;
    limit?: number;
    packagesCursor?: string;
    auditCursor?: string;
    reviewCursor?: string;
    reviewStatus?: "open" | "resolved" | "all";
  },
) {
  await requireProject(db, grant, args.projectId);
  const limit = resolveLimit(args.limit, HISTORY_PAGE_DEFAULT, HISTORY_PAGE_MAX);
  const chapters = grant.manuscriptRead ? new Set<string>() : await manuscriptIds(db, args.projectId);
  const status = args.reviewStatus ?? "open";

  const [packageRows, auditRows, reviewRows] = await Promise.all([
    db.changePackage.findMany({ where: { projectId: args.projectId }, orderBy: [{ appliedAt: "desc" }, { packageId: "asc" }] }),
    db.auditEntry.findMany({ where: { projectId: args.projectId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    db.reviewItem.findMany({
      where: { projectId: args.projectId, ...(status === "all" ? {} : { status }) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { record: { select: { id: true, type: true, title: true } } },
    }),
  ]);

  const packages = packageRows.map((row) => presentPackage(row, chapters));
  const audit = auditRows.map((row) => presentAudit(row, chapters));
  const reviewItems = reviewRows.map((row) => presentReview(row, chapters));
  const packagesPage = pageRows(packages, limit, args.packagesCursor, (row) => row.packageId);
  const auditPage = pageRows(audit, limit, args.auditCursor, (row) => row.id);
  const reviewPage = pageRows(reviewItems, limit, args.reviewCursor, (row) => row.id);
  const payload = {
    projectId: args.projectId,
    manuscriptAccess: grant.manuscriptRead,
    packages: { items: packagesPage.rows, page: packagesPage.page },
    audit: { items: auditPage.rows, page: auditPage.page },
    reviewItems: { status, items: reviewPage.rows, page: reviewPage.page },
  };
  assertFits(payload, [
    ...sized(packagesPage.rows, (row) => row.packageId),
    ...sized(auditPage.rows, (row) => row.id),
    ...sized(reviewPage.rows, (row) => row.id),
  ]);
  return payload;
}

function sized<T>(rows: T[], idOf: (row: T) => string): { id: string; chars: number }[] {
  return rows.map((row) => ({ id: idOf(row), chars: resultChars(row) }));
}

function presentPackage(
  row: { packageId: string; summary: string; status: string; appliedAt: Date; resultJson: string },
  chapters: Set<string>,
) {
  const result = JSON.parse(row.resultJson) as {
    contentHash?: string;
    changes?: { recordId: string; title?: string; [key: string]: unknown }[];
    reviewItems?: { recordId: string; title?: string; note?: string; [key: string]: unknown }[];
  };
  const changes = (result.changes ?? []).map((change) => {
    if (!chapters.has(change.recordId)) return change;
    const { title: _title, ...rest } = change;
    return { ...rest, withheld: "MANUSCRIPT_NOT_PERMITTED" };
  });
  const reviewItems = (result.reviewItems ?? []).map((item) => {
    if (!chapters.has(item.recordId)) return item;
    const { title: _title, note: _note, ...rest } = item;
    return { ...rest, withheld: "MANUSCRIPT_NOT_PERMITTED" };
  });
  const summaryWithheld = mentionsManuscript(row.summary, chapters);
  return {
    packageId: row.packageId,
    status: row.status,
    appliedAt: row.appliedAt.toISOString(),
    contentHash: result.contentHash ?? null,
    summary: summaryWithheld ? null : row.summary,
    summaryWithheld: summaryWithheld ? "MANUSCRIPT_NOT_PERMITTED" : null,
    changes,
    reviewItems,
  };
}

function presentAudit(
  row: { id: string; action: string; actor: string; summary: string; sourceId: string | null; packageId: string | null; detailsJson: string; createdAt: Date },
  chapters: Set<string>,
) {
  const details = JSON.parse(row.detailsJson) as unknown;
  const base = {
    id: row.id,
    action: row.action,
    actor: row.actor,
    sourceId: row.sourceId,
    packageId: row.packageId,
    createdAt: row.createdAt.toISOString(),
  };
  if (mentionsManuscript(details, chapters) || mentionsManuscript(row.summary, chapters)) {
    return { ...base, withheld: "MANUSCRIPT_NOT_PERMITTED" as const };
  }
  return { ...base, summary: row.summary, details };
}

function presentReview(
  row: {
    id: string;
    recordId: string;
    packageId: string | null;
    origin: string;
    note: string;
    status: string;
    createdAt: Date;
    record: { type: string; title: string };
  },
  chapters: Set<string>,
) {
  const base = {
    id: row.id,
    recordId: row.recordId,
    recordType: row.record.type,
    packageId: row.packageId,
    origin: row.origin,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
  if (chapters.has(row.recordId)) return { ...base, withheld: "MANUSCRIPT_NOT_PERMITTED" as const };
  return { ...base, recordTitle: row.record.title, note: row.note };
}

function mentionsManuscript(value: unknown, chapters: Set<string>): boolean {
  if (chapters.size === 0) return false;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const id of chapters) if (text.includes(id)) return true;
  return false;
}

export type { PageInfo };
