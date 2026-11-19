"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ProtectionBadge, StatusBadge } from "@/components/Badges";
import { Button, ButtonLink } from "@/components/ui/Button";
import type { AuthorityStatus } from "@/domain/statuses";
import { BOOK_ORDER, WRITING } from "@/ui/labels";
import { formatWordCount } from "@/writing/wordCount";
import { moveInBookAction } from "./actions";

export interface OrderItem {
  id: string;
  title: string;
  words: number;
  authorityStatus: AuthorityStatus;
  isProtected: boolean;
}

export interface OrderChapter extends OrderItem {
  scenes: OrderItem[];
}

/** Chapters and their scenes in book order, with controls to move them. */
export function BookOrder({
  projectId,
  chapters,
  unplaced,
  bookWords,
}: {
  projectId: string;
  chapters: OrderChapter[];
  unplaced: OrderItem[];
  bookWords: number;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const href = (id: string) => `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(id)}`;

  const move = (item: OrderItem, parentRecordId: string | null, index: number) => {
    setMessage(null);
    startTransition(async () => {
      const result = await moveInBookAction(projectId, { recordId: item.id, parentRecordId, index });
      if (!result.ok) setMessage({ error: true, text: result.issues.map((i) => i.message).join(" ") });
      else if (result.moved) setMessage({ error: false, text: BOOK_ORDER.moved(item.title, result.position + 1, result.of) });
    });
  };
  const moveToChapter = (item: OrderItem) => (chapterId: string) => {
    const target = chapters.find((c) => c.id === chapterId);
    if (target) move(item, target.id, target.scenes.length);
  };

  return (
    <section className="panel book-order" aria-labelledby="book-order-heading">
      <h2 id="book-order-heading">{BOOK_ORDER.heading}</h2>
      <p className="small">
        {WRITING.bookCount}: <strong>{formatWordCount(bookWords)}</strong> <span className="muted">{WRITING.bookSavedNote}</span>
      </p>
      <p className="small muted">{BOOK_ORDER.note}</p>
      <p className={message?.error ? "small error-text" : "small"} role="status" aria-live="polite">
        {pending ? BOOK_ORDER.moving : (message?.text ?? "")}
      </p>
      {chapters.length === 0 ? (
        <p className="muted">{BOOK_ORDER.noChapters}</p>
      ) : (
        <ol className="book-order-list">
          {chapters.map((c, i) => (
            <li key={c.id}>
              <OrderRow
                item={c}
                href={href(c.id)}
                pending={pending}
                onUp={i > 0 ? () => move(c, null, i - 1) : null}
                onDown={i < chapters.length - 1 ? () => move(c, null, i + 1) : null}
              />
              {c.scenes.length ? (
                <ol className="book-order-scenes">
                  {c.scenes.map((s, j) => (
                    <li key={s.id}>
                      <OrderRow
                        item={s}
                        href={href(s.id)}
                        pending={pending}
                        onUp={j > 0 ? () => move(s, c.id, j - 1) : null}
                        onDown={j < c.scenes.length - 1 ? () => move(s, c.id, j + 1) : null}
                        otherChapters={chapters.filter((other) => other.id !== c.id)}
                        onMoveTo={moveToChapter(s)}
                      />
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {unplaced.length ? (
        <>
          <h3>{BOOK_ORDER.unplaced}</h3>
          <p className="small muted">{BOOK_ORDER.unplacedNote}</p>
          <ul className="book-order-scenes">
            {unplaced.map((s) => (
              <li key={s.id}>
                <OrderRow
                  item={s}
                  href={href(s.id)}
                  pending={pending}
                  onUp={null}
                  onDown={null}
                  otherChapters={chapters}
                  onMoveTo={moveToChapter(s)}
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function OrderRow({
  item,
  href,
  pending,
  onUp,
  onDown,
  otherChapters,
  onMoveTo,
}: {
  item: OrderItem;
  href: string;
  pending: boolean;
  onUp: (() => void) | null;
  onDown: (() => void) | null;
  otherChapters?: { id: string; title: string }[];
  onMoveTo?: (chapterId: string) => void;
}) {
  const [target, setTarget] = useState("");
  return (
    <div className="book-order-row">
      <Link href={href} className="book-order-title">
        {item.title}
      </Link>
      <span className="book-order-facts small">
        <StatusBadge status={item.authorityStatus} />
        <ProtectionBadge isProtected={item.isProtected} />
        <span className="muted">{formatWordCount(item.words)}</span>
      </span>
      <span className="book-order-actions">
        <ButtonLink size="sm" href={href}>
          {BOOK_ORDER.open}
        </ButtonLink>
        {onUp || onDown ? (
          <>
            <Button
              type="button"
              variant="secondary" size="sm"
              onClick={onUp ?? undefined}
              disabled={pending || !onUp}
              aria-label={BOOK_ORDER.moveUpLabel(item.title)}
            >
              {BOOK_ORDER.moveUp}
            </Button>
            <Button
              type="button"
              variant="secondary" size="sm"
              onClick={onDown ?? undefined}
              disabled={pending || !onDown}
              aria-label={BOOK_ORDER.moveDownLabel(item.title)}
            >
              {BOOK_ORDER.moveDown}
            </Button>
          </>
        ) : null}
        {otherChapters && otherChapters.length > 0 && onMoveTo ? (
          <span className="book-order-move">
            <select aria-label={BOOK_ORDER.moveToLabel(item.title)} value={target} onChange={(e) => setTarget(e.target.value)} disabled={pending}>
              <option value="">{BOOK_ORDER.chooseChapter}</option>
              {otherChapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="secondary" size="sm"
              disabled={pending || !target}
              onClick={() => {
                onMoveTo(target);
                setTarget("");
              }}
            >
              {BOOK_ORDER.moveTo}
            </Button>
          </span>
        ) : null}
      </span>
    </div>
  );
}
