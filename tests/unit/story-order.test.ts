import { describe, expect, it } from "vitest";
import { chronologicalIds, orderGraphHasCycle, orderRelation, orderWouldCycle } from "@/world/storyOrder";

describe("story event order", () => {
  it("rejects a circle and an event before itself", () => {
    const edges = [
      { earlierId: "a", laterId: "b" },
      { earlierId: "b", laterId: "c" },
    ];
    expect(orderWouldCycle(edges, "c", "a")).toBe(true);
    expect(orderWouldCycle(edges, "a", "a")).toBe(true);
    expect(orderWouldCycle(edges, "a", "c")).toBe(false);
    expect(orderGraphHasCycle(["a", "b", "c"], [...edges, { earlierId: "c", laterId: "a" }])).toBe(true);
  });

  it("orders by constraints, not by the sequence the nodes were listed", () => {
    const nodes = [
      { id: "quarrel", createdAt: 1 },
      { id: "fire", createdAt: 2 },
    ];
    expect(chronologicalIds(nodes, [{ earlierId: "fire", laterId: "quarrel" }])).toEqual(["fire", "quarrel"]);
  });

  it("reports an order only when a constraint path exists", () => {
    const edges = [{ earlierId: "fire", laterId: "quarrel" }];
    expect(orderRelation(edges, "fire", "quarrel")).toBe("before");
    expect(orderRelation(edges, "quarrel", "fire")).toBe("after");
    expect(orderRelation(edges, "fire", "unplaced")).toBe("unresolved");
    expect(orderRelation([...edges, { earlierId: "quarrel", laterId: "fire" }], "fire", "quarrel")).toBe("cycle");
  });
});
