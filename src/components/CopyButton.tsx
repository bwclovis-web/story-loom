"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  };
  return (
    <span className="row">
      <Button variant="secondary" size="sm" onClick={copy}>
        {state === "copied" ? "Copied" : label}
      </Button>
      <span className="small muted" aria-live="polite">
        {state === "failed" ? "Could not copy. Select the text above and copy it yourself." : ""}
      </span>
    </span>
  );
}
