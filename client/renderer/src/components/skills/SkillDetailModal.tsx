import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  Download,
  FileText,
  FolderTree,
  History,
  LoaderCircle,
  Package,
  ShieldCheck,
  X,
} from "lucide-react";
import type {
  SkillDetail,
  SkillInfo,
  SkillMarketplaceDetail,
  SkillMarketplaceDetailSection,
  SkillMarketplaceItem,
} from "@shared/types";
import {
  buildSkillFileTree,
  buildSkillVersions,
  computeSkillSecurity,
  normalizeSkill,
} from "./skill-normalizers";
import { formatDate, integrityLabel, scopeLabel } from "./skill-formatters";
import { SkillFileTree } from "./SkillFileTree";

type DetailTab = "skillmd" | "tree" | "security" | "history";
type SkillRecord =
  SkillMarketplaceDetail | SkillDetail | SkillMarketplaceItem | SkillInfo;

export function SkillDetailModal({
  kind,
  detail,
  skill,
  installingSlug,
  detailLoading,
  onClose,
  onInstall,
}: {
  kind: "market" | "installed";
  detail: SkillMarketplaceDetail | SkillDetail | null;
  skill: SkillMarketplaceItem | SkillInfo | null;
  installingSlug: string | null;
  detailLoading: boolean;
  onClose: () => void;
  onInstall: (slug: string, version?: string) => void;
}) {
  const [tab, setTab] = useState<DetailTab>("skillmd");
  const [viewVersion, setViewVersion] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState("SKILL.md");
  const [detailByVersion, setDetailByVersion] = useState<
    Record<string, SkillMarketplaceDetail>
  >({});
  const [versionLoading, setVersionLoading] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);
  const loadedSections = useRef(new Set<string>());

  // The first render only has the marketplace list item. Keep it as the
  // fallback when a lazily loaded detail section omits fields such as version.
  const initialData = normalizeSkill(mergeSkillRecords(skill, detail), kind);
  const currentVersion = initialData.version ?? null;
  const viewing = viewVersion ?? currentVersion;
  const isHistory = !!currentVersion && !!viewing && viewing !== currentVersion;
  const currentDetailKey = currentVersion ?? "__current";
  const selectedDetailKey = viewing ?? currentDetailKey;
  const baseData = normalizeSkill(
    mergeSkillRecords(skill, detail, detailByVersion[currentDetailKey]),
    kind,
  );
  const data = normalizeSkill(
    mergeSkillRecords(skill, detail, detailByVersion[selectedDetailKey]),
    kind,
  );

  const versions = useMemo(() => buildSkillVersions(baseData), [baseData]);
  const security = useMemo(() => computeSkillSecurity(data), [data]);
  const fileTree = useMemo(() => buildSkillFileTree(data), [data]);

  const content = data.content ?? "";
  const selectedFileEntry = data.files?.find(
    (file) => file.path === selectedFile,
  );
  const selectedFileContent =
    selectedFileEntry?.content ??
    (selectedFile === "SKILL.md" ? content : undefined);
  const shownVersion = viewing ?? data.version;
  const versionLabel = viewing ?? currentVersion;
  const versionText = versionLabel
    ? `v${versionLabel}`
    : kind === "market"
      ? "最新版"
      : "未声明版本";
  const subtitle =
    kind === "market"
      ? `${data.ownerHandle || data.slug} · ${
          shownVersion ? `v${shownVersion}` : "最新版"
        }`
      : `${scopeLabel(data.scope as SkillInfo["scope"]) || "本地"}${
          shownVersion ? ` · v${shownVersion}` : ""
        }${
          data.integrityStatus
            ? ` · ${integrityLabel(data.integrityStatus)}`
            : ""
        }`;

  const tabs = [
    { key: "skillmd", label: "SKILL.md", icon: FileText },
    {
      key: "tree",
      label: "文件",
      icon: FolderTree,
      count: data.files?.length,
    },
    { key: "security", label: "安全检测", icon: ShieldCheck },
    {
      key: "history",
      label: "历史版本",
      icon: History,
      count: versions.length || undefined,
    },
  ] satisfies Array<{
    key: DetailTab;
    label: string;
    icon: typeof FileText;
    count?: number;
  }>;

  useEffect(() => {
    setViewVersion(null);
    setDetailByVersion({});
    loadedSections.current.clear();
    setVersionError(null);
    setSelectedFile("SKILL.md");
  }, [kind, initialData.slug]);

  useEffect(() => {
    if (kind !== "market" || !currentVersion || !viewing) {
      setVersionLoading(false);
      setVersionError(null);
      return;
    }
    let section: SkillMarketplaceDetailSection | null = null;
    let targetVersion = viewing;
    if (tab === "tree") section = "files";
    if (tab === "security") section = "security";
    if (tab === "history") {
      section = "versions";
      targetVersion = currentVersion;
    }
    if (tab === "skillmd" && isHistory) section = "content";
    if (!section) {
      setVersionLoading(false);
      setVersionError(null);
      return;
    }

    const requestKey = `${targetVersion}:${section}`;
    if (loadedSections.current.has(requestKey)) {
      setVersionLoading(false);
      setVersionError(null);
      return;
    }
    const slug = baseData.slug ?? baseData.name;
    const reference = slug.includes("/")
      ? slug
      : baseData.ownerHandle
        ? `${baseData.ownerHandle}/${slug}`
        : slug;
    let cancelled = false;
    setVersionLoading(true);
    setVersionError(null);
    void window.marloues.skill
      .marketplaceDetail(reference, targetVersion, section)
      .then((nextDetail) => {
        if (cancelled) return;
        setDetailByVersion((current) => ({
          ...current,
          [targetVersion]: mergeSkillRecords(
            current[targetVersion],
            nextDetail,
          ) as SkillMarketplaceDetail,
        }));
        loadedSections.current.add(requestKey);
      })
      .catch((error) => {
        if (!cancelled) {
          setVersionError(
            error instanceof Error ? error.message : "详情数据加载失败。",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setVersionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    baseData.name,
    baseData.ownerHandle,
    baseData.slug,
    currentVersion,
    isHistory,
    kind,
    tab,
    viewing,
  ]);

  useEffect(() => {
    setSelectedFile("SKILL.md");
  }, [viewing]);

  return createPortal(
    <div
      className="skill-detail-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="skill-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${data.name} 详情`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="skill-detail-head">
          <div className="skill-row-icon" aria-hidden="true">
            <Package size={18} />
          </div>
          <div>
            <strong>{data.cnName || data.name}</strong>
            <small>{subtitle}</small>
          </div>
          <button className="icon-button" title="关闭" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="skill-detail-versionbar">
          <span className="vlabel">版本</span>
          <strong>
            {versionText}
            {!isHistory && (kind === "market" || currentVersion)
              ? " · 当前"
              : ""}
          </strong>
        </div>

        {isHistory ? (
          <div className="sd-version-note">
            <AlertCircle size={14} />
            <span>
              正在查看历史版本 <b>v{viewing}</b> 的真实快照
              {versionLoading
                ? "，正在读取当前页签的真实快照…"
                : "；其它页签将在打开时按需读取。"}
            </span>
          </div>
        ) : null}

        <div
          className="skill-detail-tabs"
          role="tablist"
          aria-label="Skill 详情"
          onKeyDown={(event) => {
            if (
              event.key !== "ArrowLeft" &&
              event.key !== "ArrowRight" &&
              event.key !== "Home" &&
              event.key !== "End"
            ) {
              return;
            }
            event.preventDefault();
            const currentIndex = tabs.findIndex((item) => item.key === tab);
            const nextIndex =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : (currentIndex +
                      (event.key === "ArrowRight" ? 1 : -1) +
                      tabs.length) %
                    tabs.length;
            setTab(tabs[nextIndex].key);
            requestAnimationFrame(() => {
              event.currentTarget
                .querySelectorAll<HTMLElement>('[role="tab"]')
                [nextIndex]?.focus();
            });
          }}
        >
          {tabs.map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              tabIndex={tab === key ? 0 : -1}
              onClick={() => setTab(key)}
              type="button"
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
              {count !== undefined ? (
                <span className="sd-tab-count">{count}</span>
              ) : null}
            </button>
          ))}
        </div>

        <div
          className="skill-detail-body"
          aria-busy={detailLoading || versionLoading}
        >
          {versionError ? (
            <div className="sd-detail-state is-error" role="alert">
              <AlertCircle size={16} />
              <span>{versionError}</span>
            </div>
          ) : null}

          {versionLoading ? (
            <SkillDetailLoading
              label={tabs.find((item) => item.key === tab)?.label ?? "详情"}
            />
          ) : null}

          {!versionLoading && !versionError && tab === "skillmd" ? (
            detailLoading && !detail ? (
              <SkillDetailLoading label="SKILL.md" />
            ) : content ? (
              <pre>{content}</pre>
            ) : (
              <p className="skill-detail-description">暂无 SKILL.md 内容。</p>
            )
          ) : null}

          {!versionLoading && !versionError && tab === "tree" ? (
            fileTree.length ? (
              <div className="skill-file-browser">
                <nav aria-label="Skill 文件">
                  <SkillFileTree
                    nodes={fileTree}
                    selectedPath={selectedFile}
                    onSelect={setSelectedFile}
                  />
                </nav>
                <section className="skill-file-preview">
                  <header>
                    <span>{selectedFile}</span>
                    {selectedFileEntry?.size !== undefined ? (
                      <small>{formatFileSize(selectedFileEntry.size)}</small>
                    ) : null}
                  </header>
                  {selectedFileContent ? (
                    <pre>{selectedFileContent}</pre>
                  ) : (
                    <p>该市场只提供了文件清单，未提供此文件的文本预览。</p>
                  )}
                </section>
              </div>
            ) : (
              <div className="sd-detail-state">该来源未提供文件清单。</div>
            )
          ) : null}

          {!versionLoading && !versionError && tab === "security" ? (
            <div>
              <div
                className={`skill-detail-security ${
                  security.verdict !== "clean" && security.verdict !== "unknown"
                    ? `is-${security.verdict}`
                    : ""
                }`}
              >
                <p className="skill-detail-section-label">安全扫描结论</p>
                <p className="skill-detail-description">{security.summary}</p>
              </div>
              {security.perms.length ? (
                <div>
                  <p className="skill-detail-section-label">声明的权限</p>
                  <div className="sd-perm-chips">
                    {security.perms.map((p) => (
                      <span
                        key={p}
                        className={`pill ${
                          /write|delete|exec/i.test(p) ? "warn" : ""
                        }`}
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              <dl className="sd-meta-grid">
                <div className="m">
                  <dt>完整性</dt>
                  <dd>
                    {kind === "installed" && data.integrityStatus
                      ? integrityLabel(data.integrityStatus)
                      : data.integrityOnInstall
                        ? "安装时逐文件校验"
                        : data.files?.some((file) => file.sha256)
                          ? "已提供逐文件哈希"
                          : "未提供校验清单"}
                  </dd>
                </div>
                <div className="m">
                  <dt>来源</dt>
                  <dd>
                    {kind === "market"
                      ? marketplaceSourceLabel(data.sourceUrl)
                      : scopeLabel(data.scope as SkillInfo["scope"]) || "未知"}
                  </dd>
                </div>
                <div className="m">
                  <dt>{kind === "market" ? "扫描" : "可信"}</dt>
                  <dd>
                    {kind === "market"
                      ? securityVerdictLabel(security.verdict)
                      : data.trusted
                        ? "是"
                        : "未标记"}
                  </dd>
                </div>
                <div className="m">
                  <dt>可移除</dt>
                  <dd>
                    {kind === "market"
                      ? "安装后可移除"
                      : data.removable
                        ? "是"
                        : "否"}
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}

          {tab === "history" && versions.length ? (
            <div className="sd-versions">
              {versions.map((v, idx) => {
                const active = v.version === viewing;
                return (
                  <div
                    key={`${v.version}#${idx}`}
                    className={`sd-version-item ${
                      v.current ? "is-current" : ""
                    }`}
                  >
                    <div>
                      <div className="sd-version-top">
                        <b>v{v.version}</b>
                        {v.current ? (
                          <span className="sd-version-pill on">当前</span>
                        ) : null}
                        {active ? (
                          <span className="sd-version-pill">正在查看</span>
                        ) : null}
                      </div>
                      <small>
                        {v.date ? formatDate(v.date) : "时间未知"} · @{v.author}
                      </small>
                      <p>{v.note}</p>
                    </div>
                    <button
                      className="sd-btn sd-btn-ghost"
                      type="button"
                      disabled={active}
                      onClick={() =>
                        setViewVersion(v.current ? null : v.version)
                      }
                    >
                      {active ? "查看中" : "切换"}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : tab === "history" && !versionLoading && !versionError ? (
            <div className="sd-detail-state">
              该来源未提供可验证的历史版本数据。
            </div>
          ) : null}
        </div>

        {kind === "market" && !data.installed ? (
          <div className="skill-detail-actions">
            <button
              className="sd-btn sd-btn-primary"
              type="button"
              disabled={installingSlug === data.slug}
              onClick={() =>
                onInstall(data.slug ?? data.name, viewing ?? undefined)
              }
            >
              <Download size={14} />
              {installingSlug === data.slug ? "安装中" : "安装"}
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SkillDetailLoading({ label }: { label: string }) {
  return (
    <div className="sd-detail-state" aria-live="polite">
      <LoaderCircle className="is-spinning" aria-hidden="true" />
      <span>正在读取 {label}…</span>
    </div>
  );
}

function marketplaceSourceLabel(sourceUrl?: string): string {
  if (!sourceUrl) return "Skill 市场";
  try {
    const host = new URL(sourceUrl).hostname.replace(/^www\./, "");
    if (host === "clawhub.ai" || host.endsWith(".clawhub.ai")) {
      return "ClawHub";
    }
    if (host === "skillsmp.com" || host.endsWith(".skillsmp.com")) {
      return "SkillsMP";
    }
    return host;
  } catch {
    return "Skill 市场";
  }
}

function securityVerdictLabel(
  verdict: "clean" | "warning" | "suspicious" | "unknown",
): string {
  if (verdict === "clean") return "通过";
  if (verdict === "warning") return "需注意";
  if (verdict === "suspicious") return "可疑";
  return "未扫描";
}

function mergeSkillRecords(
  ...records: Array<SkillRecord | null | undefined>
): SkillRecord | null {
  const merged: Record<string, unknown> = {};
  let found = false;
  for (const record of records) {
    if (!record) continue;
    found = true;
    for (const [key, value] of Object.entries(record)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return found ? (merged as unknown as SkillRecord) : null;
}
