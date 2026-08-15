import { formatCount } from "./skill-audit-formatters";
import type { SkillMarketplaceItem } from "@shared/types";

export const MARKETPLACE_PAGE_SIZE = 24;

export function formatMarketplaceSummaryBody({
  count,
  total,
  loading,
  query,
}: {
  count: number;
  total?: number;
  loading: boolean;
  query: string;
}): string {
  const scope = query.trim() ? "搜索结果" : "ClawHub 市场";
  if (loading && count === 0) return `正在加载 ${scope}...`;
  if (typeof total === "number" && total > count) {
    return `${scope}已加载 ${formatCount(count)} / 共 ${formatCount(total)} 个 Skill，可查看详情或安装`;
  }
  return `${scope}已加载 ${formatCount(count)} 个 Skill，可查看详情或安装`;
}

export function formatMarketplaceResultsLabel(
  count: number,
  total?: number,
): string {
  if (typeof total === "number" && total > count)
    return `${formatCount(count)} / ${formatCount(total)} results`;
  return `${formatCount(count)} results`;
}

export function normalizeMarketplaceResponse(
  response:
    | Awaited<ReturnType<typeof window.marloues.skill.marketplaceList>>
    | SkillMarketplaceItem[],
): {
  items: SkillMarketplaceItem[];
  nextCursor?: string;
  total?: number;
  hasMore: boolean;
} {
  if (Array.isArray(response)) {
    return {
      items: response,
      total: response.length,
      hasMore: false,
    };
  }
  return {
    items: Array.isArray(response.items) ? response.items : [],
    nextCursor: response.nextCursor,
    total: response.total,
    hasMore: response.hasMore,
  };
}

export function mergeMarketplaceItems(
  current: SkillMarketplaceItem[],
  next: SkillMarketplaceItem[],
): SkillMarketplaceItem[] {
  const seen = new Set(current.map((item) => item.slug));
  return [
    ...current,
    ...next.filter((item) => {
      if (seen.has(item.slug)) return false;
      seen.add(item.slug);
      return true;
    }),
  ];
}

export function splitLines(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}
