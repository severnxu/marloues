import type { SkillInfo, SkillMarketplaceDetail } from "@shared/types";
import { STRINGS } from "@shared/strings.zh";

export function scopeLabel(scope: SkillInfo["scope"]): string {
  if (scope === "marketplace") return STRINGS.skillAudit.scope.marketplace;
  if (scope === "enterprise") return STRINGS.skillAudit.scope.enterprise;
  if (scope === "project") return STRINGS.skillAudit.scope.project;
  return STRINGS.skillAudit.scope.user;
}

export function integrityLabel(
  status: NonNullable<SkillInfo["integrityStatus"]>,
): string {
  if (status === "verified") return STRINGS.skillAudit.integrity.verified;
  if (status === "failed") return STRINGS.skillAudit.integrity.failed;
  return STRINGS.skillAudit.integrity.uncheck;
}

export function securityLabel(
  status: NonNullable<SkillMarketplaceDetail["securityStatus"]>,
): string {
  if (status === "clean") return STRINGS.skillAudit.security.clean;
  if (status === "warning") return STRINGS.skillAudit.security.warning;
  if (status === "suspicious") return STRINGS.skillAudit.security.suspicious;
  return STRINGS.skillAudit.security.unscanned;
}

export function formatCount(value?: number): string {
  if (typeof value !== "number") return "0";
  if (value >= 1000)
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
  return String(value);
}

export function formatRelativeTime(value: number): string {
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
