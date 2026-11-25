import { AUTHORITY_STATUSES } from "@/domain/statuses";
import { WORLD } from "@/ui/labels";
import { WORLD_CATEGORY_LABELS, WORLD_TYPES, worldHref, type WorldType } from "@/ui/world";
import { getTaxonomyCategory, WORLD_TAXONOMY_CATEGORIES } from "@/world/taxonomy";
import type { WorldHubQuery } from "@/world/hubDiscovery";

/** Filter fields for the discovery popover. Search / sort / view live on the toolbar. */
export function WorldHubFilterForm({
  projectId,
  query,
  tags,
  collectionId = null,
  formId,
}: {
  projectId: string;
  query: WorldHubQuery;
  tags: readonly string[];
  collectionId?: string | null;
  formId?: string;
}) {
  const category = query.category ? getTaxonomyCategory(query.category) : null;

  return (
    <form id={formId} className="world-hub-filter-form" method="get" action={worldHref(projectId)}>
      <input type="hidden" name="list" value="1" />
      {query.q ? <input type="hidden" name="q" value={query.q} /> : null}
      {query.sort && query.sort !== "updated" ? <input type="hidden" name="sort" value={query.sort} /> : null}
      {query.view && query.view !== "cards" ? <input type="hidden" name="view" value={query.view} /> : null}
      {collectionId ? <input type="hidden" name="collection" value={collectionId} /> : null}
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
      </div>
      <div className="row world-hub-filter-actions">
        <button type="submit" className="sl-btn">
          {WORLD.applyFilters}
        </button>
      </div>
    </form>
  );
}
