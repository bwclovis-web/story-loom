"use client";

import { MarkdownView } from "@/components/MarkdownView";
import { parseMarkdown } from "@/writing/markdownParse";

/** Safely rendered assistant Markdown; blockquotes use document serif. */
export function AssistantAnswer({ text, className = "" }: { text: string; className?: string }) {
  if (!text.trim()) return <em className="muted">(no text)</em>;
  return (
    <div className={`assistant-answer ${className}`.trim()}>
      <MarkdownView doc={parseMarkdown(text)} className="assistant-md" />
    </div>
  );
}
