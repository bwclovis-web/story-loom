/** Explicit earlier → later edges. Manuscript position is not an input. */

export interface OrderEdge {
  earlierId: string;
  laterId: string;
}

export interface OrderNode {
  id: string;
  createdAt: number;
}

/** True when recording earlierId before laterId would close a circle, including an event before itself. */
export function orderWouldCycle(edges: readonly OrderEdge[], earlierId: string, laterId: string): boolean {
  if (earlierId === laterId) return true;
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    const list = next.get(edge.earlierId) ?? [];
    list.push(edge.laterId);
    next.set(edge.earlierId, list);
  }
  const seen = new Set<string>();
  const stack = [laterId];
  while (stack.length) {
    const id = stack.pop();
    if (id === undefined) break;
    if (id === earlierId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const step of next.get(id) ?? []) stack.push(step);
  }
  return false;
}

export function orderGraphHasCycle(ids: readonly string[], edges: readonly OrderEdge[]): boolean {
  const incoming = new Map<string, number>();
  const next = new Map<string, string[]>();
  for (const id of ids) {
    incoming.set(id, 0);
    next.set(id, []);
  }
  for (const edge of edges) {
    if (!incoming.has(edge.earlierId) || !incoming.has(edge.laterId)) continue;
    next.get(edge.earlierId)?.push(edge.laterId);
    incoming.set(edge.laterId, (incoming.get(edge.laterId) ?? 0) + 1);
  }
  const ready = [...ids].filter((id) => incoming.get(id) === 0);
  let seen = 0;
  while (ready.length) {
    const id = ready.shift();
    if (!id) break;
    seen += 1;
    for (const step of next.get(id) ?? []) {
      const left = (incoming.get(step) ?? 1) - 1;
      incoming.set(step, left);
      if (left === 0) ready.push(step);
    }
  }
  return seen < ids.length;
}

/**
 * Chronological ids. Ready events (nothing required before them) are taken by
 * createdAt, then id. That tie-break is not manuscript order.
 */
export function chronologicalIds(nodes: readonly OrderNode[], edges: readonly OrderEdge[]): string[] {
  const idSet = new Set(nodes.map((node) => node.id));
  const incoming = new Map<string, number>();
  const next = new Map<string, string[]>();
  for (const id of idSet) {
    incoming.set(id, 0);
    next.set(id, []);
  }
  for (const edge of edges) {
    if (!idSet.has(edge.earlierId) || !idSet.has(edge.laterId)) continue;
    next.get(edge.earlierId)?.push(edge.laterId);
    incoming.set(edge.laterId, (incoming.get(edge.laterId) ?? 0) + 1);
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ready = [...idSet].filter((id) => incoming.get(id) === 0);
  const sortReady = () => {
    ready.sort((a, b) => {
      const delta = (byId.get(a)?.createdAt ?? 0) - (byId.get(b)?.createdAt ?? 0);
      if (delta !== 0) return delta;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  };
  const out: string[] = [];
  sortReady();
  while (ready.length) {
    const id = ready.shift();
    if (!id) break;
    out.push(id);
    for (const step of next.get(id) ?? []) {
      const left = (incoming.get(step) ?? 1) - 1;
      incoming.set(step, left);
      if (left === 0) ready.push(step);
    }
    sortReady();
  }
  return out;
}
