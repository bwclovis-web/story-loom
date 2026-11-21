export interface RecoveryDraft {
  title: string;
  body: string;
  fields: string;
  savedAt: string;
}

export interface RecoveryBaseline {
  title: string;
  body: string;
  fields: string;
}

export function recoveryKey(recordId: string, revision: number): string {
  return `storyloom-recovery:${recordId}:${revision}`;
}

export function recoveryDiffers(saved: RecoveryBaseline, draft: RecoveryBaseline): boolean {
  return saved.title !== draft.title || saved.body !== draft.body || saved.fields !== draft.fields;
}

export function parseRecoveryDraft(raw: string | null): RecoveryDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<RecoveryDraft>;
    if (typeof value.title !== "string" || typeof value.body !== "string" || typeof value.fields !== "string") return null;
    return {
      title: value.title,
      body: value.body,
      fields: value.fields,
      savedAt: typeof value.savedAt === "string" ? value.savedAt : "",
    };
  } catch {
    return null;
  }
}
