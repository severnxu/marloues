import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  Download,
  FileText,
  LayoutGrid,
  List as ListIcon,
  Package,
  RefreshCcw,
  Search,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import { notify } from "@/lib/notifications";
import { EmptySettingsState, SettingsCard } from "@/components/settings/shared";
import type {
  AgentSettings,
  AuditEventRecord,
  RuntimeKind,
  RuntimeState,
  SkillDetail,
  SkillInfo,
  SkillMarketplaceDetail,
  SkillMarketplaceItem,
} from "@shared/types";

const MARKETPLACE_PAGE_SIZE = 24;

export function SkillsSettings({
  canToggleSkills,
  enabledSkillCount,
  marketplaceCursor,
  marketplaceDetail,
  marketplaceError,
  marketplaceHasMore,
  marketplaceLoading,
  marketplaceQuery,
  marketplaceSkills,
  marketplaceTotal,
  marketplaceView,
  onMarketplaceCursorChange,
  onMarketplaceDetailChange,
  onMarketplaceErrorChange,
  onMarketplaceHasMoreChange,
  onMarketplaceLoadingChange,
  onMarketplaceQueryChange,
  onMarketplaceSkillsChange,
  onMarketplaceTotalChange,
  onMarketplaceViewChange,
  onSkillDetailChange,
  onSkillsChange,
  runtimeSkills,
  skillDetail,
  skills,
  skillTab,
  onSkillTabChange,
}: {
  canToggleSkills: boolean;
  enabledSkillCount: number;
  marketplaceCursor?: string;
  marketplaceDetail: SkillMarketplaceDetail | null;
  marketplaceError: string | null;
  marketplaceHasMore: boolean;
  marketplaceLoading: boolean;
  marketplaceQuery: string;
  marketplaceSkills: SkillMarketplaceItem[];
  marketplaceTotal?: number;
  marketplaceView: "grid" | "list";
  onMarketplaceCursorChange: Dispatch<SetStateAction<string | undefined>>;
  onMarketplaceDetailChange: Dispatch<SetStateAction<SkillMarketplaceDetail | null>>;
  onMarketplaceErrorChange: Dispatch<SetStateAction<string | null>>;
  onMarketplaceHasMoreChange: Dispatch<SetStateAction<boolean>>;
  onMarketplaceLoadingChange: Dispatch<SetStateAction<boolean>>;
  onMarketplaceQueryChange: Dispatch<SetStateAction<string>>;
  onMarketplaceSkillsChange: Dispatch<SetStateAction<SkillMarketplaceItem[]>>;
  onMarketplaceTotalChange: Dispatch<SetStateAction<number | undefined>>;
  onMarketplaceViewChange: Dispatch<SetStateAction<"grid" | "list">>;
  onSkillDetailChange: (detail: SkillDetail | null) => void;
  onSkillsChange: (skills: SkillInfo[]) => void;
  runtimeSkills: string[];
  skillDetail: SkillDetail | null;
  skills: SkillInfo[];
  skillTab: "installed" | "market" | "import";
  onSkillTabChange: (tab: "installed" | "market" | "import") => void;
}) {
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [removingSkillId, setRemovingSkillId] = useState<string | null>(null);
  const marketplaceLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const visibleSkills = skills;
  const marketplaceSummaryBody = formatMarketplaceSummaryBody({
    count: marketplaceSkills.length,
    total: marketplaceTotal,
    loading: marketplaceLoading,
    query: marketplaceQuery,
  });
  const summaryTitle =
    skillTab === "installed" ? "已安装的 Skills" : skillTab === "market" ? "Skill 市场" : "导入 Skills";
  const summaryBody =
    skillTab === "installed"
      ? `已发现 ${skills.length} 个 Skill，${enabledSkillCount} 个已启用`
      : skillTab === "market"
        ? marketplaceSummaryBody
        : "从本地文件夹导入一个包含 SKILL.md 的 Skill";

  useEffect(() => {
    if (skillTab !== "market") return;
    if (marketplaceSkills.length > 0) return;
    void refreshMarketplace();
  }, [skillTab, marketplaceSkills.length]);

  useEffect(() => {
    if (skillTab !== "market" || !marketplaceHasMore || marketplaceLoading) return;
    const target = marketplaceLoadMoreRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMoreMarketplace();
        }
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [skillTab, marketplaceHasMore, marketplaceLoading, marketplaceCursor, marketplaceSkills.length, marketplaceQuery]);

  async function refreshMarketplace(query = marketplaceQuery): Promise<void> {
    await loadMarketplace({ query, reset: true });
  }

  async function loadMoreMarketplace(): Promise<void> {
    if (marketplaceLoading || !marketplaceHasMore) return;
    await loadMarketplace({ query: marketplaceQuery, reset: false });
  }

  async function loadMarketplace({ query, reset }: { query: string; reset: boolean }): Promise<void> {
    onMarketplaceLoadingChange(true);
    onMarketplaceErrorChange(null);
    if (reset) {
      onMarketplaceSkillsChange([]);
      onMarketplaceCursorChange(undefined);
      onMarketplaceHasMoreChange(false);
      onMarketplaceTotalChange(undefined);
    }
    try {
      const trimmedQuery = query.trim();
      const shouldGrowLimit = !reset && (trimmedQuery || !marketplaceCursor);
      const limit = shouldGrowLimit
        ? Math.min(marketplaceSkills.length + MARKETPLACE_PAGE_SIZE, 200)
        : MARKETPLACE_PAGE_SIZE;
      const response = await window.marloues.skill.marketplaceList({
        query: trimmedQuery,
        limit,
        cursor: trimmedQuery ? undefined : reset ? undefined : marketplaceCursor,
      });
      const result = normalizeMarketplaceResponse(response);
      onMarketplaceSkillsChange((items) =>
        reset || trimmedQuery || shouldGrowLimit ? result.items : mergeMarketplaceItems(items, result.items),
      );
      onMarketplaceCursorChange(result.nextCursor);
      onMarketplaceHasMoreChange(
        result.hasMore && (Boolean(result.nextCursor) || result.items.length > marketplaceSkills.length),
      );
      onMarketplaceTotalChange((total) => result.total ?? total ?? result.items.length);
    } catch (error) {
      onMarketplaceErrorChange(error instanceof Error ? error.message : "加载 ClawHub 市场失败");
    } finally {
      onMarketplaceLoadingChange(false);
    }
  }

  async function openMarketplaceDetail(slug: string): Promise<void> {
    onMarketplaceDetailChange(await window.marloues.skill.marketplaceDetail(slug));
    onSkillDetailChange(null);
  }

  async function installMarketplaceSkill(slug: string): Promise<void> {
    if (installingSlug) return;
    setInstallingSlug(slug);
    try {
      const nextSkills = await window.marloues.skill.marketplaceInstall(slug);
      onSkillsChange(nextSkills);
      onMarketplaceSkillsChange((items) =>
        items.map((item) => (item.slug === slug ? { ...item, installed: true } : item)),
      );
      onMarketplaceDetailChange((detail) => (detail?.slug === slug ? { ...detail, installed: true } : detail));
      notify({ title: "Skill 已安装", description: slug, tone: "success" });
    } catch (error) {
      notify({
        title: "安装 Skill 失败",
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    } finally {
      setInstallingSlug(null);
    }
  }

  async function removeInstalledSkill(skill: SkillInfo): Promise<void> {
    if (!skill.removable || removingSkillId) return;
    setRemovingSkillId(skill.id);
    try {
      const nextSkills = await window.marloues.skill.remove(skill.id);
      onSkillsChange(nextSkills);
      onSkillDetailChange(null);
      if (skill.scope === "marketplace") {
        onMarketplaceSkillsChange((items) =>
          items.map((item) => (item.slug === skill.name ? { ...item, installed: false } : item)),
        );
        onMarketplaceDetailChange((detail) => (detail?.slug === skill.name ? { ...detail, installed: false } : detail));
      }
      notify({ title: "Skill 已删除", description: skill.name, tone: "success" });
    } catch (error) {
      notify({
        title: "删除 Skill 失败",
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    } finally {
      setRemovingSkillId(null);
    }
  }

  return (
    <div className={`skill-page-panel ${skillTab}`}>
      <div className="skill-page-tabs" aria-label="Skill 分类">
        <button
          className={skillTab === "installed" ? "active" : ""}
          type="button"
          onClick={() => onSkillTabChange("installed")}
        >
          已安装
        </button>
        <button
          className={skillTab === "market" ? "active" : ""}
          type="button"
          onClick={() => onSkillTabChange("market")}
        >
          市场
        </button>
        <button
          className={skillTab === "import" ? "active" : ""}
          type="button"
          onClick={() => onSkillTabChange("import")}
        >
          导入
        </button>
      </div>

      <div className="skill-page-summary">
        <div>
          <h2>{summaryTitle}</h2>
          <p>{summaryBody}</p>
        </div>
        <button
          type="button"
          title="刷新"
          onClick={async () => {
            if (skillTab === "market") {
              await refreshMarketplace();
              return;
            }
            onSkillsChange(await window.marloues.skill.list());
          }}
        >
          <RefreshCcw size={14} />
        </button>
      </div>

      {skillTab === "installed" && runtimeSkills.length ? (
        <div className="settings-runtime-panel">
          <div>
            <strong>SDK init Skills</strong>
            <small>这些 Skill 已被最近一次 SDK session 识别</small>
          </div>
          <div className="settings-chip-row">
            {runtimeSkills.map((skill) => (
              <span className="settings-chip ok" key={skill}>
                {skill}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {skillTab === "installed" ? (
        <div className="skill-grid">
          {visibleSkills.length === 0 ? <div className="skill-empty-state">暂无已安装的 Skills</div> : null}
          {skills.map((skill) => (
            <div
              className={`settings-row-card skill-list-row ${skill.enabled ? "" : "disabled"}`}
              key={skill.id}
              role="button"
              tabIndex={0}
              onClick={async () => onSkillDetailChange(await window.marloues.skill.getDetail(skill.id))}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                void window.marloues.skill.getDetail(skill.id).then(onSkillDetailChange);
              }}
            >
              <div className="skill-row-icon" aria-hidden="true">
                <Package size={18} />
              </div>
              <div className="skill-row-copy">
                <div className="skill-row-title">
                  <strong>{skill.name}</strong>
                  <small>
                    {scopeLabel(skill.scope)}
                    {skill.version ? ` · v${skill.version}` : ""}
                    {skill.integrityStatus ? ` · ${integrityLabel(skill.integrityStatus)}` : ""}
                  </small>
                </div>
                <p>{skill.description || skill.path}</p>
              </div>
              <div
                className="skill-row-actions"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <button
                  title="查看详情"
                  onClick={async () => {
                    onSkillDetailChange(await window.marloues.skill.getDetail(skill.id));
                  }}
                >
                  <FileText size={14} />
                </button>
                {skill.removable ? (
                  <button
                    title="删除"
                    disabled={removingSkillId === skill.id}
                    onClick={() => {
                      void removeInstalledSkill(skill);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                ) : null}
                <button
                  className={`skill-switch ${skill.enabled ? "is-enabled" : "is-disabled"}`}
                  disabled={!canToggleSkills}
                  type="button"
                  role="switch"
                  aria-checked={skill.enabled}
                  aria-label={`${skill.enabled ? "禁用" : "启用"} ${skill.name}`}
                  title={canToggleSkills ? (skill.enabled ? "禁用" : "启用") : "企业策略禁止修改 Skill 启用状态"}
                  onClick={async () => {
                    onSkillsChange(await window.marloues.skill.toggle(skill.id, !skill.enabled));
                  }}
                >
                  <span />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {skillTab === "market" ? (
        <div className="skill-market-pane">
          <form
            className="skill-market-toolbar"
            onSubmit={(event) => {
              event.preventDefault();
              void refreshMarketplace(marketplaceQuery);
            }}
          >
            <label>
              <Search size={14} />
              <input
                placeholder={"\u641c\u7d22 ClawHub Skill"}
                value={marketplaceQuery}
                onChange={(event) => onMarketplaceQueryChange(event.target.value)}
              />
            </label>
            <button type="submit">{"\u641c\u7d22"}</button>
          </form>
          <div className="skill-market-results-bar">
            <span>{formatMarketplaceResultsLabel(marketplaceSkills.length, marketplaceTotal)}</span>
            <span className="skill-market-view-toggle" role="group" aria-label="市场显示方式">
              <button
                className={marketplaceView === "list" ? "active" : ""}
                type="button"
                title="列表"
                onClick={() => onMarketplaceViewChange("list")}
              >
                <ListIcon size={14} />
                List
              </button>
              <button
                className={marketplaceView === "grid" ? "active" : ""}
                type="button"
                title="卡片"
                onClick={() => onMarketplaceViewChange("grid")}
              >
                <LayoutGrid size={14} />
                Grid
              </button>
            </span>
          </div>
          <div className={`skill-market-results scrollbar-thin ${marketplaceView}`}>
            {marketplaceLoading && marketplaceSkills.length === 0 ? (
              <div className="skill-market-loading" role="status" aria-label="正在加载 ClawHub 市场">
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span aria-hidden="true" />
              </div>
            ) : null}
            {marketplaceError ? <div className="skill-empty-state">{marketplaceError}</div> : null}
            {!marketplaceLoading && !marketplaceError && marketplaceSkills.length === 0 ? (
              <div className="skill-empty-state">
                {"\u5e02\u573a\u91cc\u8fd8\u6ca1\u6709\u53ef\u5c55\u793a\u7684 Skills"}
              </div>
            ) : null}
            {marketplaceSkills.map((skill) => (
              <div
                className={`skill-market-card ${marketplaceView === "list" ? "list" : ""} ${skill.installed ? "installed" : ""}`}
                key={skill.slug}
                role="button"
                tabIndex={0}
                onClick={() => void openMarketplaceDetail(skill.slug)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  void openMarketplaceDetail(skill.slug);
                }}
              >
                <span className="skill-market-card-head">
                  <span className="skill-row-icon" aria-hidden="true">
                    <Package size={18} />
                  </span>
                  <span>
                    <strong>{skill.name}</strong>
                    <small>
                      {skill.ownerHandle ? `@${skill.ownerHandle} - ` : ""}
                      {skill.updatedAt ? `Updated ${formatRelativeTime(skill.updatedAt)} - ` : ""}
                      {skill.version ? `v${skill.version}` : skill.slug}
                    </small>
                  </span>
                </span>
                <span className="skill-market-description">{skill.description || skill.sourceUrl}</span>
                <span className="skill-market-meta">
                  <span>{formatCount(skill.stars)} stars</span>
                  <span>{formatCount(skill.downloads)} downloads</span>
                </span>
                <button
                  className="skill-market-install"
                  type="button"
                  disabled={skill.installed || installingSlug === skill.slug}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!skill.installed) void installMarketplaceSkill(skill.slug);
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  {installingSlug === skill.slug ? "安装中" : skill.installed ? "\u5df2\u5b89\u88c5" : "\u5b89\u88c5"}
                </button>
              </div>
            ))}
            {marketplaceSkills.length > 0 && (marketplaceLoading || marketplaceHasMore) ? (
              <div className="skill-market-load-more" ref={marketplaceLoadMoreRef}>
                {marketplaceLoading ? (
                  <span className="skill-market-loading compact" role="status" aria-label="正在加载更多 ClawHub Skills">
                    <span aria-hidden="true" />
                    <span aria-hidden="true" />
                    <span aria-hidden="true" />
                  </span>
                ) : (
                  <button type="button" onClick={() => void loadMoreMarketplace()}>
                    加载更多
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {skillTab === "import" ? (
        <div className="skill-import-state">
          <Package size={18} />
          <strong>导入本地 Skill 文件夹</strong>
          <p>选择包含 SKILL.md 的文件夹，导入后会出现在已安装列表中。</p>
          <button
            type="button"
            onClick={async () => {
              await window.marloues.skill.importFolder();
              onSkillsChange(await window.marloues.skill.list());
              onSkillTabChange("installed");
            }}
          >
            <Package size={14} />
            选择文件夹
          </button>
        </div>
      ) : null}

      {skillTab !== "import" && skillDetail ? (
        <div className="skill-detail-overlay" role="presentation" onMouseDown={() => onSkillDetailChange(null)}>
          <div
            className="skill-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${skillDetail.name} 详情`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="skill-detail-head">
              <div className="skill-row-icon" aria-hidden="true">
                <Package size={18} />
              </div>
              <div>
                <strong>{skillDetail.name}</strong>
                <small>
                  {scopeLabel(skillDetail.scope)}
                  {skillDetail.version ? ` · v${skillDetail.version}` : ""}
                  {skillDetail.integrityStatus ? ` · ${integrityLabel(skillDetail.integrityStatus)}` : ""}
                </small>
              </div>
              <button title="关闭" onClick={() => onSkillDetailChange(null)}>
                <X size={15} />
              </button>
            </div>
            {skillDetail.description ? <p className="skill-detail-description">{skillDetail.description}</p> : null}
            {skillDetail.permissions?.length ? (
              <div className="settings-chip-row">
                {skillDetail.permissions.map((permission) => (
                  <span className="settings-chip" key={permission}>
                    {permission}
                  </span>
                ))}
              </div>
            ) : null}
            <pre>{skillDetail.content}</pre>
            {skillDetail.removable ? (
              <div className="skill-detail-actions">
                <button
                  className="danger"
                  type="button"
                  disabled={removingSkillId === skillDetail.id}
                  onClick={() => void removeInstalledSkill(skillDetail)}
                >
                  <Trash2 size={14} />
                  {removingSkillId === skillDetail.id ? "删除中" : "删除 Skill"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {skillTab === "market" && marketplaceDetail ? (
        <div className="skill-detail-overlay" role="presentation" onMouseDown={() => onMarketplaceDetailChange(null)}>
          <div
            className="skill-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${marketplaceDetail.name} detail`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="skill-detail-head">
              <div className="skill-row-icon" aria-hidden="true">
                <Package size={18} />
              </div>
              <div>
                <strong>{marketplaceDetail.name}</strong>
                <small>
                  {marketplaceDetail.ownerHandle ? `${marketplaceDetail.ownerHandle} - ` : ""}
                  {marketplaceDetail.version ? `v${marketplaceDetail.version}` : marketplaceDetail.slug}
                  {marketplaceDetail.securityStatus ? ` - ${securityLabel(marketplaceDetail.securityStatus)}` : ""}
                </small>
              </div>
              <button title={"\u5173\u95ed"} onClick={() => onMarketplaceDetailChange(null)}>
                <X size={15} />
              </button>
            </div>
            {marketplaceDetail.description ? (
              <p className="skill-detail-description">{marketplaceDetail.description}</p>
            ) : null}
            {marketplaceDetail.securitySummary ? (
              <p className="skill-detail-description">{marketplaceDetail.securitySummary}</p>
            ) : null}
            <pre>{marketplaceDetail.content}</pre>
            {!marketplaceDetail.installed ? (
              <div className="skill-detail-actions">
                <button
                  className="primary"
                  type="button"
                  disabled={installingSlug === marketplaceDetail.slug || marketplaceDetail.securityStatus !== "clean"}
                  title={
                    marketplaceDetail.securityStatus === "clean"
                      ? "\u5b89\u88c5\u5230\u672c\u5730\u5e02\u573a"
                      : "\u5b89\u5168\u626b\u63cf\u672a\u901a\u8fc7\uff0c\u6682\u4e0d\u5141\u8bb8\u76f4\u63a5\u5b89\u88c5"
                  }
                  onClick={() => void installMarketplaceSkill(marketplaceDetail.slug)}
                >
                  <Download size={14} />
                  {installingSlug === marketplaceDetail.slug ? "安装中" : "\u5b89\u88c5"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AuditSettings({
  auditEvents,
  onAuditEventsChange,
  onStatus,
}: {
  auditEvents: AuditEventRecord[];
  onAuditEventsChange: (events: AuditEventRecord[]) => void;
  onStatus: (message: string, tone: "info" | "ok" | "error") => void;
}) {
  return (
    <SettingsCard
      title="工具调用审计"
      description="记录最近的工具启动与结果，方便排查权限、路径、端点和上下文。"
      icon={<FileText size={16} />}
    >
      <div className="settings-toolbar">
        <button onClick={async () => onAuditEventsChange(await window.marloues.audit.list(100))}>
          <RefreshCcw size={14} />
          刷新
        </button>
        <button
          onClick={async () => {
            const filePath = await window.marloues.app.exportDiagnostics();
            if (filePath) onStatus(`诊断包已导出：${filePath}`, "ok");
          }}
        >
          <FileText size={14} />
          导出诊断包
        </button>
      </div>
      <div className="audit-event-list">
        {auditEvents.length === 0 ? (
          <EmptySettingsState
            title="还没有审计记录"
            body="发送一次会触发工具的对话后，这里会显示工具名称、端点、输入摘要、输出摘要和执行状态。"
          />
        ) : null}
        {auditEvents.map((event) => (
          <div className={`audit-event-card ${event.isError ? "is-error" : ""}`} key={event.id}>
            <div className="audit-card-header">
              <span className="audit-card-tool">
                <TerminalSquare size={15} />
                <strong>{event.toolName}</strong>
              </span>
              <span
                className={`audit-status-badge ${event.isError ? "error" : event.status === "completed" ? "ok" : "pending"}`}
              >
                {event.isError ? "失败" : event.status === "completed" ? "成功" : event.status}
              </span>
            </div>
            <div className="audit-card-meta">
              <span>{new Date(event.createdAt).toLocaleString()}</span>
              {event.endpointProfileName ? <span>{event.endpointProfileName}</span> : null}
              {event.workspacePath ? <span className="audit-card-path">{event.workspacePath}</span> : null}
            </div>
            {event.inputSummary ? (
              <div className="audit-card-section">
                <span className="audit-card-label">输入</span>
                <pre className="audit-card-code">{event.inputSummary}</pre>
              </div>
            ) : null}
            {event.outputSummary ? (
              <div className="audit-card-section">
                <span className="audit-card-label">输出</span>
                <pre className="audit-card-code">{event.outputSummary}</pre>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </SettingsCard>
  );
}

export function RuntimeSettings({
  draft,
  isPermissionTimeoutManaged,
  onCommitDraft,
  onSwitchRuntime,
  runtimeState,
}: {
  draft: AgentSettings;
  isPermissionTimeoutManaged: boolean;
  onCommitDraft: (nextDraft: AgentSettings) => void;
  onSwitchRuntime: (runtimeId: RuntimeKind) => Promise<void>;
  runtimeState: RuntimeState | null;
}) {
  const policy = draft.toolPermissionPolicy;
  const sensitiveToolAllowlist = policy?.sensitiveToolAllowlist ?? ["Read", "Glob", "Grep", "LS", "TodoWrite"];

  return (
    <SettingsCard
      title="运行限制"
      description="让长任务保持可控，并方便检查执行过程。"
      icon={<ShieldCheck size={16} />}
    >
      <div className="runtime-card-list">
        {(runtimeState?.runtimes ?? []).map((runtime) => {
          const isActive = runtimeState?.activeRuntimeId === runtime.id;
          const disabled = runtime.status !== "available";
          return (
            <button
              className={`runtime-card ${isActive ? "active" : ""}`}
              disabled={disabled || isActive}
              key={runtime.id}
              title={runtime.statusReason}
              type="button"
              onClick={() => void onSwitchRuntime(runtime.id)}
            >
              <span>
                <strong>{runtime.name}</strong>
                <small>{runtime.description}</small>
              </span>
             <span className="runtime-status-indicator">
               <span className={`status-dot ${disabled ? "red" : isActive ? "green" : "gray"}`} aria-hidden="true" />
               <em className={disabled ? "error" : isActive ? "ok" : "pending"}>
                  {isActive ? "当前" : disabled ? "未接入" : "可切换"}
                </em>
              </span>
              {runtime.statusReason ? <small>{runtime.statusReason}</small> : null}
            </button>
          );
        })}
      </div>
      <label>
        权限模式
        <select
          value={draft.permissionMode}
          onChange={(event) =>
            onCommitDraft({ ...draft, permissionMode: event.target.value as typeof draft.permissionMode })
          }
        >
          <option value="default">默认</option>
          <option value="acceptEdits">自动接受编辑</option>
          <option value="bypassPermissions">完全访问</option>
        </select>
      </label>
      <label>
        最大轮次
        <input
          type="number"
          value={draft.maxTurns}
          onChange={(event) => onCommitDraft({ ...draft, maxTurns: Number(event.target.value) || 50 })}
        />
      </label>
      <label>
        审批超时（秒）
        <input
          type="number"
          min={10}
          max={3600}
          disabled={isPermissionTimeoutManaged}
          title={isPermissionTimeoutManaged ? "由企业配置管理" : "设置敏感工具审批自动拒绝时间"}
          value={Math.round((draft.permissionApprovalTimeoutMs ?? 120_000) / 1000)}
          onChange={(event) =>
            onCommitDraft({
              ...draft,
              permissionApprovalTimeoutMs: Math.min(Math.max(Number(event.target.value) || 120, 10), 3600) * 1000,
            })
          }
        />
      </label>
      <label>
        最大思考 Token
        <input
          type="number"
          value={draft.maxThinkingTokens}
          onChange={(event) => onCommitDraft({ ...draft, maxThinkingTokens: Number(event.target.value) || 0 })}
        />
      </label>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={draft.thinkingEnabled}
          onChange={(event) => onCommitDraft({ ...draft, thinkingEnabled: event.target.checked })}
        />
        启用思考
      </label>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={policy?.requireConfirmationForSensitiveTools ?? true}
          onChange={(event) =>
            onCommitDraft({
              ...draft,
              toolPermissionPolicy: {
                ...policy,
                sensitiveToolAllowlist,
                requireConfirmationForSensitiveTools: event.target.checked,
              },
            })
          }
        />
        敏感工具需要确认
      </label>
      <label>
        敏感工具白名单
        <textarea
          value={sensitiveToolAllowlist.join("\n")}
          onChange={(event) =>
            onCommitDraft({
              ...draft,
              toolPermissionPolicy: {
                ...policy,
                requireConfirmationForSensitiveTools: policy?.requireConfirmationForSensitiveTools ?? true,
                sensitiveToolAllowlist: splitLines(event.target.value),
              },
            })
          }
        />
      </label>
      <label>
        allowedTools
        <textarea readOnly value={(policy?.allowedTools ?? []).join("\n")} />
      </label>
      <label>
        disallowedTools
        <textarea readOnly value={(policy?.disallowedTools ?? []).join("\n")} />
      </label>
    </SettingsCard>
  );
}

function scopeLabel(scope: SkillInfo["scope"]): string {
  if (scope === "marketplace") return "市场";
  if (scope === "enterprise") return "企业";
  if (scope === "project") return "项目";
  return "用户";
}

function integrityLabel(status: NonNullable<SkillInfo["integrityStatus"]>): string {
  if (status === "verified") return "已校验";
  if (status === "failed") return "校验失败";
  return "未校验";
}

function securityLabel(status: NonNullable<SkillMarketplaceDetail["securityStatus"]>): string {
  if (status === "clean") return "\u5b89\u5168";
  if (status === "warning") return "\u6709\u8b66\u544a";
  if (status === "suspicious") return "\u53ef\u7591";
  return "\u672a\u626b\u63cf";
}

function formatCount(value?: number): string {
  if (typeof value !== "number") return "0";
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
  return String(value);
}

function formatRelativeTime(value: number): string {
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

function formatMarketplaceSummaryBody({
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

function formatMarketplaceResultsLabel(count: number, total?: number): string {
  if (typeof total === "number" && total > count) return `${formatCount(count)} / ${formatCount(total)} results`;
  return `${formatCount(count)} results`;
}

function normalizeMarketplaceResponse(
  response: Awaited<ReturnType<typeof window.marloues.skill.marketplaceList>> | SkillMarketplaceItem[],
): { items: SkillMarketplaceItem[]; nextCursor?: string; total?: number; hasMore: boolean } {
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

function mergeMarketplaceItems(current: SkillMarketplaceItem[], next: SkillMarketplaceItem[]): SkillMarketplaceItem[] {
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

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}
