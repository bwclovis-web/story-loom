"use client";

import { useActionState, useState, type ReactNode } from "react";
import type { Issue } from "@/domain/issues";
import { TRASH } from "@/ui/labels";
import { IssueList } from "./IssueList";

export interface ConfirmResult {
  ok: boolean;
  message?: string;
  issues?: Issue[];
}

function Result({ state }: { state: ConfirmResult }) {
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

/** A one-click action that shows why it failed, for actions that need no confirmation. */
export function ActionButton({
  action,
  label,
  pendingLabel,
  small = false,
}: {
  action: (prev: ConfirmResult, formData: FormData) => Promise<ConfirmResult>;
  label: string;
  pendingLabel: string;
  small?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: true });
  return (
    <form action={formAction} className="confirm-action">
      <button type="submit" className={small ? "small-button" : undefined} disabled={pending}>
        {pending ? pendingLabel : label}
      </button>
      <Result state={state} />
    </form>
  );
}

/**
 * A button that asks before it acts: the first click shows what will happen
 * and a second, explicit button that submits. Used for the Trash.
 */
export function ConfirmAction({
  action,
  label,
  confirmLabel,
  pendingLabel,
  details,
  unlockLabel,
  danger = true,
  small = false,
}: {
  action: (prev: ConfirmResult, formData: FormData) => Promise<ConfirmResult>;
  label: string;
  confirmLabel: string;
  pendingLabel: string;
  /** Shown while asking, above the confirm button. */
  details?: ReactNode;
  /** When set, a required tick box with this text, for protected records. */
  unlockLabel?: string;
  danger?: boolean;
  small?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: true });
  const [confirming, setConfirming] = useState(false);
  const size = small ? " small-button" : "";

  return (
    <form action={formAction} className="confirm-action">
      {confirming ? (
        <div className="stack">
          {details}
          {unlockLabel ? (
            <label className="inline small">
              <input type="checkbox" name="unlockProtected" required disabled={pending} /> {unlockLabel}
            </label>
          ) : null}
          <div className="row">
            <button type="submit" className={`${danger ? "danger" : ""}${size}`} disabled={pending}>
              {pending ? pendingLabel : confirmLabel}
            </button>
            <button type="button" className={`secondary${size}`} disabled={pending} onClick={() => setConfirming(false)}>
              {TRASH.cancel}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className={`secondary${size}`} onClick={() => setConfirming(true)}>
          {label}
        </button>
      )}
      <Result state={state} />
    </form>
  );
}
