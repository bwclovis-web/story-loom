"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Atoms/Button";
import type { PromptPresetSurface } from "@/domain/promptPreset";
import { PROMPT_PRESET_SURFACES } from "@/domain/promptPreset";
import type { Issue } from "@/domain/issues";
import type { PromptPresetView } from "@/server/services/promptPresetService";
import { PROMPT_PRESETS } from "@/ui/labels";
import { createPromptPresetAction, deletePromptPresetAction } from "./promptPresetActions";

const SURFACE_LABEL: Record<PromptPresetSurface, string> = {
  selection: PROMPT_PRESETS.surfaceSelection,
  chat: PROMPT_PRESETS.surfaceChat,
  beat: PROMPT_PRESETS.surfaceBeat,
};

export function PromptPresetsPanel({ projectId, presets }: { projectId: string; presets: PromptPresetView[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [surface, setSurface] = useState<PromptPresetSurface>("chat");
  const [instructionText, setInstructionText] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [createPending, startCreate] = useTransition();
  const [deletePending, startDelete] = useTransition();

  const grouped = PROMPT_PRESET_SURFACES.map((s) => ({
    surface: s,
    items: presets.filter((p) => p.surface === s),
  }));

  return (
    <section className="stack panel" aria-labelledby="prompt-presets-heading">
      <h2 id="prompt-presets-heading" style={{ marginTop: 0 }}>
        {PROMPT_PRESETS.manageHeading}
      </h2>
      <p className="small muted">{PROMPT_PRESETS.manageLead}</p>
      {banner ? <Banner tone="ok">{banner}</Banner> : null}

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          setBanner(null);
          setIssues([]);
          startCreate(async () => {
            const result = await createPromptPresetAction(projectId, { title, surface, instructionText });
            if (!result.ok) {
              setIssues(result.issues ?? []);
              return;
            }
            setTitle("");
            setInstructionText("");
            setBanner(result.message ?? PROMPT_PRESETS.created);
            router.refresh();
          });
        }}
      >
        <h3 className="small" style={{ margin: 0 }}>
          {PROMPT_PRESETS.new}
        </h3>
        <label>
          {PROMPT_PRESETS.name}
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} />
        </label>
        <label>
          {PROMPT_PRESETS.surface}
          <select value={surface} onChange={(e) => setSurface(e.target.value as PromptPresetSurface)}>
            {PROMPT_PRESET_SURFACES.map((s) => (
              <option key={s} value={s}>
                {SURFACE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {PROMPT_PRESETS.instructions}
          <textarea
            value={instructionText}
            onChange={(e) => setInstructionText(e.target.value)}
            required
            rows={4}
            maxLength={4000}
          />
        </label>
        <IssueList issues={issues} />
        <Button type="submit" disabled={createPending}>
          {PROMPT_PRESETS.save}
        </Button>
      </form>

      {grouped.map(({ surface: s, items }) =>
        items.length ? (
          <div key={s} className="stack">
            <h3 className="small" style={{ margin: 0 }}>
              {SURFACE_LABEL[s]}
            </h3>
            <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {items.map((p) => (
                <li key={p.id} className="row panel" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div className="stack" style={{ flex: 1 }}>
                    <strong>{p.title}</strong>
                    <p className="small muted" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                      {p.instructionText.length > 240 ? `${p.instructionText.slice(0, 240)}…` : p.instructionText}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={deletePending}
                    onClick={() => {
                      if (!window.confirm(PROMPT_PRESETS.deleteConfirm(p.title))) return;
                      setBanner(null);
                      startDelete(async () => {
                        const result = await deletePromptPresetAction(projectId, p.id);
                        if (!result.ok) {
                          setIssues(result.issues ?? []);
                          return;
                        }
                        setBanner(result.message ?? PROMPT_PRESETS.deleted);
                        router.refresh();
                      });
                    }}
                  >
                    {PROMPT_PRESETS.delete}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      {!presets.length ? <p className="small muted">{PROMPT_PRESETS.empty}</p> : null}
    </section>
  );
}