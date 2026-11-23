"use client";
import { Button } from "@/components/ui/Atoms/Button";
import { Checkbox } from "@/components/ui/Atoms/Checkbox";
import { Select } from "@/components/ui/Atoms/Select";

import { useState, useTransition } from "react";
import { ProtectionBadge, StatusBadge } from "@/components/Badges";
import type { WritingContextMode } from "@/domain/characterWritingContext";
import { isManuscriptType, RECORD_TYPE_LABELS, RECORD_TYPES, type RecordType } from "@/domain/recordTypes";
import type { AuthorityStatus } from "@/domain/statuses";
import { EXPORT } from "@/ui/labels";
import { exportBundleAction } from "../actions";

interface ExportableRecord {
  id: string;
  title: string;
  type: RecordType;
  revision: number;
  authorityStatus: AuthorityStatus;
  protected: boolean;
}

interface StoryPointOption {
  id: string;
  title: string;
  type: RecordType;
}

export function ExportClient({
  projectId,
  records,
  initialSelection,
  storyPoints = [],
}: {
  projectId: string;
  records: ExportableRecord[];
  /** Record IDs to tick first; by default every non-manuscript record. */
  initialSelection: string[] | null;
  storyPoints?: StoryPointOption[];
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelection ?? records.filter((r) => !isManuscriptType(r.type)).map((r) => r.id)),
  );
  const [includeSchema, setIncludeSchema] = useState(true);
  const [characterMode, setCharacterMode] = useState<WritingContextMode>("editorial");
  const [focusRecordId, setFocusRecordId] = useState<string>("");
  const [redactCharacterSpoilers, setRedactCharacterSpoilers] = useState(false);
  const [bundle, setBundle] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  const generate = () =>
    startTransition(async () => {
      setCopied(false);
      setBundle(
        await exportBundleAction(projectId, [...selected], [], includeSchema, {
          characterMode,
          focusRecordId: focusRecordId || null,
          redactCharacterSpoilers,
        }),
      );
    });

  const download = () => {
    const blob = new Blob([bundle], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `context-bundle-${projectId}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(bundle);
    setCopied(true);
  };

  return (
    <div className="stack">
      {RECORD_TYPES.map((type) => {
        const ofType = records.filter((r) => r.type === type);
        if (ofType.length === 0) return null;
        const ids = ofType.map((r) => r.id);
        const allOn = ids.every((id) => selected.has(id));
        return (
          <div key={type} className="panel">
            <Checkbox
              style={{ fontWeight: 600 }}
              checked={allOn}
              onChange={(e) => toggle(ids, e.target.checked)}
              label={RECORD_TYPE_LABELS[type]}
            />
            <div className="stack" style={{ marginTop: "0.4rem", marginLeft: "1.4rem" }}>
              {ofType.map((r) => (
                <Checkbox
                  key={r.id}
                  checked={selected.has(r.id)}
                  onChange={(e) => toggle([r.id], e.target.checked)}
                  label={
                    <>
                      {r.title} <code className="small muted">{r.id}</code> <span className="badge">rev {r.revision}</span>
                      <StatusBadge status={r.authorityStatus} />
                      <ProtectionBadge isProtected={r.protected} />
                    </>
                  }
                />
              ))}
            </div>
          </div>
        );
      })}

      <div className="panel stack">
        <div className="row" style={{ flexWrap: "wrap", gap: "1rem", alignItems: "flex-start" }}>
          <Select
            label={EXPORT.characterModeLabel}
            hint={EXPORT.characterModeHint}
            value={characterMode}
            onChange={(e) => setCharacterMode(e.target.value as WritingContextMode)}
          >
            <option value="drafting">{EXPORT.characterModeDrafting}</option>
            <option value="editorial">{EXPORT.characterModeEditorial}</option>
            <option value="planning">{EXPORT.characterModePlanning}</option>
          </Select>
          {storyPoints.length > 0 ? (
            <Select
              label={EXPORT.storyPointLabel}
              hint={EXPORT.storyPointHint}
              value={focusRecordId}
              onChange={(e) => setFocusRecordId(e.target.value)}
            >
              <option value="">{EXPORT.storyPointNone}</option>
              {storyPoints.map((point) => (
                <option key={point.id} value={point.id}>
                  {point.title} ({RECORD_TYPE_LABELS[point.type]})
                </option>
              ))}
            </Select>
          ) : null}
        </div>
        <Checkbox
          checked={redactCharacterSpoilers}
          onChange={(e) => setRedactCharacterSpoilers(e.target.checked)}
          label={EXPORT.redactSpoilers}
        />
        <Checkbox checked={includeSchema} onChange={(e) => setIncludeSchema(e.target.checked)} label={EXPORT.includeSchema} />
        <div className="row">
          <Button onClick={generate} disabled={pending || selected.size === 0}>
            {EXPORT.generate(selected.size)}
          </Button>
          {bundle ? (
            <>
              <Button onClick={download} variant="secondary">
                {EXPORT.download}
              </Button>
              <Button onClick={copy} variant="secondary">
                {copied ? EXPORT.copied : EXPORT.copy}
              </Button>
            </>
          ) : null}
        </div>
        {bundle ? <textarea className="mono" readOnly spellCheck={false} aria-label="Context bundle" value={bundle} style={{ minHeight: "20rem" }} /> : null}
      </div>
    </div>
  );
}
