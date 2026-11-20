import Database from "better-sqlite3";
import path from "node:path";
import { compareBookOrder } from "@/domain/bookOrder";
import { sha256, sha256Bytes, stableStringify } from "@/domain/json";

/*
 * Read-only inventory of a Story Loom SQLite file, for comparing a database before
 * and after a migration or a restore. It holds IDs, structure, counts and
 * sha256 hashes, never titles or text, so it can be shared in a report.
 * It reads with plain SQL on a read-only connection inside one read
 * transaction, and tolerates missing tables and columns, so it works on any
 * schema from the first migration on. No "server-only" import: the db:*
 * scripts and tests use it outside Next.js.
 */

export const INVENTORY_FORMAT = "wordly.database-inventory";
export const INVENTORY_FORMAT_VERSION = 1;

export interface RevisionInventory {
  n: number;
  /** Stored hash of the revision snapshot. */
  contentHash: string;
  /** The stored hash still matches the stored title, body, fields and status. */
  hashValid: boolean;
  sourceKind: string | null;
  packageId: string | null;
}

export interface RecordInventory {
  id: string;
  type: string;
  parentRecordId: string | null;
  position: number | null;
  protected: boolean;
  authorityStatus: string;
  supersededByRecordId: string | null;
  currentRevision: number;
  trashed: boolean;
  trashBatchId: string | null;
  createdAt: string;
  titleSha256: string;
  /** sha256 of the exact stored body. */
  bodySha256: string;
  bodyChars: number;
  /** sha256 of the stable serialization of the parsed fields JSON. */
  fieldsSha256: string;
  /** Current title, body, fields, status and superseded-by equal the latest revision. */
  matchesLatestRevision: boolean;
  revisions: RevisionInventory[];
}

export interface ProjectInventory {
  id: string;
  titleSha256: string;
  trashed: boolean;
  createdAt: string;
  counts: {
    records: number;
    trashedRecords: number;
    revisions: number;
    sources: number;
    changePackages: number;
    openReviewItems: number;
    resolvedReviewItems: number;
    importedFiles: number;
    links: number;
    images: number;
    /** Excludes `workspace.restore` entries, which a restore adds. */
    auditEntries: number;
  };
  /** Stored only in the SQLite file; workspace backups do not carry these. */
  notInWorkspaceBackups: {
    assistantConversations: number;
    assistantMessages: number;
    assistantContextItems: number;
    assistantProposals: number;
    proofreadRuns: number;
  };
  /** Live chapters in book order, and the live scenes of each chapter in order. */
  bookOrder: { chapters: string[]; scenes: Record<string, string[]> };
  records: RecordInventory[];
  links: Array<{ id: string; fromRecordId: string; toRecordId: string }>;
  /** Present only when a cover picture is stored. */
  cover?: {
    mimeType: string;
    byteSize: number;
    width: number;
    height: number;
    contentHash: string;
    dataSha256: string;
  };
  images: Array<{
    id: string;
    recordId: string;
    name: string;
    mimeType: string;
    byteSize: number;
    width: number;
    height: number;
    contentHash: string;
    /** sha256 of the stored bytes; equals contentHash when the image is intact. */
    dataSha256: string;
    position: number;
    captionSha256: string;
    altTextSha256: string;
  }>;
  changePackages: Array<{
    packageId: string;
    formatVersion: number;
    contentHash: string;
    status: string;
    rawJsonSha256: string;
    appliedAt: string;
  }>;
  importedFiles: Array<{
    id: string;
    recordId: string;
    action: string;
    revisionNumber: number;
    contentHash: string;
    byteSize: number;
  }>;
}

export interface WorkspaceInventory {
  id: string;
  nameSha256: string;
  trashed: boolean;
  createdAt: string;
  dictionary: { entries: number; entriesSha256: string };
  projects: ProjectInventory[];
}

export interface DatabaseInventory {
  format: typeof INVENTORY_FORMAT;
  formatVersion: typeof INVENTORY_FORMAT_VERSION;
  createdAt: string;
  databaseFile: string;
  migrations: string[];
  tables: Record<string, number>;
  workspaces: WorkspaceInventory[];
}

