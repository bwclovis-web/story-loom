import { parseJsonObject } from "@/domain/json";
import { buildCrossRefIndex, type CrossRefIndex, type XrefRecord } from "@/writing/crossRefs";
import type { DbOrTx } from "../db";

/** Reads live records and the filenames they were imported from. Writes nothing; nothing is stored. */
export async function loadCrossRefIndex(db: DbOrTx, projectId: string): Promise<CrossRefIndex> {
  const [records, files] = await Promise.all([
    db.record.findMany({
      where: { projectId, trashedAt: null },
      select: { id: true, title: true, type: true, body: true, fields: true, authorityStatus: true, supersededByRecordId: true },
      orderBy: { id: "asc" },
    }),
    db.importedFile.findMany({
      where: { projectId, record: { trashedAt: null } },
      select: { recordId: true, originalFilename: true },
    }),
  ]);
  const filenames = new Map<string, string[]>();
  for (const f of files) filenames.set(f.recordId, [...(filenames.get(f.recordId) ?? []), f.originalFilename]);
  const input: XrefRecord[] = records.map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    body: r.body,
    fields: safeFields(r.fields),
    filenames: filenames.get(r.id) ?? [],
    status: r.authorityStatus,
    supersededBy: r.supersededByRecordId,
  }));
  return buildCrossRefIndex(input);
}

function safeFields(text: string): Record<string, unknown> {
  try {
    return parseJsonObject(text);
  } catch {
    return {};
  }
}
