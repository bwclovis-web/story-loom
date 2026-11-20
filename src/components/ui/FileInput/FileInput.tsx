"use client";

import { Upload } from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type Ref } from "react";
import { Button } from "@/components/ui/Button";
import { FILE } from "@/ui/labels";
import { fileInputNameClass, fileInputVariants } from "./fileInputVariants";

export type FileInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & {
  /** Visible field name. The button stays Choose file / Choose files. */
  label?: string;
  className?: string;
  ref?: Ref<HTMLInputElement>;
};

function assignRef(ref: Ref<HTMLInputElement> | undefined, node: HTMLInputElement | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

/** Shared file picker. The native control stays available to the form and to assistive tech. */
export function FileInput({ label, className, ref, multiple, disabled, id, onChange, ...props }: FileInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const labelId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [names, setNames] = useState<string[]>([]);
  const buttonLabel = multiple ? FILE.chooseFiles : FILE.chooseFile;

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const onReset = () => setNames([]);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  function change(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    setNames(files ? [...files].map((file) => file.name) : []);
    onChange?.(event);
  }

  return (
    <div className={fileInputVariants({ className })}>
      {label ? (
        <label className="basis-full" htmlFor={inputId} id={labelId}>
          {label}
        </label>
      ) : null}
      <input
        {...props}
        ref={(node) => {
          inputRef.current = node;
          assignRef(ref, node);
        }}
        id={inputId}
        className="sr-only"
        type="file"
        multiple={multiple}
        disabled={disabled}
        onChange={change}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        icon={<Upload strokeWidth={1.75} />}
        onClick={() => inputRef.current?.click()}
      >
        {buttonLabel}
      </Button>
      <span className={fileInputNameClass}>
        {names.length === 0 ? FILE.noFileChosen : names.length === 1 ? names[0] : FILE.filesChosen(names.length)}
      </span>
    </div>
  );
}
