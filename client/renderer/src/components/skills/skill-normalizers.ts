import type {
  SkillDetail,
  SkillDetailFile,
  SkillInfo,
  SkillMarketplaceDetail,
  SkillMarketplaceItem,
  SkillVersionRecord,
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
  files?: SkillDetailFile[];
  versions?: SkillVersionRecord[];
  permissions?: string[];
  integrityStatus?: "unchecked" | "verified" | "failed";
  integrityOnInstall?: boolean;
  securityStatus?: "clean" | "warning" | "suspicious" | "unknown";
  securitySummary?: string | null;
  trusted?: boolean;
  removable?: boolean;
  enabled?: boolean;
  installed?: boolean;
  path?: string;
  sourceUrl?: string;
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
  const install = m.install as
    { type?: string; verification?: unknown } | undefined;
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
    files: m.files as SkillDetailFile[] | undefined,
    versions: m.versions as SkillVersionRecord[] | undefined,
    permissions: (m.permissions as string[] | undefined) ?? [],
    integrityStatus: m.integrityStatus as
      "unchecked" | "verified" | "failed" | undefined,
    integrityOnInstall: Boolean(
      install?.type === "archive" && install.verification,
    ),
    securityStatus: m.securityStatus as
      "clean" | "warning" | "suspicious" | "unknown" | undefined,
    securitySummary: (m.securitySummary as string | null | undefined) ?? null,
    trusted: m.trusted as boolean | undefined,
    removable: m.removable as boolean | undefined,
    enabled: m.enabled as boolean | undefined,
    installed: m.installed as boolean | undefined,
    path: m.path as string | undefined,
    sourceUrl: m.sourceUrl as string | undefined,
    kind,
  };
}

export interface SkillVersionEntry {
  version: string;
  current: boolean;
  date: number;
  author: string;
  note: string;
}

export function buildSkillVersions(n: NormalizedSkill): SkillVersionEntry[] {
  return (n.versions ?? []).map((version) => ({
    version: version.version,
    current: version.version === n.version,
    date: version.createdAt ?? 0,
    author: n.ownerHandle ?? "marloues",
    note: version.changelog?.trim() || "该版本未提供更新说明。",
  }));
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

export function buildSkillFileTree(n: NormalizedSkill): TreeNode[] {
  const roots: TreeNode[] = [];
  const paths = n.files?.map((file) => file.path) ?? [];
  if (!paths.length && n.content) paths.push("SKILL.md");

  for (const path of paths) {
    const segments = path.split("/").filter(Boolean);
    let level = roots;
    segments.forEach((segment, index) => {
      const isFile = index === segments.length - 1;
      let node = level.find(
        (candidate) =>
          candidate.name === segment &&
          candidate.type === (isFile ? "file" : "folder"),
      );
      if (!node) {
        node = isFile
          ? { type: "file", name: segment }
          : { type: "folder", name: segment, children: [] };
        level.push(node);
      }
      if (!isFile) level = node.children!;
    });
  }

  return sortTree(roots);
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .map((node) => ({
      ...node,
      children: node.children ? sortTree(node.children) : undefined,
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
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
