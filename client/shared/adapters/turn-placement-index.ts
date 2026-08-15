import type { AppZone, TurnPlacement } from "../workflow-read-thread-contract";

/**
 * TurnPlacement 挂载索引（复核护栏 9 的数据模型层落地）。
 *
 * 语义：
 * - primary：turn 源头归属挂载（builder 创建 turn 时登记）；
 * - mirrored：其他区对同一 turn 的引用——索引里只存 turnId，**不复制 item 数据**，
 *   数据本体始终在 WorkflowTurn / 订阅层，mirrored 由订阅层按需拉取。
 * - 统一渲染组件不关心区；区只通过 getTurnsForZone(zone, refId) 筛选/挂载 turn。
 */

export interface TurnPlacementIndex {
  addPlacement(placement: TurnPlacement): void;
  /** 按 (turnId, zone, refId) 精确移除；不存在时静默。 */
  removePlacement(turnId: string, zone: AppZone, refId: string): void;
  /** 某区内某 refId 下的全部挂载（primary 优先序，mirrored 在后）。 */
  getTurnsForZone(zone: AppZone, refId: string): TurnPlacement[];
  /** 某 turn 的全部挂载点（跨区）。 */
  placementsForTurn(turnId: string): TurnPlacement[];
  size(): number;
  clear(): void;
}

const PLACEMENT_ORDER: Record<TurnPlacement["visibility"], number> = {
  primary: 0,
  mirrored: 1,
};

export function createTurnPlacementIndex(): TurnPlacementIndex {
  const byTurn = new Map<string, TurnPlacement[]>();

  const findIndex = (
    placements: TurnPlacement[],
    zone: AppZone,
    refId: string,
  ): number =>
    placements.findIndex((p) => p.zone === zone && p.refId === refId);

  return {
    addPlacement(placement) {
      const existing = byTurn.get(placement.turnId) ?? [];
      const idx = findIndex(existing, placement.zone, placement.refId);
      if (idx >= 0) {
        // 同键重复登记：保持 turnId/zone/refId 不变，更新 visibility
        const next = [...existing];
        next[idx] = {
          ...existing[idx],
          visibility: placement.visibility,
        };
        byTurn.set(placement.turnId, next);
        return;
      }
      byTurn.set(placement.turnId, [...existing, placement]);
    },

    removePlacement(turnId, zone, refId) {
      const existing = byTurn.get(turnId);
      if (!existing) return;
      const idx = findIndex(existing, zone, refId);
      if (idx < 0) return;
      const next = existing.filter((_, i) => i !== idx);
      if (next.length === 0) {
        byTurn.delete(turnId);
      } else {
        byTurn.set(turnId, next);
      }
    },

    getTurnsForZone(zone, refId) {
      const matches: TurnPlacement[] = [];
      for (const placements of byTurn.values()) {
        for (const placement of placements) {
          if (placement.zone === zone && placement.refId === refId) {
            matches.push(placement);
          }
        }
      }
      return matches.sort(
        (a, b) => PLACEMENT_ORDER[a.visibility] - PLACEMENT_ORDER[b.visibility],
      );
    },

    placementsForTurn(turnId) {
      return [...(byTurn.get(turnId) ?? [])];
    },

    size() {
      return byTurn.size;
    },

    clear() {
      byTurn.clear();
    },
  };
}
