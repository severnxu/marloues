import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Folder,
  FolderOpen,
  Pencil,
  PlugZap,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type {
  McpServerConfig,
  SkillInfo,
  WorkspaceExtensionMode,
  WorkspaceInfo,
} from "@shared/types";
import { notify } from "@/lib/notifications";
import { Toggle } from "@/components/ui/toggle";
import { McpAddDialog } from "@/components/mcp/McpAddDialog";
import {
  buildMcpConfigFromDraft,
  emptyMcpAddDraft,
  readMcpArgs,
  readMcpCommand,
  readMcpType,
  readMcpUrl,
  type McpAddDraft,
  type McpAddMode,
} from "@/components/settings";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { SKILLS_CHANGED_EVENT } from "@/components/workbench/events";
import styles from "./ProjectConfigDialog.module.css";

type ConfigTab = "basic" | "skills" | "mcp";

function basenameOf(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export function ProjectConfigDialog({
  project,
  mode = "edit",
  onClose,
  onAdded,
}: {
  project?: WorkspaceInfo;
  mode?: "create" | "edit";
  onClose: () => void;
  onAdded?: (workspace: WorkspaceInfo) => void;
}) {
  const isCreateMode = mode === "create";
  const updateConfig = useWorkspaceStore((state) => state.updateConfig);
  const createWorkspace = useWorkspaceStore((state) => state.createWorkspace);
  const pickFolder = useWorkspaceStore((state) => state.pickFolder);
  const [tab, setTab] = useState<ConfigTab>("basic");
  const [projectPath, setProjectPath] = useState(project?.path ?? "");
  const [name, setName] = useState(project?.name ?? "");
  const [tags, setTags] = useState((project?.tags ?? []).join(", "));
  const [skillMode, setSkillMode] = useState<WorkspaceExtensionMode>(
    project?.skillPolicy?.mode ?? "inherit",
  );
  const [includeProjectSkills, setIncludeProjectSkills] = useState(
    project?.skillPolicy?.includeProjectSkills !== false,
  );
  const [enabledSkillIds, setEnabledSkillIds] = useState<Set<string>>(
    () => new Set(project?.skillPolicy?.enabledSkillIds ?? []),
  );
  const [mcpMode, setMcpMode] = useState<WorkspaceExtensionMode>(
    project?.mcpPolicy?.mode ?? "inherit",
  );
  const [enabledServerIds, setEnabledServerIds] = useState<Set<string>>(
    () => new Set(project?.mcpPolicy?.enabledServerIds ?? []),
  );
  const [globalSkills, setGlobalSkills] = useState<SkillInfo[]>([]);
  const [projectSkills, setProjectSkills] = useState<SkillInfo[]>([]);
  const [globalMcpServers, setGlobalMcpServers] = useState<McpServerConfig[]>(
    [],
  );
  const [projectMcpServers, setProjectMcpServers] = useState<McpServerConfig[]>(
    () => project?.mcpPolicy?.projectServers ?? [],
  );
  const [mcpDialog, setMcpDialog] = useState<
    { kind: "create" } | { kind: "edit"; serverId: string } | null
  >(null);
  const [mcpAddMode, setMcpAddMode] = useState<McpAddMode>("stdio");
  const [mcpDraft, setMcpDraft] = useState<McpAddDraft>(() =>
    emptyMcpAddDraft(),
  );
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [browsing, setBrowsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const workspaceInventory = projectPath
      ? window.marloues.workspace.listSkills(
          project?.id ?? "pending-project",
          projectPath,
        )
      : Promise.resolve([] as SkillInfo[]);
    void Promise.all([
      window.marloues.skill.list(),
      workspaceInventory,
      window.marloues.config.getAgentSettings(),
    ])
      .then(([globalInventory, workspaceInventory, settings]) => {
        if (cancelled) return;
        const global = globalInventory.filter(
          (skill) => skill.scope !== "project",
        );
        setGlobalSkills(global);
        setProjectSkills(
          workspaceInventory.filter((skill) => skill.scope === "project"),
        );
        setGlobalMcpServers(settings.mcpServers);
        if (!project?.skillPolicy) {
          setEnabledSkillIds(
            new Set(
              global.filter((skill) => skill.enabled).map((skill) => skill.id),
            ),
          );
        }
        if (!project?.mcpPolicy) {
          setEnabledServerIds(
            new Set(
              settings.mcpServers
                .filter((server) => server.enabled)
                .map((server) => server.id),
            ),
          );
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project, projectPath]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving && !mcpDialog) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mcpDialog, onClose, saving]);

  const effectiveSkillCount = useMemo(
    () =>
      (skillMode === "inherit"
        ? globalSkills.filter((skill) => skill.enabled).length
        : globalSkills.filter(
            (skill) => skill.enabled && enabledSkillIds.has(skill.id),
          ).length) + (includeProjectSkills ? projectSkills.length : 0),
    [
      enabledSkillIds,
      globalSkills,
      includeProjectSkills,
      projectSkills.length,
      skillMode,
    ],
  );
  const effectiveMcpCount = useMemo(
    () =>
      (mcpMode === "inherit"
        ? globalMcpServers.filter((server) => server.enabled).length
        : globalMcpServers.filter(
            (server) => server.enabled && enabledServerIds.has(server.id),
          ).length) +
      projectMcpServers.filter((server) => server.enabled).length,
    [enabledServerIds, globalMcpServers, mcpMode, projectMcpServers],
  );

  const selectSkillMode = (mode: WorkspaceExtensionMode) => {
    if (mode === "custom" && skillMode !== "custom") {
      setEnabledSkillIds(
        new Set(
          globalSkills
            .filter((skill) => skill.enabled)
            .map((skill) => skill.id),
        ),
      );
    }
    setSkillMode(mode);
  };

  const selectMcpMode = (mode: WorkspaceExtensionMode) => {
    if (mode === "custom" && mcpMode !== "custom") {
      setEnabledServerIds(
        new Set(
          globalMcpServers
            .filter((server) => server.enabled)
            .map((server) => server.id),
        ),
      );
    }
    setMcpMode(mode);
  };

  const browseProjectFolder = async () => {
    if (browsing) return;
    setBrowsing(true);
    try {
      const selectedPath = await pickFolder();
      if (!selectedPath) return;
      const previousDefaultName = basenameOf(projectPath);
      setProjectPath(selectedPath);
      if (!name.trim() || name.trim() === previousDefaultName) {
        setName(basenameOf(selectedPath));
      }
    } catch (error) {
      notify({
        title: "无法打开目录选择器",
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    } finally {
      setBrowsing(false);
    }
  };

  const save = async () => {
    if (!name.trim() || !projectPath || (!isCreateMode && !project)) return;
    setSaving(true);
    try {
      const update = {
        name: name.trim(),
        tags: tags
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        skillPolicy: {
          mode: skillMode,
          enabledSkillIds: Array.from(enabledSkillIds),
          includeProjectSkills,
        },
        mcpPolicy: {
          mode: mcpMode,
          enabledServerIds: Array.from(enabledServerIds),
          projectServers: projectMcpServers,
        },
      };
      const saved = isCreateMode
        ? await createWorkspace({ path: projectPath, ...update })
        : await updateConfig(project!.id, update);
      window.dispatchEvent(new CustomEvent(SKILLS_CHANGED_EVENT));
      notify({
        title: isCreateMode ? "项目已添加" : "项目配置已保存",
        description: projectPath,
        tone: "success",
      });
      if (isCreateMode) onAdded?.(saved);
      onClose();
    } catch (error) {
      notify({
        title: isCreateMode ? "项目添加失败" : "项目配置保存失败",
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const openCreateMcp = () => {
    setMcpAddMode("stdio");
    setMcpDraft(emptyMcpAddDraft());
    setMcpError(null);
    setMcpDialog({ kind: "create" });
  };

  const openEditMcp = (server: McpServerConfig) => {
    const mode = readMcpType(server.config);
    setMcpAddMode(mode);
    setMcpDraft({
      name: server.name,
      command: readMcpCommand(server.config),
      args: readMcpArgs(server.config),
      url: readMcpUrl(server.config),
      json: JSON.stringify(server.config ?? {}, null, 2),
      enabled: server.enabled,
    });
    setMcpError(null);
    setMcpDialog({ kind: "edit", serverId: server.id });
  };

  const submitProjectMcp = () => {
    const nextName = mcpDraft.name.trim();
    const config = buildMcpConfigFromDraft(mcpAddMode, mcpDraft);
    if (!nextName || !config) {
      setMcpError("请填写服务名称和有效的连接配置。");
      return;
    }
    if (mcpDialog?.kind === "edit") {
      setProjectMcpServers((current) =>
        current.map((server) =>
          server.id === mcpDialog.serverId
            ? {
                ...server,
                name: nextName,
                config,
                enabled: mcpDraft.enabled,
              }
            : server,
        ),
      );
    } else {
      setProjectMcpServers((current) => [
        ...current,
        {
          id: `project:${crypto.randomUUID()}`,
          name: nextName,
          config,
          enabled: mcpDraft.enabled,
          source: "local",
          lastStatus: "untested",
        },
      ]);
    }
    setMcpDialog(null);
    setMcpError(null);
  };

  return createPortal(
    <div
      className={styles.overlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-config-title"
        data-testid="project-config-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div className={styles.title}>
            <span className={styles.projectIcon}>
              <Folder size={17} aria-hidden="true" />
            </span>
            <div>
              <strong id="project-config-title">
                {isCreateMode ? "添加项目" : "项目配置"}
              </strong>
              <small>
                {isCreateMode
                  ? projectPath || "选择目录并配置项目能力"
                  : projectPath}
              </small>
            </div>
          </div>
          <button className={styles.close} type="button" onClick={onClose}>
            <X size={16} aria-hidden="true" />
            <span className="sr-only">关闭</span>
          </button>
        </header>

        <nav
          className={styles.tabs}
          aria-label={isCreateMode ? "添加项目配置分类" : "项目配置分类"}
        >
          <TabButton active={tab === "basic"} onClick={() => setTab("basic")}>
            <Settings size={15} /> 基本信息
          </TabButton>
          <TabButton active={tab === "skills"} onClick={() => setTab("skills")}>
            <Sparkles size={15} /> Skill <Count value={effectiveSkillCount} />
          </TabButton>
          <TabButton active={tab === "mcp"} onClick={() => setTab("mcp")}>
            <PlugZap size={15} /> MCP <Count value={effectiveMcpCount} />
          </TabButton>
        </nav>

        <div className={`${styles.body} scrollbar-thin`}>
          {loadError ? <p className={styles.error}>{loadError}</p> : null}
          {tab === "basic" ? (
            <div className={styles.form}>
              <label className={styles.field}>
                <span>项目目录</span>
                <div className={styles.pathPicker}>
                  <input
                    value={projectPath}
                    readOnly
                    placeholder="点击浏览选择项目文件夹"
                  />
                  {isCreateMode ? (
                    <button
                      type="button"
                      disabled={browsing}
                      onClick={() => void browseProjectFolder()}
                    >
                      <FolderOpen size={14} aria-hidden="true" />
                      {browsing ? "打开中..." : "浏览"}
                    </button>
                  ) : null}
                </div>
                <small>
                  {isCreateMode
                    ? "选择文件夹后再配置名称、Skill 和 MCP；确认前不会创建项目。"
                    : "项目配置只影响从这个目录创建或继续的任务。"}
                </small>
              </label>
              <label className={styles.field}>
                <span>项目名称</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={
                    projectPath ? basenameOf(projectPath) : "选择目录后自动填写"
                  }
                />
              </label>
              <label className={styles.field}>
                <span>标签</span>
                <input
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  placeholder="例如：前端, 内部项目"
                />
                <small>用逗号分隔多个标签。</small>
              </label>
            </div>
          ) : null}

          {tab === "skills" ? (
            <ExtensionSection
              title="项目可用 Skill"
              description="继承全局配置，或为当前项目固定一份白名单。项目目录中的 Skill 单独控制。"
              mode={skillMode}
              onMode={selectSkillMode}
            >
              <div className={styles.localControl}>
                <div>
                  <strong>加载项目目录中的 Skill</strong>
                  <small>
                    .marloues/skills、.claude/skills、.agents/skills
                  </small>
                </div>
                <Toggle
                  checked={includeProjectSkills}
                  onChange={setIncludeProjectSkills}
                  label="加载项目 Skill"
                />
              </div>
              <div className={styles.list}>
                {loading ? <LoadingRow label="正在读取 Skill..." /> : null}
                {!loading && !globalSkills.length ? (
                  <EmptyRow label="暂无已安装的全局 Skill" />
                ) : null}
                {globalSkills.map((skill) => {
                  const checked =
                    skillMode === "inherit"
                      ? skill.enabled
                      : skill.enabled && enabledSkillIds.has(skill.id);
                  return (
                    <ExtensionRow
                      key={skill.id}
                      title={skill.name}
                      meta={`${scopeLabel(skill.scope)}${
                        skill.version ? ` · v${skill.version}` : ""
                      }`}
                      checked={checked}
                      disabled={skillMode === "inherit" || !skill.enabled}
                      onChange={(next) =>
                        setEnabledSkillIds((current) =>
                          toggleSetValue(current, skill.id, next),
                        )
                      }
                    />
                  );
                })}
              </div>
              {projectSkills.length ? (
                <p className={styles.projectHint}>
                  已发现 {projectSkills.length} 个项目
                  Skill；关闭上方开关后将全部隔离。
                </p>
              ) : null}
            </ExtensionSection>
          ) : null}

          {tab === "mcp" ? (
            <ExtensionSection
              title="项目可用 MCP"
              description="这里控制 Agent 实际收到的 MCP 配置；自定义模式不会自动加入以后新安装的服务。"
              mode={mcpMode}
              onMode={selectMcpMode}
            >
              <div className={styles.list}>
                {loading ? <LoadingRow label="正在读取 MCP 配置..." /> : null}
                {!loading && !globalMcpServers.length ? (
                  <EmptyRow label="暂无已配置的 MCP 服务" />
                ) : null}
                {globalMcpServers.map((server) => (
                  <ExtensionRow
                    key={server.id}
                    title={server.name}
                    meta={`${mcpTransportLabel(server)} · ${
                      server.enabled ? "全局已启用" : "全局已停用"
                    }`}
                    checked={
                      mcpMode === "inherit"
                        ? server.enabled
                        : server.enabled && enabledServerIds.has(server.id)
                    }
                    disabled={mcpMode === "inherit" || !server.enabled}
                    onChange={(next) =>
                      setEnabledServerIds((current) =>
                        toggleSetValue(current, server.id, next),
                      )
                    }
                  />
                ))}
              </div>
              <div className={styles.subsectionHead}>
                <div>
                  <strong>项目专用 MCP</strong>
                  <small>仅保存在当前项目配置中，不进入全局服务列表。</small>
                </div>
                <button type="button" onClick={openCreateMcp}>
                  <Plus size={14} /> 添加服务
                </button>
              </div>
              <div className={styles.list}>
                {!projectMcpServers.length ? (
                  <EmptyRow label="暂无项目专用 MCP" />
                ) : null}
                {projectMcpServers.map((server) => (
                  <div className={styles.row} key={server.id}>
                    <div>
                      <strong>{server.name}</strong>
                      <small>{mcpTransportLabel(server)} · 项目专用</small>
                    </div>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        title={`编辑 ${server.name}`}
                        onClick={() => openEditMcp(server)}
                      >
                        <Pencil size={14} />
                      </button>
                      <Toggle
                        checked={server.enabled}
                        onChange={(enabled) =>
                          setProjectMcpServers((current) =>
                            current.map((item) =>
                              item.id === server.id
                                ? { ...item, enabled }
                                : item,
                            ),
                          )
                        }
                        label={`${server.enabled ? "停用" : "启用"} ${
                          server.name
                        }`}
                      />
                      <button
                        type="button"
                        className={styles.deleteAction}
                        title={`移除 ${server.name}`}
                        onClick={() =>
                          setProjectMcpServers((current) =>
                            current.filter((item) => item.id !== server.id),
                          )
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </ExtensionSection>
          ) : null}
        </div>

        <footer className={styles.footer}>
          <span>
            {isCreateMode
              ? "确认后一次创建，Skill 与 MCP 从首个 Agent 会话开始生效。"
              : "配置将在下一次新建或恢复 Agent 会话时生效。"}
          </span>
          <div>
            <button type="button" onClick={onClose} disabled={saving}>
              取消
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void save()}
              disabled={saving || !name.trim() || !projectPath}
            >
              {saving
                ? isCreateMode
                  ? "添加中..."
                  : "保存中..."
                : isCreateMode
                  ? "确认添加"
                  : "保存配置"}
            </button>
          </div>
        </footer>
      </section>
      {mcpDialog ? (
        <McpAddDialog
          mode={mcpAddMode}
          setMode={setMcpAddMode}
          draft={mcpDraft}
          setDraft={setMcpDraft}
          canEdit
          saving={false}
          editing={mcpDialog.kind === "edit"}
          error={mcpError}
          onSubmit={submitProjectMcp}
          onCancel={() => setMcpDialog(null)}
          onReset={() => {
            if (mcpDialog.kind === "edit") {
              const server = projectMcpServers.find(
                (item) => item.id === mcpDialog.serverId,
              );
              if (server) openEditMcp(server);
            } else {
              setMcpDraft(emptyMcpAddDraft());
              setMcpError(null);
            }
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={active ? styles.tabActive : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Count({ value }: { value: number }) {
  return <span className={styles.count}>{value}</span>;
}

function ExtensionSection({
  title,
  description,
  mode,
  onMode,
  children,
}: {
  title: string;
  description: string;
  mode: WorkspaceExtensionMode;
  onMode: (mode: WorkspaceExtensionMode) => void;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.extensionSection}>
      <div className={styles.sectionHead}>
        <div>
          <strong>{title}</strong>
          <p>{description}</p>
        </div>
        <div className={styles.modeSwitch}>
          <button
            type="button"
            className={mode === "inherit" ? styles.modeActive : undefined}
            onClick={() => onMode("inherit")}
          >
            继承全局
          </button>
          <button
            type="button"
            className={mode === "custom" ? styles.modeActive : undefined}
            onClick={() => onMode("custom")}
          >
            自定义
          </button>
        </div>
      </div>
      {children}
    </section>
  );
}

function ExtensionRow({
  title,
  meta,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  meta: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className={styles.row}>
      <div>
        <strong>{title}</strong>
        <small>{meta}</small>
      </div>
      <Toggle
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        label={`${checked ? "停用" : "启用"} ${title}`}
      />
    </div>
  );
}

function LoadingRow({ label }: { label: string }) {
  return <div className={styles.message}>{label}</div>;
}

function EmptyRow({ label }: { label: string }) {
  return <div className={styles.message}>{label}</div>;
}

function toggleSetValue(current: Set<string>, id: string, enabled: boolean) {
  const next = new Set(current);
  if (enabled) next.add(id);
  else next.delete(id);
  return next;
}

function scopeLabel(scope: SkillInfo["scope"]): string {
  if (scope === "enterprise") return "企业";
  if (scope === "marketplace") return "市场";
  return "全局";
}

function mcpTransportLabel(server: McpServerConfig): string {
  const config = asRecord(server.config);
  return typeof config.url === "string" ? "HTTP" : "STDIO";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
