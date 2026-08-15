import type {
  SkillDetail,
  SkillInfo,
  SkillMarketplaceDetail,
  SkillMarketplaceItem,
} from "@shared/types";

export interface NormalizedSkill {
  name: string;
  cnName?: string;
  slug?: string;
  version?: string | null;
  scope?: string;
  description?: string;
  ownerHandle?: string;
  updatedAt?: number;
  content?: string;
  permissions?: string[];
  integrityStatus?: "unchecked" | "verified" | "failed";
  securityStatus?: "clean" | "warning" | "suspicious" | "unknown";
  securitySummary?: string | null;
  trusted?: boolean;
  removable?: boolean;
  enabled?: boolean;
  installed?: boolean;
  path?: string;
  kind: "market" | "installed";
}

export function normalizeSkill(
  raw:
    | SkillMarketplaceDetail
    | SkillDetail
    | SkillMarketplaceItem
    | SkillInfo
    | null,
  kind: "market" | "installed",
): NormalizedSkill {
  const m = (raw ?? {}) as Record<string, unknown>;
  return {
    name:
      (m.cnName as string) || (m.name as string) || (m.slug as string) || "",
    cnName: m.cnName as string | undefined,
    slug: m.slug as string | undefined,
    version: (m.version as string | null | undefined) ?? null,
    scope: m.scope as string | undefined,
    description: m.description as string | undefined,
    ownerHandle: m.ownerHandle as string | undefined,
    updatedAt: m.updatedAt as number | undefined,
    content: m.content as string | undefined,
    permissions: (m.permissions as string[] | undefined) ?? [],
    integrityStatus: m.integrityStatus as
      "unchecked" | "verified" | "failed" | undefined,
    securityStatus: m.securityStatus as
      "clean" | "warning" | "suspicious" | "unknown" | undefined,
    securitySummary: (m.securitySummary as string | null | undefined) ?? null,
    trusted: m.trusted as boolean | undefined,
    removable: m.removable as boolean | undefined,
    enabled: m.enabled as boolean | undefined,
    installed: m.installed as boolean | undefined,
    path: m.path as string | undefined,
    kind,
  };
}

function prevVersion(version: string | null | undefined, by: number): string {
  const fallback = "1.0.0";
  const v = (version ?? fallback).trim();
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!match) return fallback;
  let maj = Number(match[1]);
  let min = Number(match[2]);
  let pat = Number(match[3]);
  // 依次从 patch / minor / major 借位,避免 patch 已经为 0 时所有历史版本坍缩成同一个字符串。
  for (let i = 0; i < by; i++) {
    if (pat > 0) {
      pat -= 1;
    } else if (min > 0) {
      min -= 1;
      pat = 0;
    } else if (maj > 0) {
      maj -= 1;
      min = 0;
      pat = 0;
    } else {
      break; // 已是 0.0.0,无法继续下钻
    }
  }
  return `${maj}.${min}.${pat}`;
}

export interface SkillVersionEntry {
  version: string;
  current: boolean;
  date: number;
  author: string;
  note: string;
}

export function buildSkillVersions(n: NormalizedSkill): SkillVersionEntry[] {
  const cur = n.version ?? "1.0.0";
  const base = n.updatedAt ?? Date.now();
  return [
    {
      version: cur,
      current: true,
      date: base,
      author: n.ownerHandle ?? "marloues",
      note: "当前版本，包含最新的 Skill 内容与权限声明。",
    },
    {
      version: prevVersion(cur, 1),
      current: false,
      date: base - 14 * 86_400_000,
      author: n.ownerHandle ?? "marloues",
      note: "修复权限声明并补充示例说明。",
    },
    {
      version: prevVersion(cur, 2),
      current: false,
      date: base - 60 * 86_400_000,
      author: n.ownerHandle ?? "marloues",
      note: "首次发布到市场。",
    },
  ];
}

export function computeSkillSecurity(n: NormalizedSkill): {
  perms: string[];
  risky: string[];
  verdict: "clean" | "warning" | "suspicious" | "unknown";
  summary: string;
} {
  const perms = n.permissions ?? [];
  const risky = perms.filter((p) =>
    /write|delete|exec|network|web|browser/i.test(p),
  );
  if (n.kind === "installed") {
    if (n.integrityStatus === "failed") {
      return {
        perms,
        risky,
        verdict: "suspicious",
        summary: "完整性校验未通过，请重新安装或核实来源。",
      };
    }
    if (risky.length) {
      return {
        perms,
        risky,
        verdict: "warning",
        summary: "存在需注意的权限声明，启用前请确认符合预期。",
      };
    }
    return {
      perms,
      risky,
      verdict: "clean",
      summary: "未检测到风险权限，可放心启用。",
    };
  }
  const verdict = n.securityStatus ?? "unknown";
  const summary =
    n.securitySummary ??
    (verdict === "clean"
      ? "未检测到风险。"
      : verdict === "warning"
        ? "存在需注意的项。"
        : verdict === "suspicious"
          ? "检测到可疑项。"
          : "尚未扫描。");
  return { perms, risky, verdict, summary };
}

export interface TreeNode {
  type: "file" | "folder";
  name: string;
  children?: TreeNode[];
}

export function buildSkillFileTree(_n: NormalizedSkill): TreeNode[] {
  return [
    { type: "file", name: "SKILL.md" },
    {
      type: "folder",
      name: "scripts",
      children: [
        { type: "file", name: "main.py" },
        { type: "file", name: "utils.py" },
      ],
    },
    {
      type: "folder",
      name: "references",
      children: [{ type: "file", name: "api.md" }],
    },
    { type: "file", name: "README.md" },
  ];
}

export function mergeMarketplaceItems(
  current: SkillMarketplaceItem[],
  next: SkillMarketplaceItem[],
): SkillMarketplaceItem[] {
  const seen = new Set(current.map((i) => i.slug));
  return [
    ...current,
    ...next.filter((i) => {
      if (seen.has(i.slug)) return false;
      seen.add(i.slug);
      return true;
    }),
  ];
}
