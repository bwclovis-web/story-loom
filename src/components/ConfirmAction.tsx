"use client";

import { useActionState, useState, type ReactNode } from "react";
import type { Issue } from "@/domain/issues";
import { TRASH } from "@/ui/labels";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
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
        <Banner tone={state.ok ? "ok" : "error"} className="mb-0 mt-2.5">
          {state.message}
        </Banner>
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
      <Button type="submit" size={small ? "sm" : "md"} disabled={pending}>
        {pending ? pendingLabel : label}
      </Button>
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
  icon,
  className,
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
  /** Decorative icon before the label. The label stays the accessible name. */
  icon?: ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: true });
  const [confirming, setConfirming] = useState(false);
  const size = small ? "sm" : "md";

  return (
    <form action={formAction} className="confirm-action">
      {confirming ? (
        <div className="stack">
          {details}
          {unlockLabel ? (
            <Checkbox className="small" name="unlockProtected" required disabled={pending} label={unlockLabel} />
          ) : null}
          <div className="row">
            <Button type="submit" variant={danger ? "danger" : "primary"} size={size} disabled={pending}>
              {pending ? pendingLabel : confirmLabel}
            </Button>
            <Button type="button" variant="secondary" size={size} disabled={pending} onClick={() => setConfirming(false)}>
              {TRASH.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="secondary" size={size} className={className} icon={icon} onClick={() => setConfirming(true)}>
          {label}
        </Button>
      )}
      <Result state={state} />
    </form>
  );
}
