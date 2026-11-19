import type { FormEventHandler, ReactNode } from "react";
import { SearchIcon } from "@/components/shell/icons";
import { cn } from "@/ui/cn";

type CommonProps = {
  action: string;
  label: string;
  name?: string;
  placeholder?: string;
  className?: string;
};

/** Page-level search panel (World hub, Write manuscript search). */
export function SearchPanel({
  action,
  label,
  name = "q",
  placeholder,
  submitLabel,
  hint,
  inputId,
  defaultValue,
  visibleLabel = false,
  children,
  className,
}: CommonProps & {
  submitLabel: string;
  hint?: string;
  inputId: string;
  defaultValue?: string;
  /** Show a visible label above the field (World hub). */
  visibleLabel?: boolean;
  /** Extra controls before submit (e.g. match-case checkbox). */
  children?: ReactNode;
}) {
  return (
    <form role="search" method="get" action={action} className={cn("panel", className)} aria-label={label}>
      {visibleLabel ? (
        <label htmlFor={inputId}>{label}</label>
      ) : (
        <label className="sr-only" htmlFor={inputId}>
          {label}
        </label>
      )}
      {visibleLabel ? (
        <div className="row">
          <input id={inputId} type="search" name={name} placeholder={placeholder ?? label} defaultValue={defaultValue} />
          {children}
          <button type="submit">{submitLabel}</button>
        </div>
      ) : (
        <>
          <input id={inputId} type="search" name={name} placeholder={placeholder ?? label} defaultValue={defaultValue} />
          {children}
          <button type="submit">{submitLabel}</button>
        </>
      )}
      {hint ? <p className="small muted">{hint}</p> : null}
    </form>
  );
}

/** Column / nav search with icon (WorldNav, ManuscriptTree). */
export function TreeSearch({
  action,
  label,
  name = "q",
  placeholder,
  value,
  onChange,
  hint,
  hintId,
  className,
  onSubmit,
}: CommonProps & {
  value: string;
  onChange: (value: string) => void;
  hint: string;
  hintId: string;
  onSubmit?: FormEventHandler<HTMLFormElement>;
}) {
  return (
    <form role="search" method="get" action={action} className={className} aria-label={label} onSubmit={onSubmit}>
      <label className="tree-search">
        <span className="sr-only">{label}</span>
        <SearchIcon />
        <input
          type="search"
          name={name}
          placeholder={placeholder ?? label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={hintId}
        />
      </label>
      <p className="tree-note world-search-hint" id={hintId}>
        {hint}
      </p>
    </form>
  );
}
