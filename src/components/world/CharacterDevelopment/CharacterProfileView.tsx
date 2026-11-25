"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  BEHAVIOR_TEXT_KEYS,
  CAPABILITIES_TEXT_KEYS,
  FOUNDATION_TEXT_KEYS,
  LIVED_EXPERIENCE_TEXT_KEYS,
  PROFILE_SECTIONS,
  PSYCHOLOGY_TEXT_KEYS,
  VOICE_TEXT_KEYS,
  normalizeImportance,
  sectionIsEmpty,
  type CharacterDevelopment,
  type ProfileSection,
} from "@/domain/characterDevelopment";
import { DocumentSectionNav } from "@/components/world/DocumentSectionNav";
import { CHARACTER_DEVELOPMENT as LABELS } from "@/ui/labels";
import { cn } from "@/ui/cn";

type CatalogChoice = { id: string; label: string };

type Fact = { key: string; label: string; value: string; long?: boolean };

function isLong(text: string): boolean {
  return text.includes("\n") || text.length > 80;
}

function textFacts(
  keys: readonly string[],
  labels: { readonly [key: string]: string },
  values: object,
  showEmpty: boolean,
): Fact[] {
  const record = values as Record<string, unknown>;
  return keys.flatMap((key) => {
    const raw = record[key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value && !showEmpty) return [];
    return [
      {
        key,
        label: labels[key] ?? key,
        value,
        long: value ? isLong(value) : false,
      },
    ];
  });
}