type Row = Record<string, unknown>;

const iso = (value: unknown): string => new Date(String(value)).toISOString();
const str = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

function fieldsHash(text: unknown): string {
  try {
    return sha256(stableStringify(JSON.parse(String(text))));
  } catch {
    return `unparseable:${sha256(String(text))}`;
  }
}

function snapshotHash(row: Row): string {
  return sha256(
    stableStringify({
      title: row.title,
      body: row.body,
      fields: JSON.parse(String(row.fields)),
      authorityStatus: row.authorityStatus,
      supersededByRecordId: row.supersededByRecordId ?? null,
    }),
  );
}

class Reader {
  private readonly tables: Set<string>;
  private readonly columnCache = new Map<string, Set<string>>();

  constructor(private readonly sqlite: Database.Database) {
    this.tables = new Set(
      (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((t) => t.name),
    );
  }

  tableNames(): string[] {
    return [...this.tables].filter((t) => !t.startsWith("sqlite_")).sort();
  }

  has(table: string): boolean {
    return this.tables.has(table);
  }

  private columns(table: string): Set<string> {
    let cols = this.columnCache.get(table);
    if (!cols) {
      cols = new Set((this.sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((c) => c.name));
      this.columnCache.set(table, cols);
    }
    return cols;
  }

  /** SELECT of the named columns; a column the schema lacks reads as NULL. */
  rows(table: string, columns: string[], where = "", params: readonly unknown[] = []): Row[] {
    if (!this.has(table)) return [];
    const have = this.columns(table);
    const select = columns.map((c) => (have.has(c) ? `"${c}"` : `NULL AS "${c}"`)).join(", ");
    return this.sqlite.prepare(`SELECT ${select} FROM "${table}" ${where}`).all(...params) as Row[];
  }

  count(table: string): number {
    if (!this.has(table)) return 0;
    return (this.sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
  }
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

function bookOrderOf(records: RecordInventory[]): ProjectInventory["bookOrder"] {
  const live = records.filter((r) => !r.trashed);
  const ordered = (list: RecordInventory[]) =>
    list
      .map((r) => ({ id: r.id, position: r.position, createdAt: r.createdAt }))
      .sort(compareBookOrder)
      .map((r) => r.id);
  const chapters = ordered(live.filter((r) => r.type === "manuscript_chapter"));
  const scenesByChapter = groupBy(
    live.filter((r) => r.type === "manuscript_scene" && r.parentRecordId),
    (r) => r.parentRecordId!,
  );
  const scenes: Record<string, string[]> = {};
  for (const chapterId of chapters) {
    const list = scenesByChapter.get(chapterId);
    if (list) scenes[chapterId] = ordered(list);
  }
  return { chapters, scenes };
}

function projectInventory(reader: Reader, project: Row): ProjectInventory {
  const projectId = String(project.id);
  const byProject = ["WHERE projectId = ? ORDER BY id", [projectId]] as const;

  const sourceRows = reader.rows("Source", ["id", "kind", "packageId"], ...byProject);
  const sources = new Map(sourceRows.map((s) => [String(s.id), s]));

  const recordRows = reader.rows(
    "Record",
    [
      "id", "type", "title", "body", "fields", "authorityStatus", "supersededByRecordId", "protected",
      "parentRecordId", "position", "currentRevision", "trashedAt", "trashBatchId", "createdAt",
    ],
    ...byProject,
  );
  const revisionRows = reader.rows(
    "Revision",
    ["recordId", "revisionNumber", "title", "body", "fields", "authorityStatus", "supersededByRecordId", "contentHash", "sourceId"],
    `WHERE recordId IN (SELECT id FROM "Record" WHERE projectId = ?) ORDER BY recordId, revisionNumber`,
    [projectId],
  );
  const revisionsByRecord = groupBy(revisionRows, (r) => String(r.recordId));

  const records: RecordInventory[] = recordRows.map((r) => {
    const revisions = revisionsByRecord.get(String(r.id)) ?? [];
    const latest = revisions.at(-1);
    return {
      id: String(r.id),
      type: String(r.type),
      parentRecordId: str(r.parentRecordId),
      position: num(r.position),
      protected: Boolean(r.protected),
      authorityStatus: String(r.authorityStatus),
      supersededByRecordId: str(r.supersededByRecordId),
      currentRevision: Number(r.currentRevision),
      trashed: r.trashedAt !== null && r.trashedAt !== undefined,
      trashBatchId: str(r.trashBatchId),
      createdAt: iso(r.createdAt),
      titleSha256: sha256(String(r.title)),
      bodySha256: sha256(String(r.body)),
      bodyChars: String(r.body).length,
      fieldsSha256: fieldsHash(r.fields),
      matchesLatestRevision:
        !!latest &&
        Number(latest.revisionNumber) === Number(r.currentRevision) &&
        latest.title === r.title &&
        latest.body === r.body &&
        fieldsHash(latest.fields) === fieldsHash(r.fields) &&
        latest.authorityStatus === r.authorityStatus &&
        (latest.supersededByRecordId ?? null) === (r.supersededByRecordId ?? null),
      revisions: revisions.map((v) => {
        const source = sources.get(String(v.sourceId));
        let hashValid = false;
        try {
          hashValid = snapshotHash(v) === v.contentHash;
        } catch {
          hashValid = false;
        }
        return {
          n: Number(v.revisionNumber),
          contentHash: String(v.contentHash),
          hashValid,
          sourceKind: str(source?.kind),
          packageId: str(source?.packageId),
        };
      }),
    };
  });

  const links = reader
    .rows("RecordLink", ["id", "fromRecordId", "toRecordId"], ...byProject)
    .map((l) => ({ id: String(l.id), fromRecordId: String(l.fromRecordId), toRecordId: String(l.toRecordId) }));

  const images = reader
    .rows(
      "RecordImage",
      ["id", "recordId", "name", "mimeType", "byteSize", "width", "height", "contentHash", "data", "position", "caption", "altText"],
      ...byProject,
    )
    .map((i) => ({
      id: String(i.id),
      recordId: String(i.recordId),
      name: String(i.name),
      mimeType: String(i.mimeType),
      byteSize: Number(i.byteSize),
      width: Number(i.width),
      height: Number(i.height),
      contentHash: String(i.contentHash),
      dataSha256: sha256Bytes(i.data as Uint8Array),
      position: Number(i.position),
      captionSha256: sha256(String(i.caption ?? "")),
      altTextSha256: sha256(String(i.altText ?? "")),
    }));

  const coverRow = reader
    .rows("ProjectCover", ["mimeType", "byteSize", "width", "height", "contentHash", "data"], "WHERE projectId = ?", [projectId])
    .at(0);
  const cover = coverRow
    ? {
        mimeType: String(coverRow.mimeType),
        byteSize: Number(coverRow.byteSize),
        width: Number(coverRow.width),
        height: Number(coverRow.height),
        contentHash: String(coverRow.contentHash),
        dataSha256: sha256Bytes(coverRow.data as Uint8Array),
      }
    : null;

  const changePackages = reader
    .rows("ChangePackage", ["packageId", "formatVersion", "contentHash", "status", "rawJson", "appliedAt"], "WHERE projectId = ? ORDER BY packageId", [projectId])
    .map((p) => ({
      packageId: String(p.packageId),
      formatVersion: Number(p.formatVersion),
      contentHash: String(p.contentHash),
      status: String(p.status),
      rawJsonSha256: sha256(String(p.rawJson)),
      appliedAt: iso(p.appliedAt),
    }));

  const importedFiles = reader
    .rows("ImportedFile", ["id", "recordId", "action", "revisionNumber", "contentHash", "byteSize"], ...byProject)
    .map((f) => ({
      id: String(f.id),
      recordId: String(f.recordId),
      action: String(f.action),
      revisionNumber: Number(f.revisionNumber),
      contentHash: String(f.contentHash),
      byteSize: Number(f.byteSize),
    }));

  const reviewStatuses = reader.rows("ReviewItem", ["status"], "WHERE projectId = ?", [projectId]).map((r) => r.status);
  const audit = reader.rows("AuditEntry", ["action"], "WHERE projectId = ?", [projectId]);
  const conversationIds = reader.rows("AssistantConversation", ["id"], "WHERE projectId = ?", [projectId]).map((c) => String(c.id));
  const messageIds = conversationIds.length
    ? reader
        .rows("AssistantMessage", ["id"], `WHERE conversationId IN (${conversationIds.map(() => "?").join(",")})`, conversationIds)
        .map((m) => String(m.id))
    : [];
  const contextItems = messageIds.length
    ? reader.rows("AssistantContextItem", ["id"], `WHERE messageId IN (${messageIds.map(() => "?").join(",")})`, messageIds).length
    : 0;

  return {
    id: projectId,
    titleSha256: sha256(String(project.title)),
    trashed: project.trashedAt !== null && project.trashedAt !== undefined,
    createdAt: iso(project.createdAt),
    counts: {
      records: records.length,
      trashedRecords: records.filter((r) => r.trashed).length,
      revisions: revisionRows.length,
      sources: sourceRows.length,
      changePackages: changePackages.length,
      openReviewItems: reviewStatuses.filter((s) => s === "open").length,
      resolvedReviewItems: reviewStatuses.filter((s) => s === "resolved").length,
      importedFiles: importedFiles.length,
      links: links.length,
      images: images.length,
      auditEntries: audit.filter((a) => a.action !== "workspace.restore").length,
    },
    notInWorkspaceBackups: {
      assistantConversations: conversationIds.length,
      assistantMessages: messageIds.length,
      assistantContextItems: contextItems,
      assistantProposals: reader.rows("AssistantProposal", ["id"], "WHERE projectId = ?", [projectId]).length,
      proofreadRuns: reader.rows("ProofreadRun", ["id"], "WHERE projectId = ?", [projectId]).length,
    },
    bookOrder: bookOrderOf(records),
    ...(cover ? { cover } : {}),
    records,
    links,
    images,
    changePackages,
    importedFiles,
  };
}

/** Inventory of the SQLite file at `file`. Opens it read-only; never writes. */
export function inventoryDatabase(file: string): DatabaseInventory {
  const sqlite = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const read = sqlite.transaction((): DatabaseInventory => {
      const reader = new Reader(sqlite);
      const migrations = reader
        .rows("_prisma_migrations", ["migration_name", "finished_at"], "WHERE finished_at IS NOT NULL ORDER BY migration_name")
        .map((m) => String(m.migration_name));
      const tables: Record<string, number> = {};
      for (const table of reader.tableNames()) tables[table] = reader.count(table);

      const workspaces = reader.rows("Workspace", ["id", "name", "trashedAt", "createdAt"], "ORDER BY id").map((w): WorkspaceInventory => {
        const dictionary = reader
          .rows("DictionaryEntry", ["projectId", "word", "caseSensitive", "note", "origin"], "WHERE workspaceId = ?", [w.id])
          .map((d) => stableStringify({ projectId: d.projectId ?? null, word: d.word, caseSensitive: Boolean(d.caseSensitive), note: d.note, origin: d.origin }))
          .sort();
        return {
          id: String(w.id),
          nameSha256: sha256(String(w.name)),
          trashed: w.trashedAt !== null && w.trashedAt !== undefined,
          createdAt: iso(w.createdAt),
          dictionary: { entries: dictionary.length, entriesSha256: sha256(dictionary.join("\n")) },
          projects: reader
            .rows("Project", ["id", "title", "trashedAt", "createdAt"], "WHERE workspaceId = ? ORDER BY id", [w.id])
            .map((p) => projectInventory(reader, p)),
        };
      });

      return {
        format: INVENTORY_FORMAT,
        formatVersion: INVENTORY_FORMAT_VERSION,
        createdAt: new Date().toISOString(),
        databaseFile: path.resolve(/*turbopackIgnore: true*/ file),
        migrations,
        tables,
        workspaces,
      };
    });
    return read.deferred();
  } finally {
    sqlite.close();
  }
}

/** Top-level fields that describe the run rather than the data. */
export const INVENTORY_META_PATHS = ["createdAt", "databaseFile", "tables", "migrations"];
/** Add to the ignore list when one side was rebuilt from workspace backups. */
export const NOT_IN_WORKSPACE_BACKUPS = "*.notInWorkspaceBackups";

export interface InventoryDifference {
  path: string;
  before: unknown;
  after: unknown;
}

function keyOf(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  for (const k of ["id", "n", "packageId"]) if (o[k] !== undefined && o[k] !== null) return `${k}=${String(o[k])}`;
  return null;
}

function uniqueKeys(items: unknown[]): boolean {
  const keys = items.map(keyOf);
  return keys.every((k) => k !== null) && new Set(keys).size === keys.length;
}

function ignored(pathParts: string[], ignore: string[]): boolean {
  const joined = pathParts.join(".");
  const last = pathParts.at(-1) ?? "";
  return ignore.some((p) => (p.startsWith("*.") ? last === p.slice(2) : joined === p));
}

function walk(before: unknown, after: unknown, at: string[], ignore: string[], out: InventoryDifference[]) {
  if (ignored(at, ignore)) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    if (uniqueKeys(before) && uniqueKeys(after)) {
      const b = new Map(before.map((x) => [keyOf(x)!, x]));
      const a = new Map(after.map((x) => [keyOf(x)!, x]));
      for (const [k, v] of b) walk(v, a.get(k), [...at, `[${k}]`], ignore, out);
      for (const [k, v] of a) if (!b.has(k)) out.push({ path: [...at, `[${k}]`].join("."), before: undefined, after: v });
      if (stableStringify([...b.keys()]) !== stableStringify([...a.keys()].filter((k) => b.has(k)))) {
        out.push({ path: [...at, "(order)"].join("."), before: [...b.keys()], after: [...a.keys()] });
      }
      return;
    }
    if (stableStringify(before) !== stableStringify(after)) out.push({ path: at.join("."), before, after });
    return;
  }
  if (before && after && typeof before === "object" && typeof after === "object" && !Array.isArray(before) && !Array.isArray(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of [...keys].sort()) {
      walk((before as Record<string, unknown>)[k], (after as Record<string, unknown>)[k], [...at, k], ignore, out);
    }
    return;
  }
  if (stableStringify(before) !== stableStringify(after)) out.push({ path: at.join("."), before, after });
}

/**
 * Differences between two inventories. Arrays of items with an `id`,
 * `packageId` or revision number are matched by that key, so one missing
 * record is reported once instead of shifting every later entry.
 * `ignore` lists dotted paths to skip; `*.name` skips that field anywhere.
 */
export function compareInventories(
  before: DatabaseInventory,
  after: DatabaseInventory,
  ignore: string[] = INVENTORY_META_PATHS,
): InventoryDifference[] {
  const out: InventoryDifference[] = [];
  walk(before, after, [], ignore, out);
  return out;
}

/** Totals across every workspace, for a short printed summary. */
export function inventoryTotals(inv: DatabaseInventory) {
  const projects = inv.workspaces.flatMap((w) => w.projects);
  const records = projects.flatMap((p) => p.records);
  return {
    workspaces: inv.workspaces.length,
    projects: projects.length,
    records: records.length,
    trashedRecords: records.filter((r) => r.trashed).length,
    protectedRecords: records.filter((r) => r.protected).length,
    revisions: records.reduce((n, r) => n + r.revisions.length, 0),
    invalidRevisionHashes: records.reduce((n, r) => n + r.revisions.filter((v) => !v.hashValid).length, 0),
    recordsNotMatchingLatestRevision: records.filter((r) => !r.matchesLatestRevision).length,
    chaptersInBookOrder: projects.reduce((n, p) => n + p.bookOrder.chapters.length, 0),
    scenesInBookOrder: projects.reduce((n, p) => n + Object.values(p.bookOrder.scenes).flat().length, 0),
    links: projects.reduce((n, p) => n + p.links.length, 0),
    images: projects.reduce((n, p) => n + p.images.length, 0),
    changePackages: projects.reduce((n, p) => n + p.changePackages.length, 0),
    importedFiles: projects.reduce((n, p) => n + p.importedFiles.length, 0),
    dictionaryEntries: inv.workspaces.reduce((n, w) => n + w.dictionary.entries, 0),
    migrations: inv.migrations.length,
  };
}
