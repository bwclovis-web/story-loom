import Link from "next/link";
import { HelpHint } from "@/components/HelpHint";
import { Banner } from "@/components/ui/Banner";
import { inspectAdapter, inspectAssistant, type ConnectionState } from "@/mcp/status";
import { resolveAssistantEnv } from "@/server/assistantSecrets";
import { getDb } from "@/server/db";
import { readGrantSettings } from "@/server/services/grantSettingsService";
import { listWorkspacesWithProjects } from "@/server/services/projectService";
import { CONNECTIONS, connectionStateLabel, NAV } from "@/ui/labels";
import { GrantSettingsForm } from "./GrantSettingsForm";

export const dynamic = "force-dynamic";

function badgeClass(state: ConnectionState | "not_configured" | "connection_not_verified"): string {
  if (state === "local_adapter_ready") return "badge proposed";
  if (state === "connection_not_verified") return "badge unresolved";
  return "badge";
}

function State({ state }: { state: ConnectionState | "not_configured" | "connection_not_verified" }) {
  return <span className={badgeClass(state)}>{connectionStateLabel(state)}</span>;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function Facts({ heading, items }: { heading: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <h3>{heading}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  );
}

export default async function ConnectionsPage() {
  const db = getDb();
  const assistantEnv = resolveAssistantEnv(process.env);
  const [assistant, adapter, grantSettings, workspaces] = await Promise.all([
    Promise.resolve(inspectAssistant(assistantEnv)),
    inspectAdapter(db, process.env, process.cwd()),
    readGrantSettings(process.env, process.cwd()),
    listWorkspacesWithProjects(db),
  ]);
  const grantLoad = grantSettings.load;
  const grantUnreadable = !grantLoad.ok && grantLoad.reason !== "missing";

  return (
    <>
      <h1>{CONNECTIONS.heading}</h1>
      <HelpHint anchor="chatgpt-direct" topic="the ChatGPT connection">
        These states describe checks made on this computer. A saved setting or a running command is not treated as a live connection.
      </HelpHint>

      <section className="panel" aria-labelledby="assistant-connection">
        <h2 id="assistant-connection">{CONNECTIONS.assistantHeading}</h2>
        <p>
          <State state={assistant.state} />
        </p>
        <p className="small muted">
          The assistant sends only the context you select from a project. It is separate from the ChatGPT connection and does not use it.{" "}
          <Link href="/settings">{CONNECTIONS.openSettings}</Link>.
        </p>
        <Facts heading={CONNECTIONS.checked} items={assistant.checked} />
        <Facts heading={CONNECTIONS.notChecked} items={assistant.notChecked} />
      </section>

      <section className="panel" aria-labelledby="chatgpt-connection">
        <h2 id="chatgpt-connection">{CONNECTIONS.chatgptHeading}</h2>
        <h3>{CONNECTIONS.localAdapter}</h3>
        <p>
          <State state={adapter.local.state} />
        </p>
        <h3>{CONNECTIONS.chatgpt}</h3>
        <p>
          <State state={adapter.chatgpt.state} />
        </p>
        {adapter.grant ? (
          <p className="small muted">
            Grant “{adapter.grant.label}”. {adapter.grant.projectCount} permitted project
            {adapter.grant.projectCount === 1 ? "" : "s"}.{" "}
            {adapter.grant.manuscriptRead ? "Manuscript access is on." : "Manuscript access is off."} Permissions: read.
          </p>
        ) : null}
        <Facts heading={CONNECTIONS.checked} items={unique([...adapter.local.checked, ...adapter.chatgpt.checked])} />
        <Facts heading={CONNECTIONS.notChecked} items={unique([...adapter.local.notChecked, ...adapter.chatgpt.notChecked])} />
        {adapter.local.state === "local_adapter_ready" ? (
          <>
            <h3>{CONNECTIONS.permittedProjects}</h3>
            {adapter.projects.length === 0 ? (
              <p>list_projects returned no projects. The grant does not currently allow any project.</p>
            ) : (
              <ul>
                {adapter.projects.map((project) => (
                  <li key={project.id}>
                    {project.title} <span className="muted small">{project.workspaceName}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
        <h3>{CONNECTIONS.grantHeading}</h3>
        <p className="small muted">
          {CONNECTIONS.grantIntro} <code>{grantSettings.filePath}</code>
        </p>
        {grantSettings.disabledByEnvironment ? <Banner tone="warn">{CONNECTIONS.grantDisabledByEnv}</Banner> : null}
        {grantUnreadable ? (
          <Banner tone="error">
            {CONNECTIONS.grantFileInvalid}
            <ul>
              {grantLoad.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Banner>
        ) : (
          <GrantSettingsForm
            workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, projects: w.projects.map((p) => ({ id: p.id, title: p.title })) }))}
            active={grantLoad.ok ? grantLoad.grant.status === "active" : false}
            projectIds={grantLoad.ok ? [...grantLoad.grant.projectIds] : []}
            manuscriptRead={grantLoad.ok ? grantLoad.grant.manuscriptRead : false}
          />
        )}
        <p>{CONNECTIONS.cannotSave}</p>
        <p className="small muted">
          To review a set of updates and apply them together, open a project and choose {NAV.importPackage}. ChatGPT cannot
          save records through this connection.
        </p>
      </section>
    </>
  );
}
