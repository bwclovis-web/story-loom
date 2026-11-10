"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { PackageReview, type ReviewBack } from "@/components/review/PackageReview";
import type { SourceConversation } from "@/server/services/assistantProposalService";
import type { PackagePreview } from "@/server/services/changePackageService";
import { PACKAGE_IMPORT, REVIEW } from "@/ui/labels";
import type { ApplyResponse } from "@/ui/packageReview";
import { applyPackageAction, previewPackageAction, reviewPackageAction } from "../actions";

interface OpenReview {
  /** The exact text that was validated; checks and Apply always use it. */
  raw: string;
  preview: PackagePreview;
  conversation: SourceConversation | null;
  at: number;
  key: number;
}

export function ImportClient({ projectId }: { projectId: string }) {
  const [raw, setRaw] = useState("");
  const [review, setReview] = useState<OpenReview | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const counter = useRef(0);

  const onFile = async (file: File | undefined) => {
    if (file) setRaw(await file.text());
  };

  const runValidate = () =>
    startTransition(async () => {
      setFailed(false);
      const text = raw;
      try {
        const { preview, conversation } = await reviewPackageAction(projectId, text);
        counter.current += 1;
        setReview({ raw: text, preview, conversation, at: Date.now(), key: counter.current });
      } catch {
        setFailed(true);
      }
    });

  const reviewedRaw = review?.raw ?? null;
  const onCheck = useCallback(
    async () => (reviewedRaw === null ? null : await previewPackageAction(projectId, reviewedRaw)),
    [projectId, reviewedRaw],
  );
  const onApply = useCallback(
    async (confirm: { protected: boolean }): Promise<ApplyResponse> => {
      if (reviewedRaw === null) return { status: "failed", message: REVIEW.failed };
      return await applyPackageAction(projectId, reviewedRaw, confirm.protected);
    },
    [projectId, reviewedRaw],
  );

  const editText = () => {
    setReview(null);
    window.setTimeout(() => textRef.current?.focus(), 0);
  };

  const back: ReviewBack = review?.conversation
    ? { label: REVIEW.backToDiscussion, href: `/projects/${projectId}/assistant?c=${encodeURIComponent(review.conversation.id)}` }
    : { label: REVIEW.backToPackageText, onClick: editText };

  if (review) {
    return (
      <div className="stack">
        <div className="row small">
          <span className="muted">{PACKAGE_IMPORT.reviewing(review.raw.length)}</span>
          <button type="button" className="link-button" onClick={editText}>
            {PACKAGE_IMPORT.changeText}
          </button>
        </div>
        <PackageReview
          key={review.key}
          projectId={projectId}
          kind="package"
          initialPreview={review.preview}
          conversation={review.conversation}
          checkedAt={review.at}
          back={back}
          onApply={onApply}
          onCheck={onCheck}
        />
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="panel stack">
        <div className="row">
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => onFile(e.target.files?.[0])}
            aria-label="Change package file"
          />
        </div>
        <textarea
          ref={textRef}
          aria-label="Change package text"
          spellCheck={false}
          className="mono"
          style={{ minHeight: "14rem" }}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder='{"format": "wordly.change-package", "formatVersion": 1, ...}'
        />
        <div>
          <button onClick={runValidate} disabled={pending || !raw.trim()} aria-busy={pending || undefined}>
            {pending ? PACKAGE_IMPORT.validating : PACKAGE_IMPORT.validate}
          </button>
        </div>
        {failed ? (
          <div className="banner error" role="alert">
            {PACKAGE_IMPORT.validateFailed}
          </div>
        ) : null}
      </div>
    </div>
  );
}
