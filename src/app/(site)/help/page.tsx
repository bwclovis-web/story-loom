import type { Metadata } from "next";
import Link from "next/link";
import { HelpContent } from "@/help/HelpContent";
import { HELP_SECTIONS } from "@/help/outline";
import { NAV } from "@/ui/labels";

export const metadata: Metadata = { title: `${NAV.help} · ${NAV.brand}` };

export default function HelpPage() {
  return (
    <>
      <p className="help-back">
        <Link href="/">&larr; Back to workspaces</Link>
      </p>
      <h1>{NAV.help}</h1>
      <p className="muted">Practical steps for the parts of {NAV.brand} that work today.</p>
      <div className="help">
        <nav id="contents" aria-labelledby="contents-heading" className="panel help-toc">
          <h2 id="contents-heading">Contents</h2>
          <ol>
            {HELP_SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
                {"children" in s ? (
                  <ol>
                    {s.children.map((c) => (
                      <li key={c.id}>
                        <a href={`#${c.id}`}>{c.title}</a>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </li>
            ))}
          </ol>
        </nav>
        <HelpContent />
      </div>
      <p className="help-back">
        <Link href="/">&larr; Back to workspaces</Link>
      </p>
    </>
  );
}
