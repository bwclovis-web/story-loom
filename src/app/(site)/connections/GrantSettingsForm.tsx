"use client";

import { useActionState } from "react";
import { submitWithoutReset } from "@/components/submitWithoutReset";
import { CONNECTIONS } from "@/ui/labels";
import { saveGrantSettingsAction } from "./actions";

export interface GrantFormWorkspace {
  id: string;
  name: string;
  projects: { id: string; title: string }[];
}

export function GrantSettingsForm({
  workspaces,
  active,
  projectIds,
  manuscriptRead,
}: {
  workspaces: GrantFormWorkspace[];
  active: boolean;
  projectIds: string[];
  manuscriptRead: boolean;
}) {
  const [state, dispatch, pending] = useActionState(saveGrantSettingsAction, null);
  const allowed = new Set(projectIds);

  return (
    <form onSubmit={submitWithoutReset(dispatch)} className="stack grant-settings">
      <label className="inline">
        <input type="checkbox" name="active" defaultChecked={active} /> <strong>{CONNECTIONS.grantActive}</strong>
      </label>
      <p className="small muted">{CONNECTIONS.grantActiveHint}</p>

      <fieldset>
        <legend>{CONNECTIONS.grantProjects}</legend>
        {workspaces.every((w) => w.projects.length === 0) ? <p className="muted">{CONNECTIONS.grantNoProjects}</p> : null}
        {workspaces
          .filter((w) => w.projects.length > 0)
          .map((w) => (
            <div key={w.id} className="grant-workspace">
              <p className="small muted">{w.name}</p>
              {w.projects.map((p) => (
                <label key={p.id} className="inline">
                  <input type="checkbox" name="projectId" value={p.id} defaultChecked={allowed.has(p.id)} /> {p.title}
                </label>
              ))}
            </div>
          ))}
      </fieldset>

      <label className="inline">
        <input type="checkbox" name="manuscriptRead" defaultChecked={manuscriptRead} /> {CONNECTIONS.grantManuscript}
      </label>
      <p className="small muted">{CONNECTIONS.grantManuscriptHint}</p>

      <div className="row">
        <button type="submit" disabled={pending}>
          {pending ? CONNECTIONS.grantSaving : CONNECTIONS.grantSave}
        </button>
      </div>
      {state ? (
        <div className={`banner ${state.ok ? "ok" : "error"}`} role="status">
          {state.message}
        </div>
      ) : null}
    </form>
  );
}
