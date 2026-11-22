"use client";

import { useMemo, useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import type { Issue } from "@/domain/issues";
import { Checkbox } from "@/components/ui/Checkbox";
import { RECORD, WORLD } from "@/ui/labels";
import { applyOutlineAction } from "../../world/inspectorActions";
import {
  REFERENCE_TEMPLATES,
  referenceTemplate,
  reviewTemplateMapping,
  type ReferenceTemplateKey,
} from "@/world/referenceTemplates";

/**
 * Shows how an original outline would sit on the saved text. Nothing is written
 * until Apply, and Apply only appends headings that are not already there.
 */
export function OutlineReview({
  projectId,
  recordId,
  revision,
  body,
  fieldKeys,
  isProtected,
  editing,
}: {
  projectId: string;
  recordId: string;
  revision: number;
  body: string;
  fieldKeys: string[];
  isProtected: boolean;
  editing: boolean;
}) {
  const [templateKey, setTemplateKey] = useState<ReferenceTemplateKey | "">("");
  const [unlock, setUnlock] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const mapping = useMemo(
    () => (templateKey ? reviewTemplateMapping(referenceTemplate(templateKey), body, fieldKeys) : null),
    [templateKey, body, fieldKeys],
  );

  return (
    <section className="panel" id="original-outline" aria-labelledby="outline-heading">
      <h2 id="outline-heading">{WORLD.outlineHeading}</h2>
      <p className="small muted">{WORLD.outlineLead}</p>
      {editing ? (
        <p className="small">{WORLD.outlineWhileEditing}</p>
      ) : (
        <div className="stack">
          <label>
            {WORLD.outlineChoose}
            <select
              value={templateKey}
              onChange={(event) => {
                setTemplateKey(event.target.value as ReferenceTemplateKey | "");
                setMessage(null);
                setIssues([]);
              }}
            >
              <option value="">{WORLD.outlineNone}</option>
              {REFERENCE_TEMPLATES.map((template) => (
                <option key={template.key} value={template.key}>
                  {template.label}
                </option>
              ))}
            </select>
          </label>
          {mapping ? (
            <div className="outline-mapping">
              <h3>{mapping.templateLabel}</h3>
              <p className="small">{WORLD.outlineMatched}</p>
              {mapping.matched.length ? (
                <ul>
                  {mapping.matched.map((item) => (
                    <li key={item.templateSection}>
                      {item.templateSection}
                      {item.heading !== item.templateSection ? <span className="muted"> — {item.heading}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="small muted">{WORLD.outlineNoneMatched}</p>
              )}
              {mapping.keptHeadings.length ? (
                <>
                  <p className="small">{WORLD.outlineKept}</p>
                  <ul>
                    {mapping.keptHeadings.map((heading) => (
                      <li key={heading}>{heading}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {mapping.freeformKept ? <p className="small">{WORLD.outlineFreeform}</p> : null}
              <p className="small">{WORLD.outlineMissing}</p>
              {mapping.missing.length ? (
                <ul>
                  {mapping.missing.map((section) => (
                    <li key={section}>{section}</li>
                  ))}
                </ul>
              ) : (
                <p className="small muted">{WORLD.outlineNothingToAdd}</p>
              )}
              <p className="small">
                {mapping.fieldKeys.length ? (
                  <>
                    {WORLD.outlineFieldsKept}: {mapping.fieldKeys.join(", ")}
                  </>
                ) : (
                  WORLD.outlineNoFields
                )}
              </p>
              {isProtected ? (
                <Checkbox checked={unlock} onChange={(event) => setUnlock(event.target.checked)} label={RECORD.unlockProtected} />
              ) : null}
              <div>
                <button
                  type="button"
                  disabled={pending || !mapping.changesBody || (isProtected && !unlock)}
                  onClick={() =>
                    startTransition(async () => {
                      setIssues([]);
                      setMessage(null);
                      const result = await applyOutlineAction(projectId, recordId, {
                        templateKey: mapping.templateKey,
                        expectedRevision: revision,
                        unlockProtected: unlock,
                      });
                      if (!result.ok) {
                        setIssues(result.issues);
                        return;
                      }
                      setMessage(result.message);
                      setUnlock(false);
                    })
                  }
                >
                  {WORLD.outlineApply}
                </button>
              </div>
            </div>
          ) : null}
          {message ? <p className="small">{message}</p> : null}
          <IssueList issues={issues} />
        </div>
      )}
    </section>
  );
}
