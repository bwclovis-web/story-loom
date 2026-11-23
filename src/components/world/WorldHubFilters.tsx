import Link from "next/link";
import { AUTHORITY_STATUSES } from "@/domain/statuses";
import { WORLD } from "@/ui/labels";
import { WORLD_CATEGORY_LABELS, WORLD_TYPES, worldHref, type WorldType } from "@/ui/world";
import { getTaxonomyCategory, WORLD_TAXONOMY_CATEGORIES } from "@/world/taxonomy";
import type { WorldHubQuery } from "@/world/hubDiscovery";
import { worldHubHref } from "@/world/hubDiscovery";

/** Combined discovery filters. Each control is a GET link so browser history works. */
export function WorldHubFilters({
  projectId,
  query,
  tags,
}: {
  projectId: string;
  query: WorldHubQuery;
  tags: readonly string[];
}) {
  const category = query.category ? getTaxonomyCategory(query.category) : null;
  const withBase = (patch: Partial<WorldHubQuery>) =>
    worldHubHref(projectId, {
      ...query,
      list: true,
      ...patch,
    });

  return (
    <form className="world-hub-filters panel" method="get" action={worldHref(projectId)}>
      <input type="hidden" name="list" value="1" />
      {query.q ? <input type="hidden" name="q" value={query.q} /> : null}
      <div className="world-hub-filter-grid">
        <label>
          {WORLD.filterCategory}
          <select name="category" defaultValue={query.category ?? ""}>
            <option value="">{WORLD.filterAny}</option>
            {WORLD_TAXONOMY_CATEGORIES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {WORLD.filterSubcategory}
          <select name="subcategory" defaultValue={query.subcategory ?? ""} disabled={!category}>
            <option value="">{WORLD.filterAny}</option>
            {(category?.subcategories ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {WORLD.filterDocumentType}
          <select name="type" defaultValue={query.type ?? ""}>
            <option value="">{WORLD.filterAny}</option>
            {WORLD_TYPES.map((type) => (
              <option key={type} value={type}>
                {WORLD_CATEGORY_LABELS[type as WorldType]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {WORLD.filterTag}
          <select name="tag" defaultValue={query.tag ?? ""}>
            <option value="">{WORLD.filterAny}</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>
        <label>
          {WORLD.filterScope}
          <select name="scope" defaultValue={query.scope ?? ""}>
            <option value="">{WORLD.filterAny}</option>
            <option value="book">{WORLD.scopeBook}</option>
            <option value="series">{WORLD.scopeSeries}</option>
            <option value="unset">{WORLD.scopeUnset}</option>
          </select>
        </label>
        <label>
          {WORLD.filterStatus}
          <select name="status" defaultValue={query.status ?? ""}>
            <option value="">{WORLD.filterAny}</option>
            {AUTHORITY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label>
          {WORLD.filterProtected}
          <select name="protected" defaultValue={query.protected ?? ""}>
            <option value="">{WORLD.filterAny}</option>
            <option value="yes">{WORLD.protectedYes}</option>
            <option value="no">{WORLD.protectedNo}</option>
          </select>
        </label>
        <label>
          {WORLD.filterSort}
          <select name="sort" defaultValue={query.sort}>
            <option value="updated">{WORLD.sortUpdated}</option>
            <option value="created">{WORLD.sortCreated}</option>
            <option value="title">{WORLD.sortTitle}</option>
          </select>
        </label>
        <label>
          {WORLD.filterView}
          <select name="view" defaultValue={query.view}>
            <option value="list">{WORLD.viewList}</option>
            <option value="cards">{WORLD.viewCards}</option>
          </select>
        </label>
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
        <button type="submit" className="sl-btn">
          {WORLD.search}
        </button>
        <Link href={worldHref(projectId)}>{WORLD.clearFilters}</Link>
        <Link href={withBase({ view: query.view === "cards" ? "list" : "cards" })}>
          {query.view === "cards" ? WORLD.viewList : WORLD.viewCards}
        </Link>
      </div>
    </form>
  );
}
