import Link from "next/link";
import { helpHref, type HelpAnchor } from "@/help/outline";

/** One-line explanation beside a control, linking to the matching "How to use" section. */
export function HelpHint({ anchor, topic, children }: { anchor: HelpAnchor; topic: string; children: React.ReactNode }) {
  return (
    <p className="hint">
      {children} <Link href={helpHref(anchor)}>More about {topic}</Link>
    </p>
  );
}
