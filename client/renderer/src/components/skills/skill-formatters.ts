import type { SkillInfo } from "@shared/types";

export function formatCount(value?: number): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "0";
  if (value >= 1000)
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return String(value);
}

export function formatMarketplaceResultsLabel(
  count: number,
  total?: number,
): string {
  if (typeof total === "number" && total > count)
    return `${formatCount(count)} / ${formatCount(total)} results`;
  return `${formatCount(count)} results`;
}

export function scopeLabel(scope?: SkillInfo["scope"]): string {
  if (scope === "marketplace") return "市场安装";
  if (scope === "enterprise") return "企业策略";
  if (scope === "project") return "项目";
  return "用户";
}

export function integrityLabel(status?: SkillInfo["integrityStatus"]): string {
  if (status === "verified") return "已校验";
  if (status === "failed") return "校验失败";
  return "未校验";
}

export function formatRelativeTime(value?: number): string {
  if (!value) return "recently";
  const timestamp = value < 10_000_000_000 ? value * 1000 : value;
  const diff = Date.now() - timestamp;
  if (!Number.isFinite(diff) || diff < 0) return "recently";
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < day * 30) return `${Math.floor(diff / day)}d ago`;
  if (diff < day * 365) return `${Math.floor(diff / (day * 30))}mo ago`;
  return `${Math.floor(diff / (day * 365))}y ago`;
}

export function formatDate(value?: number | string | null): string {
  if (!value) return "—";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
