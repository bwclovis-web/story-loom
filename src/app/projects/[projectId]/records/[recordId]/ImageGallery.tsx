"use client";

import { useActionState, useRef, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { HelpHint } from "@/components/HelpHint";
import { IssueList } from "@/components/IssueList";
import {
  formatBytes,
  IMAGE_ACCEPT,
  IMAGE_FORMAT_LABELS,
  imageMarkdown,
  MAX_ALT_CHARS,
  MAX_CAPTION_CHARS,
  MAX_IMAGE_BYTES,
  PDF_IMAGE_TYPES,
  type ImageMimeType,
} from "@/images/imageFormat";
import { IMAGES, RECORD } from "@/ui/labels";
import type { FormResult } from "../../actions";
import { addImagesAction, removeImageAction, updateImageAction } from "./imageActions";

export interface GalleryImage {
  id: string;
  name: string;
  src: string;
  mimeType: ImageMimeType;
  byteSize: number;
  width: number;
  height: number;
  caption: string;
  altText: string;
}

function Result({ state }: { state: FormResult }) {
  return (
    <>
      {state.message ? (
        <div className={`banner ${state.ok ? "ok" : "error"}`} role="status">
          {state.message}
        </div>
      ) : null}
      <IssueList issues={state.issues ?? []} />
    </>
  );
}

function Unlock({ isProtected }: { isProtected: boolean }) {
  if (!isProtected) return null;
  return (
    <label className="inline">
      <input type="checkbox" name="unlockProtected" />
      {RECORD.unlockProtected}
    </label>
  );
}

function AddImages({ projectId, recordId, isProtected }: { projectId: string; recordId: string; isProtected: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<FormResult, FormData>(async (prev, formData) => {
    const result = await addImagesAction(projectId, recordId, prev, formData);
    if (result.ok) formRef.current?.reset();
    return result;
  }, { ok: true });
  const formats = Object.values(IMAGE_FORMAT_LABELS).join(", ");
  return (
    <form ref={formRef} action={action} className="stack image-add">
      <label>
        {IMAGES.chooseFiles}
        <input type="file" name="images" accept={IMAGE_ACCEPT} multiple required />
      </label>
      <p className="small muted">{IMAGES.formats(formats, formatBytes(MAX_IMAGE_BYTES))}</p>
      <Unlock isProtected={isProtected} />
      <Result state={state} />
      <div className="row">
        <button type="submit" disabled={pending}>
          {pending ? IMAGES.adding : IMAGES.add}
        </button>
      </div>
    </form>
  );
}

function ImageCard({
  projectId,
  recordId,
  image,
  inText,
  isProtected,
}: {
  projectId: string;
  recordId: string;
  image: GalleryImage;
  inText: boolean;
  isProtected: boolean;
}) {
  const [saveState, save, saving] = useActionState<FormResult, FormData>(updateImageAction.bind(null, projectId, recordId, image.id), {
    ok: true,
  });
  const [confirming, setConfirming] = useState(false);
  const [removeState, remove, removing] = useActionState<FormResult, FormData>(
    removeImageAction.bind(null, projectId, recordId, image.id),
    { ok: true },
  );
  const reference = imageMarkdown(image.name, image.caption || image.altText);
  const pdfOk = PDF_IMAGE_TYPES.includes(image.mimeType);
  return (
    <li className="image-card">
      <a href={image.src} target="_blank" rel="noopener" className="image-thumb" aria-label={IMAGES.open(image.name)}>
        <img src={image.src} alt={image.altText || image.caption || ""} width={image.width} height={image.height} loading="lazy" decoding="async" />
      </a>
      <div className="image-meta">
        <div className="row">
          <code>{image.name}</code>
          {inText ? <span className="badge type">{IMAGES.inText}</span> : null}
        </div>
        {image.caption ? <p className="image-caption">{image.caption}</p> : <p className="small muted">{IMAGES.noCaption}</p>}
        <p className="small muted">
          {IMAGE_FORMAT_LABELS[image.mimeType]} · {image.width} × {image.height} · {formatBytes(image.byteSize)}
          {pdfOk ? "" : ` · ${IMAGES.pdfNote(PDF_IMAGE_TYPES.map((t) => IMAGE_FORMAT_LABELS[t]).join(" and "))}`}
        </p>
        <CopyButton text={reference} label={IMAGES.copyReference} />
        <details className="image-edit">
          <summary>{IMAGES.details}</summary>
          <form action={save} className="stack">
            <label>
              {IMAGES.caption}
              <input type="text" name="caption" defaultValue={image.caption} maxLength={MAX_CAPTION_CHARS} />
            </label>
            <label>
              {IMAGES.altText}
              <input type="text" name="altText" defaultValue={image.altText} maxLength={MAX_ALT_CHARS} aria-describedby={`alt-hint-${image.id}`} />
            </label>
            <span className="small muted" id={`alt-hint-${image.id}`}>
              {IMAGES.altHint}
            </span>
            <Unlock isProtected={isProtected} />
            <Result state={saveState} />
            <div className="row">
              <button type="submit" className="secondary" disabled={saving}>
                {IMAGES.save}
              </button>
            </div>
          </form>
          <form action={remove} className="stack image-remove">
            {inText ? (
              <p className="small">{IMAGES.removeBlocked}</p>
            ) : (
              <>
                <p className="small muted">{IMAGES.removeNote}</p>
                <Unlock isProtected={isProtected} />
              </>
            )}
            <Result state={removeState} />
            {confirming && !inText ? (
              <div className="row">
                <button type="submit" className="danger" disabled={removing}>
                  {IMAGES.confirmRemove(image.name)}
                </button>
                <button type="button" className="secondary" disabled={removing} onClick={() => setConfirming(false)}>
                  {IMAGES.cancel}
                </button>
              </div>
            ) : (
              <div className="row">
                <button type="button" className="secondary" disabled={inText} onClick={() => setConfirming(true)}>
                  {IMAGES.remove}
                </button>
              </div>
            )}
          </form>
        </details>
      </div>
    </li>
  );
}

export function ImageGallery({
  projectId,
  recordId,
  images,
  namesInText,
  isProtected,
  unavailable,
}: {
  projectId: string;
  recordId: string;
  images: GalleryImage[];
  namesInText: string[];
  isProtected: boolean;
  /** The database has not been migrated to include images yet. */
  unavailable: boolean;
}) {
  const attached = new Set(images.map((i) => i.name));
  const missing = namesInText.filter((n) => !attached.has(n));
  return (
    <section className="panel reference-images" id="images" aria-labelledby="images-heading">
      <h2 id="images-heading">
        {IMAGES.heading} <span className="count">({images.length})</span>
      </h2>
      {unavailable ? (
        <p className="banner warn">{IMAGES.migrationNeeded}</p>
      ) : (
        <>
          <HelpHint anchor="images" topic="images">
            {IMAGES.note}
          </HelpHint>
          {images.length ? (
            <ul className="image-gallery">
              {images.map((image) => (
                <ImageCard
                  key={image.id}
                  projectId={projectId}
                  recordId={recordId}
                  image={image}
                  inText={namesInText.includes(image.name)}
                  isProtected={isProtected}
                />
              ))}
            </ul>
          ) : (
            <p className="small muted">{IMAGES.none}</p>
          )}
          {missing.length ? (
            <div className="image-missing-list">
              <h3>{IMAGES.missingHeading}</h3>
              <p className="small">{IMAGES.missing}</p>
              <ul>
                {missing.map((n) => (
                  <li key={n}>
                    <code>image:{n}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <AddImages projectId={projectId} recordId={recordId} isProtected={isProtected} />
        </>
      )}
    </section>
  );
}
