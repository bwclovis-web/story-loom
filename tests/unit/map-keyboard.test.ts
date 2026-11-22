import { describe, expect, it } from "vitest";
import { mapDrawingHandlesKey, mapListHandlesKey, type KeyTarget } from "@/world/mapKeyboard";

class Node implements KeyTarget {
  constructor(
    readonly tag: string,
    readonly parent: Node | null = null,
    readonly role = "",
  ) {}

  closest(selector: string): KeyTarget | null {
    let current: Node | null = this;
    while (current) {
      if (matches(current, selector)) return current;
      current = current.parent;
    }
    return null;
  }
}

function matches(node: Node, selector: string): boolean {
  return selector.split(",").some((part) => {
    const token = part.trim();
    if (token === node.tag) return true;
    if (token === "[role='option']" || token === '[role="option"]') return node.role === "option";
    if (token === "[contenteditable='true']") return false;
    return false;
  });
}

describe("map keyboard", () => {
  it("leaves Enter on a link and on a button that is not a list option", () => {
    const list = new Node("ul");
    const link = new Node("a", list);
    const field = new Node("input", list);
    const action = new Node("button", list);
    expect(mapListHandlesKey(link, list)).toBe(false);
    expect(mapListHandlesKey(field, list)).toBe(false);
    expect(mapListHandlesKey(action, list)).toBe(false);
  });

  it("leaves drawing keys inside a field", () => {
    const field = new Node("input");
    const canvas = new Node("div");
    expect(mapDrawingHandlesKey(field)).toBe(false);
    expect(mapDrawingHandlesKey(canvas)).toBe(true);
  });

  it("still handles keys on the list and on its options", () => {
    const list = new Node("ul");
    const option = new Node("button", list, "option");
    const label = new Node("span", option);
    expect(mapListHandlesKey(list, list)).toBe(true);
    expect(mapListHandlesKey(option, list)).toBe(true);
    expect(mapListHandlesKey(label, list)).toBe(true);
  });
});
