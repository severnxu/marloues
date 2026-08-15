import { describe, expect, it } from "vitest";
import { createTurnPlacementIndex } from "./turn-placement-index";
import type { TurnPlacement } from "../workflow-read-thread-contract";

const primary = (
  turnId: string,
  zone: TurnPlacement["zone"],
  refId: string,
): TurnPlacement => ({
  turnId,
  zone,
  refId,
  visibility: "primary",
});

const mirrored = (
  turnId: string,
  zone: TurnPlacement["zone"],
  refId: string,
): TurnPlacement => ({
  turnId,
  zone,
  refId,
  visibility: "mirrored",
});

describe("TurnPlacementIndex（护栏 ⑨）", () => {
  it("primary 挂载登记 + 按区/refId 查询", () => {
    const index = createTurnPlacementIndex();
    index.addPlacement(primary("turn-1", "workspace", "thread-1"));
    index.addPlacement(primary("turn-2", "feishu", "chat-42"));

    expect(index.getTurnsForZone("workspace", "thread-1")).toHaveLength(1);
    expect(index.getTurnsForZone("feishu", "chat-42")).toHaveLength(1);
    expect(index.getTurnsForZone("workspace", "chat-42")).toHaveLength(0);
  });

  it("mirrored 只存引用、不复制数据（索引不含 item 内容）", () => {
    const index = createTurnPlacementIndex();
    index.addPlacement(primary("turn-1", "workspace", "thread-1"));
    index.addPlacement(mirrored("turn-1", "wecom", "chat-9"));

    const placements = index.placementsForTurn("turn-1");
    expect(placements).toHaveLength(2);
    // 索引项只有 turnId/zone/refId/visibility，无 items 等数据本体
    for (const p of placements) {
      expect(Object.keys(p).sort()).toEqual([
        "refId",
        "turnId",
        "visibility",
        "zone",
      ]);
    }
  });

  it("getTurnsForZone 返回 primary 优先、mirrored 在后", () => {
    const index = createTurnPlacementIndex();
    index.addPlacement(mirrored("turn-2", "wecom", "chat-9"));
    index.addPlacement(primary("turn-1", "wecom", "chat-9"));

    const placements = index.getTurnsForZone("wecom", "chat-9");
    expect(placements.map((p) => p.turnId)).toEqual(["turn-1", "turn-2"]);
    expect(placements[0].visibility).toBe("primary");
  });

  it("removePlacement 精确移除；最后一个挂载移除后 turn 消失", () => {
    const index = createTurnPlacementIndex();
    index.addPlacement(primary("turn-1", "workspace", "thread-1"));
    index.addPlacement(mirrored("turn-1", "wecom", "chat-9"));

    index.removePlacement("turn-1", "wecom", "chat-9");
    expect(index.placementsForTurn("turn-1")).toHaveLength(1);

    index.removePlacement("turn-1", "workspace", "thread-1");
    expect(index.placementsForTurn("turn-1")).toHaveLength(0);
    expect(index.size()).toBe(0);
  });

  it("重复登记同键只更新 visibility 不重复插入", () => {
    const index = createTurnPlacementIndex();
    index.addPlacement(primary("turn-1", "workspace", "thread-1"));
    index.addPlacement(mirrored("turn-1", "workspace", "thread-1"));

    const placements = index.placementsForTurn("turn-1");
    expect(placements).toHaveLength(1);
    expect(placements[0].visibility).toBe("mirrored");
  });
});
