"use client";

import Link from "next/link";
import { ChevronRightIcon, SearchIcon } from "@/components/shell/icons";
import type { ConversationListItem } from "@/server/services/assistantService";
import { ASSISTANT } from "@/ui/labels";
import { NewConversationButton } from "./ConversationControls";

export function AssistantConversationToolbar({
  projectId,
  conversations,
  activeId,
  search,
  onSearch,
  filtered,
  homeHref,
}: {
  projectId: string;
  conversations: ConversationListItem[];
  activeId: string;
  search: string;
  onSearch: (v: string) => void;
  filtered: ConversationListItem[];
  homeHref: string;
}) {
  const base = `${homeHref}/assistant`;

  return (
    <div className="assistant-conversation-toolbar">
      <div className="assistant-conversation-toolbar-main">
        <label className="assistant-conversation-select">
          <span className="sr-only">{ASSISTANT.conversations}</span>
          <select
            value={activeId}
            onChange={(e) => {
              const id = e.target.value;
              if (id) window.location.assign(`${base}?c=${encodeURIComponent(id)}`);
            }}
          >
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <NewConversationButton projectId={projectId} />
        <Link href={`${homeHref}/assistant`} className="assistant-home-link linkish">
          {ASSISTANT.assistantHomeLink}
          <ChevronRightIcon />
        </Link>
      </div>
      <label className="assistant-conversation-search">
        <SearchIcon />
        <span className="sr-only">{ASSISTANT.searchConversations}</span>
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={ASSISTANT.searchConversations}
          autoComplete="off"
          list="assistant-conversation-search-suggestions"
        />
        <datalist id="assistant-conversation-search-suggestions">
          {filtered.map((c) => (
            <option key={c.id} value={c.title} />
          ))}
        </datalist>
      </label>
      {search.trim() && filtered.length > 0 ? (
        <ul className="assistant-conversation-toolbar-matches">
          {filtered.slice(0, 8).map((c) => (
            <li key={c.id}>
              <Link href={`${base}?c=${encodeURIComponent(c.id)}`}>{c.title}</Link>
            </li>
          ))}
        </ul>
      ) : search.trim() && filtered.length === 0 ? (
        <p className="small muted">{ASSISTANT.noConversationMatches}</p>
      ) : null}
    </div>
  );
}