function FactList({ facts, showEmpty }: { facts: Fact[]; showEmpty: boolean }) {
  const visible = showEmpty ? facts : facts.filter((fact) => fact.value);
  if (!visible.length) return null;
  return (
    <dl className="world-profile-facts">
      {visible.map((fact) => (
        <div key={fact.key} className={cn("world-profile-fact", fact.long && "world-profile-fact-long")}>
          <dt>{fact.label}</dt>
          <dd>
            {fact.value ? (
              fact.long ? (
                <div className="world-profile-long-value">{fact.value}</div>
              ) : (
                fact.value
              )
            ) : (
              <span className="muted">{LABELS.notSet}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function labelOf(choices: CatalogChoice[], id: string | null | undefined): string | null {
  if (!id) return null;
  return choices.find((choice) => choice.id === id)?.label ?? id;
}

const TAB_LABELS: Record<ProfileSection, string> = {
  identity: LABELS.identityTab,
  psychology: LABELS.psychology,
  voice: LABELS.voiceTab,
  behavior: LABELS.behaviorTab,
  lived: LABELS.livedTab,
  relationships: LABELS.relationships,
  capabilities: LABELS.capabilitiesTab,
  development: LABELS.developmentTab,
  continuity: LABELS.continuityTab,
};

export function CharacterProfileView({
  profile,
  showEmpty,
  onToggleEmpty,
  catalog,
  projectId,
}: {
  profile: CharacterDevelopment;
  showEmpty: boolean;
  onToggleEmpty: () => void;
  catalog: {
    books: CatalogChoice[];
    characters: CatalogChoice[];
    worldRefs: CatalogChoice[];
  };
  projectId: string;
}) {
  const importance = normalizeImportance(profile.importance);
  const sections = useMemo(
    () => PROFILE_SECTIONS.filter((section) => showEmpty || !sectionIsEmpty(section, profile)),
    [profile, showEmpty],
  );
  const showNav = sections.length >= 2;
  const navHeadings = useMemo(
    () =>
      sections.map((section) => ({
        id: `character-profile-view-${section}`,
        level: 2,
        text: TAB_LABELS[section],
      })),
    [sections],
  );

  const renderSection = (section: ProfileSection) => {
    const id = `character-profile-view-${section}`;
    switch (section) {
      case "identity": {
        const facts: Fact[] = [
          ...(importance
            ? [{ key: "importance", label: LABELS.importance, value: LABELS.importanceLevels[importance] }]
            : showEmpty
              ? [{ key: "importance", label: LABELS.importance, value: "" }]
              : []),
          ...(profile.narrativeRole
            ? [
                {
                  key: "narrativeRole",
                  label: LABELS.narrativeRole,
                  value: profile.narrativeRole.replaceAll("_", " "),
                },
              ]
            : showEmpty
              ? [{ key: "narrativeRole", label: LABELS.narrativeRole, value: "" }]
              : []),
          ...textFacts(FOUNDATION_TEXT_KEYS, LABELS.foundationFields, profile.foundation, showEmpty),
        ];
        if (!facts.length && !showEmpty) return null;
        return (
          <section key={section} className="world-profile-group" aria-labelledby={id}>
            <h3 id={id} tabIndex={-1}>{TAB_LABELS[section]}</h3>
            <FactList facts={facts} showEmpty={showEmpty} />
          </section>
        );
      }
      case "psychology": {
        const psychFacts: Fact[] = [];
        if (profile.psychology.enneagram != null || showEmpty) {
          const raw = profile.psychology.enneagram;
          const value =
            raw == null
              ? ""
              : typeof raw === "number"
                ? String(raw)
                : raw.replaceAll("_", " ");
          const withWing =
            value && profile.psychology.wing != null ? `${value} · wing ${profile.psychology.wing}` : value;
          psychFacts.push({ key: "enneagram", label: LABELS.enneagram, value: withWing });
        }
        psychFacts.push(...textFacts(PSYCHOLOGY_TEXT_KEYS, LABELS.fields, profile.psychology, showEmpty));
        const archetypeLines = profile.archetypes.map((item) => {
          const period = item.periodLabel ? ` (${item.periodLabel})` : "";
          return `${item.rank}: ${item.name}${period}${item.evolutionNote ? ` — ${item.evolutionNote}` : ""}`;
        });
        const frameworkLines = profile.psychology.frameworks.map(
          (item) => `${item.name}${item.notes ? `: ${item.notes}` : ""}`,
        );
        if (
          !psychFacts.some((f) => f.value) &&
          !archetypeLines.length &&
          !frameworkLines.length &&
          !showEmpty
        ) {
          return null;
        }
        return (
          <section key={section} className="world-profile-group" aria-labelledby={id}>
            <h3 id={id} tabIndex={-1}>{TAB_LABELS[section]}</h3>
            <FactList facts={psychFacts} showEmpty={showEmpty} />
            {archetypeLines.length || showEmpty ? (
              <div className="stack" style={{ marginTop: "0.75rem" }}>
                <strong className="small">{LABELS.archetypes}</strong>
                {archetypeLines.length ? (
                  <ul>
                    {archetypeLines.map((line) => (
                      <li key={line} className="small">
                        {line}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="small muted">{LABELS.notSet}</p>
                )}
              </div>
            ) : null}
            {frameworkLines.length ? (
              <div className="stack" style={{ marginTop: "0.75rem" }}>
                <strong className="small">Frameworks</strong>
                <ul>
                  {frameworkLines.map((line) => (
                    <li key={line} className="small">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        );
      }
      case "voice": {
        const facts = textFacts(VOICE_TEXT_KEYS, LABELS.voiceFields, profile.voice, showEmpty);
        const bookBlocks = profile.bookVoices
          .map((book) => ({
            book,
            facts: textFacts(VOICE_TEXT_KEYS, LABELS.voiceFields, book.voice, showEmpty),
          }))
          .filter((block) => block.facts.some((f) => f.value) || showEmpty);
        if (!facts.some((f) => f.value) && !bookBlocks.length && !showEmpty) return null;
        return (
          <section key={section} className="world-profile-group" aria-labelledby={id}>
            <h3 id={id} tabIndex={-1}>{TAB_LABELS[section]}</h3>
            <FactList facts={facts} showEmpty={showEmpty} />
            {bookBlocks.map(({ book, facts: bookFacts }) => (
              <div key={book.projectId} className="stack" style={{ marginTop: "0.75rem" }}>
                <strong className="small">{labelOf(catalog.books, book.projectId) ?? book.projectId}</strong>
                <FactList facts={bookFacts} showEmpty={showEmpty} />
              </div>
            ))}
          </section>
        );
      }
      case "behavior": {
        const facts = textFacts(BEHAVIOR_TEXT_KEYS, LABELS.behaviorFields, profile.behavior, showEmpty);
        if (!facts.some((f) => f.value) && !showEmpty) return null;
        return (
          <section key={section} className="world-profile-group" aria-labelledby={id}>
            <h3 id={id} tabIndex={-1}>{TAB_LABELS[section]}</h3>
            <FactList facts={facts} showEmpty={showEmpty} />
          </section>
        );
      }
      case "lived": {
        const facts = textFacts(LIVED_EXPERIENCE_TEXT_KEYS, LABELS.livedFields, profile.livedExperience, showEmpty);
        if (!facts.some((f) => f.value) && !showEmpty) return null;
        return (
          <section key={section} className="world-profile-group" aria-labelledby={id}>
            <h3 id={id} tabIndex={-1}>{TAB_LABELS[section]}</h3>
            <FactList facts={facts} showEmpty={showEmpty} />
          </section>
        );
      }
      case "capabilities": {
        const facts = textFacts(CAPABILITIES_TEXT_KEYS, LABELS.capabilitiesFields, profile.capabilities, showEmpty);
        const links = profile.capabilities.linkedRecordIds;
        if (!facts.some((f) => f.value) && !links.length && !showEmpty) return null;
        return (
          <section key={section} className="world-profile-group" aria-labelledby={id}>
            <h3 id={id} tabIndex={-1}>{TAB_LABELS[section]}</h3>
            <FactList facts={facts} showEmpty={showEmpty} />
            {links.length || showEmpty ? (
              <div className="stack" style={{ marginTop: "0.75rem" }}>
                <strong className="small">Linked references</strong>
                {links.length ? (
                  <ul className="world-profile-ref-list">
                    {links.map((recordId) => (
                      <li key={recordId}>
                        <Link href={`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(recordId)}`}>
                          {labelOf(catalog.worldRefs, recordId) ?? recordId}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="small muted">{LABELS.notSet}</p>
                )}
              </div>
            ) : null}
          </section>
        );
      }
      case "relationships":
      case "development": {
        const arcs =
          section === "relationships"
            ? profile.arcs.filter(
                (arc) => arc.template === "relationship" || arc.relationId || arc.perceptions.length > 0,
              )
            : profile.arcs;
        if (!arcs.length && !showEmpty) return null;
        return (
          <section key={section} className="world-profile-group" aria-labelledby={id}>
            <h3 id={id} tabIndex={-1}>{TAB_LABELS[section]}</h3>
            {arcs.length ? (
              <ul>
                {arcs.map((arc) => (
                  <li key={arc.id} className="small">
                    <strong>{arc.title || "Untitled arc"}</strong>
                    {` (${arc.template.replaceAll("_", " ")}, ${arc.approval}, ${arc.movement})`}
                    {arc.description.trim() ? (
                      <div className="world-profile-long-value muted">{arc.description}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">{LABELS.notSet}</p>
            )}
          </section>
        );
      }
      case "continuity": {
        const knowledge = profile.knowledge;
        const changes = profile.stateChanges;
        if (!knowledge.length && !changes.length && !profile.bookStates.length && !showEmpty) return null;
        return (
          <section key={section} className="world-profile-group" aria-labelledby={id}>
            <h3 id={id} tabIndex={-1}>{TAB_LABELS[section]}</h3>
            {knowledge.length ? (
              <div className="stack">
                <strong className="small">Knowledge</strong>
                <ul>
                  {knowledge.map((item) => (
                    <li key={item.id} className="small">
                      {item.kind}: {item.statement}
                    </li>
                  ))}
                </ul>
              </div>
            ) : showEmpty ? (
              <p className="small muted">{LABELS.notSet}</p>
            ) : null}
            {changes.length ? (
              <div className="stack" style={{ marginTop: "0.75rem" }}>
                <strong className="small">State changes</strong>
                <ul>
                  {changes.map((item) => (
                    <li key={item.id} className="small">
                      {item.facet}: {item.presence === "set" ? item.text || LABELS.notSet : item.presence}
                      {item.planned ? " (planned)" : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className={cn("world-profile-view-layout", showNav && "has-nav")}>
      {showNav ? <DocumentSectionNav headings={navHeadings} title={LABELS.sectionsNav} /> : null}
      <div className="world-profile-view-body stack">
        {sections.map((section) => renderSection(section))}
        <button
          type="button"
          className="world-profile-empty-toggle"
          aria-expanded={showEmpty}
          onClick={onToggleEmpty}
        >
          {showEmpty ? LABELS.hideEmptyFields : LABELS.showEmptyFields}
        </button>
        <p className="small muted world-profile-footnote">{LABELS.profileSeparateNote}</p>
      </div>
    </div>
  );
}
