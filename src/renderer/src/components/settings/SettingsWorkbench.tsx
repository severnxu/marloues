import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  PlugZap,
  Plus,
  Power,
  RefreshCcw,
  ServerCog,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { notify } from "@/lib/notifications";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useThemeStore } from "@/stores/theme-store";
import {
  AppearanceSettings,
  GeneralSettings,
  PersonalizationSettings,
} from "@/components/settings/sections/BasicSettingsSections";
import {
  AuditSettings,
  RuntimeSettings,
  SkillsSettings,
} from "@/components/settings/sections/SkillAuditRuntimeSettings";
import { SecuritySettings } from "@/components/settings/sections/SecuritySettings";
import { EmptySettingsState, SettingsCard, SettingsStat } from "@/components/settings/shared";
import type { SettingsSection } from "@/components/layout/types";
import type {
  AuditEventRecord,
  McpServerConfig,
  ModelOption,
  ModelProviderConfig,
  SkillDetail,
  SkillInfo,
  SkillMarketplaceDetail,
  SkillMarketplaceItem,
  TimelineItem,
} from "@shared/types";

import {
  buildMcpConfigFromDraft,
  buildRuntimeSnapshot,
  compactMcpArgs,
  emptyMcpAddDraft,
  formatMcpAddModeHint,
  formatMcpError,
  formatMcpServerSummary,
  formatMcpStatus,
  normalizeModelMetadataPatch,
  parseJsonLoose,
  readMcpArgs,
  readMcpCommand,
  readMcpConfigRecord,
  readMcpType,
  readMcpUrl,
  statusToastTitle,
  updateArrayValue,
  withModelMetadataDefaults,
  type McpAddDraft,
  type McpAddMode,
} from "@/components/settings/SettingsWorkbench.utils";
export function SettingsWorkbench({
  section,
  onSection: _onSection,
}: {
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
}) {
  const settings = useSettingsStore((state) => state.settings);
  const runtimeState = useSettingsStore((state) => state.runtimeState);
  const save = useSettingsStore((state) => state.save);
  const switchRuntime = useSettingsStore((state) => state.switchRuntime);
  const themeMode = useThemeStore((state) => state.mode);
  const setDark = useThemeStore((state) => state.setDark);
  const setThemeMode = useThemeStore((state) => state.setMode);
  const accentColor = useThemeStore((state) => state.accentColor);
  const setAccentColor = useThemeStore((state) => state.setAccentColor);
  const resetAccentColor = useThemeStore((state) => state.resetAccentColor);
  const sessions = useUnifiedChatStore((state) => state.sessions);
  const activeSessionId = useUnifiedChatStore((state) => state.activeSessionId);
  const liveTurns = useUnifiedChatStore((state) => state.liveTurns);
  const [draft, setDraft] = useState(settings);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillTab, setSkillTab] = useState<"installed" | "market" | "import">("installed");
  const [skillDetail, setSkillDetail] = useState<SkillDetail | null>(null);
  const [marketplaceSkills, setMarketplaceSkills] = useState<SkillMarketplaceItem[]>([]);
  const [marketplaceQuery, setMarketplaceQuery] = useState("");
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
  const [marketplaceDetail, setMarketplaceDetail] = useState<SkillMarketplaceDetail | null>(null);
  const [marketplaceCursor, setMarketplaceCursor] = useState<string | undefined>();
  const [marketplaceHasMore, setMarketplaceHasMore] = useState(false);
  const [marketplaceTotal, setMarketplaceTotal] = useState<number | undefined>();
  const [marketplaceView, setMarketplaceView] = useState<"grid" | "list">("grid");
  const [auditEvents, setAuditEvents] = useState<AuditEventRecord[]>([]);
  const [mcpAddMode, setMcpAddMode] = useState<McpAddMode>("stdio");
  const [mcpAddDraft, setMcpAddDraft] = useState<McpAddDraft>(() => emptyMcpAddDraft());
  const [mcpEditArgDrafts, setMcpEditArgDrafts] = useState<Record<string, string[]>>({});
  const [selectedMcpId, setSelectedMcpId] = useState<string | null>(null);
  const [expandedMcpIds, setExpandedMcpIds] = useState<Set<string>>(() => new Set());
  const [_status, setStatusState] = useState<{ message: string; tone: "info" | "ok" | "error" } | null>(null);
  const [checkingEndpointIds, setCheckingEndpointIds] = useState<Set<string>>(() => new Set());
  const [checkingModelIds, setCheckingModelIds] = useState<Set<string>>(() => new Set());
  const [fetchingModelIds, setFetchingModelIds] = useState<Set<string>>(() => new Set());
  const [checkingMcpIds, setCheckingMcpIds] = useState<Set<string>>(() => new Set());
  const [refreshingMcpStatus, setRefreshingMcpStatus] = useState(false);
  const [expandedProviderIds, setExpandedProviderIds] = useState<Set<string>>(() => new Set());
  const [visibleApiKeyProviderIds, setVisibleApiKeyProviderIds] = useState<Set<string>>(() => new Set());
  const [newProviderId, setNewProviderId] = useState<string | null>(null);
  const [modelImportDraft, setModelImportDraft] = useState<{
    providerId: string;
    models: ModelOption[];
    selectedIds: Set<string>;
  } | null>(null);
  const [manualModelDraft, setManualModelDraft] = useState<{ providerId: string; modelId: string } | null>(null);
  const manualModelRef = useRef<HTMLDivElement | null>(null);
  const providerEditRef = useRef<HTMLDivElement | null>(null);
  const [preventSleep, setPreventSleep] = useState(true);
  const [detailLevel, setDetailLevel] = useState<"default" | "coding">("default");

  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => {
    void window.marloues.skill.list().then(setSkills);
  }, []);
  useEffect(() => {
    if (!draft?.mcpServers.length) {
      setSelectedMcpId(null);
      return;
    }
    setSelectedMcpId((current) =>
      current && draft.mcpServers.some((server) => server.id === current) ? current : (draft.mcpServers[0]?.id ?? null),
    );
  }, [draft?.mcpServers]);
  useEffect(() => {
    if (section === "audit") {
      void window.marloues.audit.list(100).then(setAuditEvents);
    }
  }, [section]);
  useEffect(() => {
    if (!manualModelDraft) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && manualModelRef.current?.contains(target)) return;
      setManualModelDraft(null);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [manualModelDraft]);
  useEffect(() => {
    if (!draft || !newProviderId) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && providerEditRef.current?.contains(target)) return;

      discardNewProviderDraft(newProviderId);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [draft, newProviderId]);

  if (!draft) return <div className="settings-page">正在加载设置...</div>;

  const enterprisePolicy = draft.enterprisePolicy ?? {};
  const enterpriseControlledSettings = new Set(draft.enterpriseControlledSettings ?? []);
  const canEditEndpointProfiles = enterprisePolicy.allowLocalEndpointProfiles !== false;
  const canEditMcpServers = enterprisePolicy.allowLocalMcpServers !== false;
  const canToggleSkills = enterprisePolicy.allowLocalSkillDisable !== false;
  const enabledSkillCount = skills.filter((skill) => skill.enabled).length;
  const hasEnterpriseConfig = Boolean(draft.enterprisePolicy) || enterpriseControlledSettings.size > 0;
  const isPermissionTimeoutManaged = enterpriseControlledSettings.has("permissionApprovalTimeoutMs");
  const setStatus = (message: string, tone: "info" | "ok" | "error" = "info") => {
    setStatusState({ message, tone });
    notify({
      title: statusToastTitle(message, tone),
      description: message,
      tone: tone === "ok" ? "success" : tone,
    });
  };
  const commitDraft = async (nextDraft: typeof draft, message?: string, tone: "info" | "ok" | "error" = "ok") => {
    setDraft(nextDraft);
    await save(nextDraft);
    if (message) setStatus(message, tone);
  };

  const addEndpointProfile = () => {
    const id = crypto.randomUUID();
    setDraft({
      ...draft,
      providers: [
        {
          id,
          name: `Endpoint ${draft.providers.length + 1}`,
          type: "openai-compatible",
          enabled: true,
          baseUrl: "",
          apiKey: "",
          models: [],
        },
        ...draft.providers,
      ],
      defaultModel: draft.defaultModel,
    });
    setExpandedProviderIds((ids) => new Set(ids).add(id));
    setNewProviderId(id);
  };

  const removeEndpointProfile = async (providerId: string) => {
    if (draft.providers.length <= 1) {
      setStatus("至少需要保留一个模型端点 Profile。", "error");
      return;
    }
    const removedProvider = draft.providers.find((provider) => provider.id === providerId);
    const providers = draft.providers.filter((provider) => provider.id !== providerId);
    const fallback = providers[0];
    const fallbackModelId = fallback?.models.find((model) => model.enabled)?.id ?? fallback?.models[0]?.id ?? "";
    await commitDraft(
      {
        ...draft,
        providers,
        defaultModel:
          draft.defaultModel.providerId === providerId
            ? {
                providerId: fallback.id,
                modelId: fallbackModelId,
              }
            : draft.defaultModel,
      },
      `${removedProvider?.name || "供应商"} 已删除。`,
    );
  };

  const discardNewProviderDraft = (providerId: string) => {
    const providers = draft.providers.filter((provider) => provider.id !== providerId);
    const fallback = providers[0];
    const fallbackModelId = fallback?.models.find((model) => model.enabled)?.id ?? fallback?.models[0]?.id ?? "";
    setDraft({
      ...draft,
      providers,
      defaultModel:
        draft.defaultModel.providerId === providerId && fallback
          ? {
              providerId: fallback.id,
              modelId: fallbackModelId,
            }
          : draft.defaultModel,
    });
    setExpandedProviderIds((ids) => {
      const next = new Set(ids);
      next.delete(providerId);
      return next;
    });
    setNewProviderId(null);
  };

  const confirmNewProviderDraft = async (providerId: string) => {
    const provider = draft.providers.find((item) => item.id === providerId);
    if (!provider) return;
    if (!provider.baseUrl?.trim() || !provider.apiKey?.trim()) {
      setStatus("先填写 Base URL 和 API Key，再确认添加。", "error");
      return;
    }
    if (provider.models.length === 0) {
      setStatus("先添加至少一个模型，再确认添加供应商。", "error");
      return;
    }
    setNewProviderId(null);
    await commitDraft(draft, `${provider.name || "新供应商"} 已添加。`);
  };

  const toggleProviderExpanded = (providerId: string) => {
    setExpandedProviderIds((ids) => {
      const next = new Set(ids);
      if (next.has(providerId)) next.delete(providerId);
      else next.add(providerId);
      return next;
    });
  };

  const toggleApiKeyVisible = (providerId: string) => {
    setVisibleApiKeyProviderIds((ids) => {
      const next = new Set(ids);
      if (next.has(providerId)) next.delete(providerId);
      else next.add(providerId);
      return next;
    });
  };

  const toggleModelImportSelection = (modelId: string) => {
    if (!modelImportDraft) return;
    setModelImportDraft((current) => {
      if (!current) return current;
      const selectedIds = new Set(current.selectedIds);
      if (selectedIds.has(modelId)) selectedIds.delete(modelId);
      else selectedIds.add(modelId);
      return { ...current, selectedIds };
    });
  };

  const applyModelImport = async () => {
    if (!modelImportDraft) return;
    const provider = draft.providers.find((item) => item.id === modelImportDraft.providerId);
    if (!provider) {
      setModelImportDraft(null);
      return;
    }
    const currentIds = new Set(provider.models.map((model) => model.id));
    const selectedModels = modelImportDraft.models
      .filter((model) => modelImportDraft.selectedIds.has(model.id) && !currentIds.has(model.id))
      .map((model) => withModelMetadataDefaults({ ...model, enabled: true }));

    if (selectedModels.length === 0) {
      setStatus("先选择要添加的模型。", "error");
      return;
    }

    const nextDraft = {
      ...draft,
      providers: draft.providers.map((item) =>
        item.id === provider.id ? { ...item, models: [...item.models, ...selectedModels] } : item,
      ),
    };
    setModelImportDraft(null);
    await commitDraft(nextDraft, `${provider.name}: 已添加并启用 ${selectedModels.length} 个模型。`);
  };

  const applyManualModel = async () => {
    if (!manualModelDraft) return;
    const modelId = manualModelDraft.modelId.trim();
    const provider = draft.providers.find((item) => item.id === manualModelDraft.providerId);
    if (!provider) {
      setManualModelDraft(null);
      return;
    }
    if (!modelId) {
      setStatus("模型 ID 不能为空。", "error");
      return;
    }
    if (provider.models.some((model) => model.id === modelId)) {
      setStatus(`${provider.name}: 模型已存在：${modelId}`, "error");
      return;
    }
    const nextDraft = {
      ...draft,
      providers: draft.providers.map((item) =>
        item.id === provider.id
          ? {
              ...item,
              models: [...item.models, withModelMetadataDefaults({ id: modelId, label: modelId, enabled: true })],
            }
          : item,
      ),
    };
    setManualModelDraft(null);
    await commitDraft(nextDraft, `${provider.name}: 已手动添加并启用 ${modelId}。`);
  };

  const fetchProviderModels = async (providerId: string) => {
    const provider = draft.providers.find((item) => item.id === providerId);
    if (!provider) return;

    setFetchingModelIds((ids) => new Set(ids).add(providerId));
    setStatus(`正在获取 ${provider.name} 的模型列表...`);
    try {
      if (typeof window.marloues.config.listEndpointModels !== "function") {
        setStatus("当前窗口的 preload 还没刷新，新增的获取模型接口尚未注入。请重启应用窗口后再试。", "error");
        return;
      }
      const result = await window.marloues.config.listEndpointModels(provider);
      if (!result.ok || result.models.length === 0) {
        setStatus(
          `${provider.name}: ${result.message}${result.latencyMs !== undefined ? ` (${result.latencyMs}ms)` : ""}`,
          "error",
        );
        return;
      }

      const currentIds = new Set(provider.models.map((model) => model.id));
      const discoveredModels = result.models
        .filter((model) => !currentIds.has(model.id))
        .map((model) => ({ ...model, enabled: false }));
      if (discoveredModels.length === 0) {
        setStatus(
          `${provider.name}: 没有发现新的模型。${result.latencyMs !== undefined ? ` (${result.latencyMs}ms)` : ""}`,
          "ok",
        );
        setModelImportDraft((current) => (current?.providerId === providerId ? null : current));
        return;
      }

      setModelImportDraft({
        providerId,
        models: discoveredModels,
        selectedIds: new Set(),
      });
      setExpandedProviderIds((ids) => new Set(ids).add(providerId));
      setStatus(
        `${provider.name}: 发现 ${discoveredModels.length} 个新模型，勾选后点确定添加并启用。${result.latencyMs !== undefined ? ` (${result.latencyMs}ms)` : ""}`,
        "ok",
      );
    } finally {
      setFetchingModelIds((ids) => {
        const next = new Set(ids);
        next.delete(providerId);
        return next;
      });
    }
  };

  const removeProviderModel = async (providerId: string, modelId: string) => {
    const provider = draft.providers.find((item) => item.id === providerId);
    if (!provider) {
      return;
    }
    const models = provider.models.filter((model) => model.id !== modelId);
    await commitDraft(
      {
        ...draft,
        providers: draft.providers.map((item) => (item.id === providerId ? { ...item, models } : item)),
        defaultModel:
          draft.defaultModel.providerId === providerId && draft.defaultModel.modelId === modelId
            ? { providerId, modelId: models.find((model) => model.enabled)?.id ?? models[0]?.id ?? "" }
            : draft.defaultModel,
      },
      `${provider.name}: 已删除模型 ${modelId}。`,
    );
  };

  const updateProviderModel = async (
    providerId: string,
    modelId: string,
    patch: Partial<ModelOption>,
    message?: string,
  ) => {
    const provider = draft.providers.find((item) => item.id === providerId);
    const model = provider?.models.find((item) => item.id === modelId);
    if (!provider || !model) return;
    const nextDraft = {
      ...draft,
      providers: draft.providers.map((item) =>
        item.id === providerId
          ? {
              ...item,
              models: item.models.map((current) =>
                current.id === modelId ? normalizeModelMetadataPatch({ ...current, ...patch }) : current,
              ),
            }
          : item,
      ),
    };
    await commitDraft(nextDraft, message);
  };

  const testProviderModel = async (provider: ModelProviderConfig, modelId: string) => {
    const checkId = `${provider.id}:${modelId}`;
    setCheckingModelIds((ids) => new Set(ids).add(checkId));
    setStatus(`正在探测 ${modelId}...`);
    try {
      if (typeof window.marloues.config.testEndpointModel !== "function") {
        setStatus("当前窗口的 preload 还没刷新，新增的模型探测接口尚未注入。请重启应用窗口后再试。", "error");
        return;
      }
      const result = await window.marloues.config.testEndpointModel(provider, modelId);
      setStatus(
        `${provider.name}: ${result.message}${result.latencyMs !== undefined ? ` (${result.latencyMs}ms)` : ""}`,
        result.ok ? "ok" : "error",
      );
    } finally {
      setCheckingModelIds((ids) => {
        const next = new Set(ids);
        next.delete(checkId);
        return next;
      });
    }
  };

  const resetMcpAddDraft = () => {
    setMcpAddDraft(emptyMcpAddDraft());
  };

  const addMcpDraftArg = () => {
    setMcpAddDraft((current) => ({ ...current, args: [...current.args, ""] }));
  };

  const updateMcpDraftArg = (index: number, value: string) => {
    setMcpAddDraft((current) => ({
      ...current,
      args: updateArrayValue(current.args.length ? current.args : [""], index, value),
    }));
  };

  const removeMcpDraftArg = (index: number) => {
    setMcpAddDraft((current) => ({ ...current, args: current.args.filter((_, argIndex) => argIndex !== index) }));
  };

  const createMcpServerFromDraft = () => {
    const config = buildMcpConfigFromDraft(mcpAddMode, mcpAddDraft);
    if (!config) {
      setStatus("请先填写当前模式需要的 MCP 配置。", "error");
      return;
    }
    const configRecord = readMcpConfigRecord(config);
    const commandOrUrl =
      typeof configRecord.command === "string"
        ? configRecord.command
        : typeof configRecord.url === "string"
          ? configRecord.url
          : "";
    const name = mcpAddDraft.name.trim() || commandOrUrl || `server-${draft.mcpServers.length + 1}`;
    if (!name.trim()) {
      setStatus("MCP 服务名称不能为空。", "error");
      return;
    }
    const id = crypto.randomUUID();
    const next = [
      {
        id,
        name,
        enabled: mcpAddDraft.enabled,
        config,
        lastStatus: "untested" as const,
      },
      ...draft.mcpServers,
    ];
    setDraft({ ...draft, mcpServers: next });
    setSelectedMcpId(id);
    setExpandedMcpIds((ids) => new Set(ids).add(id));
    resetMcpAddDraft();
    setStatus(`${name} 已加入草稿，保存后生效。`, "ok");
  };

  const updateMcpServer = (serverId: string, patch: Partial<McpServerConfig>) => {
    setDraft({
      ...draft,
      mcpServers: draft.mcpServers.map((item) => (item.id === serverId ? { ...item, ...patch } : item)),
    });
  };

  const removeMcpServer = (server: McpServerConfig) => {
    const nextServers = draft.mcpServers.filter((item) => item.id !== server.id);
    setDraft({ ...draft, mcpServers: nextServers });
    setSelectedMcpId(nextServers[0]?.id ?? null);
    setExpandedMcpIds((ids) => {
      const next = new Set(ids);
      next.delete(server.id);
      return next;
    });
    setStatus(`${server.name} 已从草稿移除。`, "ok");
  };

  const toggleMcpExpanded = (serverId: string) => {
    setExpandedMcpIds((ids) => {
      const next = new Set(ids);
      if (next.has(serverId)) next.delete(serverId);
      else next.add(serverId);
      return next;
    });
    setSelectedMcpId(serverId);
  };

  const testMcpServer = async (server: McpServerConfig) => {
    setCheckingMcpIds((ids) => new Set(ids).add(server.id));
    setStatus(`正在检查 ${server.name}...`);
    try {
      const tested = await window.marloues.mcp.testServer(server);
      setDraft((current) =>
        current
          ? {
              ...current,
              mcpServers: current.mcpServers.map((item) => (item.id === server.id ? tested : item)),
            }
          : current,
      );
      setStatus(
        tested.lastStatus === "ok"
          ? `${server.name} 检查通过，发现 ${tested.tools?.length ?? 0} 个工具。`
          : `${server.name} 检查失败：${formatMcpError(tested.lastError)}`,
        tested.lastStatus === "ok" ? "ok" : "error",
      );
    } finally {
      setCheckingMcpIds((ids) => {
        const next = new Set(ids);
        next.delete(server.id);
        return next;
      });
    }
  };

  const refreshMcpStatus = async () => {
    setRefreshingMcpStatus(true);
    setStatus("正在刷新 MCP 服务状态...");
    try {
      const refreshed = await window.marloues.mcp.refreshStatus();
      setDraft((current) => current ? { ...current, mcpServers: refreshed } : current);
      const failed = refreshed.filter((server) => server.lastStatus === "error" || server.lastStatus === "disconnected");
      setStatus(
        failed.length
          ? `MCP 状态已刷新，${failed.length} 个服务异常或断开。`
          : `MCP 状态已刷新，${refreshed.filter((server) => server.enabled).length} 个启用服务正常。`,
        failed.length ? "error" : "ok",
      );
    } finally {
      setRefreshingMcpStatus(false);
    }
  };

  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const runtimeSnapshot = buildRuntimeSnapshot(
    liveTurns[activeSessionId ?? ""]?.timeline ?? activeSession?.messages.at(-1)?.timeline ?? [],
  );
  const enabledMcpCount = draft.mcpServers.filter((server) => server.enabled).length;
  const discoveredMcpToolCount = new Set(draft.mcpServers.flatMap((server) => server.tools ?? [])).size;
  const selectedMcpServer =
    draft.mcpServers.find((server) => server.id === selectedMcpId) ?? draft.mcpServers[0] ?? null;
  const _selectedMcpChecking = selectedMcpServer ? checkingMcpIds.has(selectedMcpServer.id) : false;
  const _selectedMcpStatus = selectedMcpServer
    ? selectedMcpServer.lastStatus === "error"
      ? formatMcpError(selectedMcpServer.lastError)
      : selectedMcpServer.lastStatus === "ok"
        ? `${selectedMcpServer.tools?.length ?? 0} tools${selectedMcpServer.lastProbeTool ? " · call verified" : ""}`
        : "未检查"
    : "未选择";

  return (
    <section className={`settings-page settings-section-${section} scrollbar-thin`}>
      <div className="settings-shell">
        <div className="settings-content">
          {hasEnterpriseConfig ? (
            <div className="settings-runtime-panel">
              <div>
                <strong>企业配置已启用</strong>
                <small>
                  {enterpriseControlledSettings.size > 0
                    ? `受控字段：${Array.from(enterpriseControlledSettings).join(", ")}`
                    : "当前只下发了策略限制"}
                </small>
              </div>
              <div className="settings-chip-row">
                {!canEditEndpointProfiles ? <span className="settings-chip">端点受限</span> : null}
                {!canEditMcpServers ? <span className="settings-chip">MCP 受限</span> : null}
                {!canToggleSkills ? <span className="settings-chip">Skills 受限</span> : null}
                {isPermissionTimeoutManaged ? <span className="settings-chip ok">审批超时受控</span> : null}
              </div>
            </div>
          ) : null}

          {section === "general" ? (
            <GeneralSettings
              desktopNotifications={draft.desktopNotificationsEnabled}
              detailLevel={detailLevel}
              onDesktopNotificationsChange={() =>
                void commitDraft(
                  { ...draft, desktopNotificationsEnabled: !draft.desktopNotificationsEnabled },
                  draft.desktopNotificationsEnabled ? "桌面通知已关闭。" : "桌面通知已开启。",
                )
              }
              onDetailLevelChange={setDetailLevel}
              onPreventSleepChange={() => setPreventSleep((value) => !value)}
              preventSleep={preventSleep}
            />
          ) : null}

          {section === "personalization" ? (
            <PersonalizationSettings
              customInstructions={draft.customInstructions ?? ""}
              friendlyTone={draft.friendlyTone !== false}
              onCustomInstructionsChange={(value) => void commitDraft({ ...draft, customInstructions: value })}
              onFriendlyToneChange={() =>
                void commitDraft(
                  { ...draft, friendlyTone: draft.friendlyTone === false },
                  draft.friendlyTone === false ? "友好语气已开启" : "友好语气已关闭",
                )
              }
            />
          ) : null}

          {section === "appearance" ? (
            <AppearanceSettings
              themeMode={themeMode}
              accentColor={accentColor}
              onResetAccentColor={resetAccentColor}
              onSetAccentColor={setAccentColor}
              onSetDark={setDark}
              onSetThemeMode={setThemeMode}
            />
          ) : null}

          {section === "providers" ? (
            <>
              <div className="settings-stat-grid">
                <SettingsStat label="供应商" value={String(draft.providers.length)} />
                <SettingsStat
                  label="启用模型"
                  value={`${draft.providers.reduce((count, provider) => count + provider.models.filter((model) => model.enabled).length, 0)}/${draft.providers.reduce((count, provider) => count + provider.models.length, 0)}`}
                />
                <SettingsStat
                  label="可用模型"
                  value={String(
                    draft.providers.reduce(
                      (count, provider) => count + provider.models.filter((model) => model.enabled).length,
                      0,
                    ),
                  )}
                />
              </div>
              <SettingsCard
                title="模型池"
                description="供应商负责连接配置，模型负责进入默认模型池并参与下一次 SDK 会话。"
                icon={<ServerCog size={16} />}
                action={
                  <button
                    disabled={!canEditEndpointProfiles}
                    onClick={addEndpointProfile}
                    title={canEditEndpointProfiles ? "新增 Profile" : "企业策略禁止新增或修改本地端点 Profile"}
                  >
                    <Plus size={14} />
                    添加供应商
                  </button>
                }
              >
                <div className="provider-list">
                  {draft.providers.length === 0 ? (
                    <EmptySettingsState
                      title="还没有配置任何供应商"
                      body="先添加一个供应商，再选择默认模型进入下一次 SDK 会话。"
                    />
                  ) : null}
                  {draft.providers.map((provider) => (
                    <div
                      className="provider-row"
                      key={provider.id}
                      ref={newProviderId === provider.id ? providerEditRef : null}
                    >
                      <div className="provider-row-head">
                        <button
                          className="provider-expand-button"
                          onClick={() => toggleProviderExpanded(provider.id)}
                          title={expandedProviderIds.has(provider.id) ? "收起供应商" : "展开供应商"}
                        >
                          {expandedProviderIds.has(provider.id) ? (
                            <ChevronDown size={16} />
                          ) : (
                            <ChevronRight size={16} />
                          )}
                        </button>
                        <div className="provider-row-title">
                          <div>
                            <strong>{provider.name || "未命名供应商"}</strong>
                          </div>
                          <small>
                            {provider.models.length === 0
                              ? "暂无模型"
                              : `${provider.models.length} 个模型（已启用 ${provider.models.filter((model) => model.enabled).length} 个）`}
                          </small>
                        </div>
                        <div className="settings-row-actions provider-actions">
                          <label
                            className="settings-inline-check provider-enable-check"
                            title={provider.enabled ? "供应商已启用" : "供应商已停用"}
                          >
                            <input
                              type="checkbox"
                              checked={provider.enabled}
                              disabled={provider.locked || !canEditEndpointProfiles}
                              onChange={(event) => {
                                const nextDraft = {
                                  ...draft,
                                  providers: draft.providers.map((item) =>
                                    item.id === provider.id ? { ...item, enabled: event.target.checked } : item,
                                  ),
                                };
                                void commitDraft(
                                  nextDraft,
                                  `${provider.name}: ${event.target.checked ? "已启用" : "已停用"}。`,
                                );
                              }}
                            />
                            启用
                          </label>
                          <button
                            className="icon-button"
                            disabled={checkingEndpointIds.has(provider.id)}
                            onClick={async () => {
                              setCheckingEndpointIds((ids) => new Set(ids).add(provider.id));
                              setStatus(`正在测试 ${provider.name}...`);
                              try {
                                const result = await window.marloues.config.testEndpointProfile(provider);
                                setStatus(
                                  `${provider.name}: ${result.message}${result.latencyMs !== undefined ? ` (${result.latencyMs}ms)` : ""}`,
                                  result.ok ? "ok" : "error",
                                );
                              } finally {
                                setCheckingEndpointIds((ids) => {
                                  const next = new Set(ids);
                                  next.delete(provider.id);
                                  return next;
                                });
                              }
                            }}
                            title={checkingEndpointIds.has(provider.id) ? "测试中" : "测试连接"}
                          >
                            {checkingEndpointIds.has(provider.id) ? <RefreshCcw size={14} /> : <PlugZap size={14} />}
                          </button>
                          <button
                            className="icon-button"
                            disabled={provider.locked || !canEditEndpointProfiles}
                            onClick={() => void removeEndpointProfile(provider.id)}
                            title={
                              provider.locked
                                ? "企业预置 Profile 不可删除"
                                : canEditEndpointProfiles
                                  ? "删除 Profile"
                                  : "企业策略禁止删除本地端点 Profile"
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      {expandedProviderIds.has(provider.id) ? (
                        <div className={`provider-row-body ${newProviderId === provider.id ? "draft" : ""}`}>
                          <div className="provider-fields-grid">
                            <label>
                              Profile 名称
                              <input
                                value={provider.name}
                                disabled={provider.locked || !canEditEndpointProfiles}
                                onChange={(event) => {
                                  const nextDraft = {
                                    ...draft,
                                    providers: draft.providers.map((item) =>
                                      item.id === provider.id ? { ...item, name: event.target.value } : item,
                                    ),
                                  };
                                  if (newProviderId === provider.id) {
                                    setDraft(nextDraft);
                                    return;
                                  }
                                  void commitDraft(nextDraft);
                                }}
                                placeholder="Profile 名称"
                              />
                            </label>
                            <label>
                              Base URL
                              <input
                                value={provider.baseUrl ?? ""}
                                disabled={provider.locked || !canEditEndpointProfiles}
                                onChange={(event) => {
                                  const nextDraft = {
                                    ...draft,
                                    providers: draft.providers.map((item) =>
                                      item.id === provider.id ? { ...item, baseUrl: event.target.value } : item,
                                    ),
                                  };
                                  if (newProviderId === provider.id) {
                                    setDraft(nextDraft);
                                    return;
                                  }
                                  void commitDraft(nextDraft);
                                }}
                                placeholder="Base URL"
                              />
                            </label>
                            <label>
                              API Key
                              <div className="api-key-input-wrap">
                                <input
                                  type={visibleApiKeyProviderIds.has(provider.id) ? "text" : "password"}
                                  value={provider.apiKey ?? ""}
                                  disabled={provider.locked || !canEditEndpointProfiles}
                                  onChange={(event) => {
                                    const nextDraft = {
                                      ...draft,
                                      providers: draft.providers.map((item) =>
                                        item.id === provider.id ? { ...item, apiKey: event.target.value } : item,
                                      ),
                                    };
                                    if (newProviderId === provider.id) {
                                      setDraft(nextDraft);
                                      return;
                                    }
                                    void commitDraft(nextDraft);
                                  }}
                                  placeholder="sk-..."
                                />
                                <button
                                  className="icon-button api-key-visibility-button"
                                  disabled={provider.locked || !canEditEndpointProfiles}
                                  onClick={() => toggleApiKeyVisible(provider.id)}
                                  title={visibleApiKeyProviderIds.has(provider.id) ? "隐藏 API Key" : "查看 API Key"}
                                  type="button"
                                >
                                  {visibleApiKeyProviderIds.has(provider.id) ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                              </div>
                            </label>
                          </div>
                          <div className="provider-model-section">
                            <div className="provider-model-section-head">
                              <span>模型</span>
                              <div className="settings-row-actions">
                                <button
                                  disabled={
                                    fetchingModelIds.has(provider.id) || provider.locked || !canEditEndpointProfiles
                                  }
                                  onClick={() => void fetchProviderModels(provider.id)}
                                >
                                  {fetchingModelIds.has(provider.id) ? <RefreshCcw size={14} /> : <Bot size={14} />}
                                  {fetchingModelIds.has(provider.id) ? "获取中" : "获取模型"}
                                </button>
                                <button
                                  disabled={provider.locked || !canEditEndpointProfiles}
                                  onClick={() => setManualModelDraft({ providerId: provider.id, modelId: "" })}
                                >
                                  <Plus size={14} />
                                  手动添加
                                </button>
                              </div>
                            </div>
                            {manualModelDraft?.providerId === provider.id ? (
                              <div className="provider-model-manual" ref={manualModelRef}>
                                <input
                                  autoFocus
                                  value={manualModelDraft.modelId}
                                  onChange={(event) =>
                                    setManualModelDraft({ providerId: provider.id, modelId: event.target.value })
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") void applyManualModel();
                                    if (event.key === "Escape") setManualModelDraft(null);
                                  }}
                                  placeholder="输入模型 ID，例如 MiniMax-M2.7-highspeed"
                                />
                                <div className="settings-row-actions provider-model-import-actions">
                                  <button onClick={() => setManualModelDraft(null)}>取消</button>
                                  <button className="primary" onClick={() => void applyManualModel()}>
                                    确定
                                  </button>
                                </div>
                              </div>
                            ) : null}
                            {modelImportDraft?.providerId === provider.id ? (
                              <div className="provider-model-import">
                                <div className="provider-model-import-head">
                                  <div>
                                    <strong>发现 {modelImportDraft.models.length} 个新模型</strong>
                                    <small>勾选只是选择，点确定后才添加并启用。</small>
                                  </div>
                                  <div className="settings-row-actions provider-model-import-actions">
                                    <button onClick={() => setModelImportDraft(null)}>取消</button>
                                    <button
                                      className="primary"
                                      disabled={modelImportDraft.selectedIds.size === 0}
                                      onClick={() => void applyModelImport()}
                                    >
                                      确定
                                    </button>
                                  </div>
                                </div>
                                <div className="provider-model-import-list">
                                  {modelImportDraft.models.map((model) => (
                                    <label className="provider-model-import-item" key={model.id}>
                                      <input
                                        type="checkbox"
                                        checked={modelImportDraft.selectedIds.has(model.id)}
                                        onChange={() => toggleModelImportSelection(model.id)}
                                      />
                                      <span>
                                        <strong>{model.label || model.id}</strong>
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            {provider.models.length > 0 ? (
                              <div className="provider-model-list">
                                {provider.models.map((model) => {
                                  const modelTitle = model.label || model.id || "未命名模型";
                                  const modelCheckId = `${provider.id}:${model.id}`;
                                  return (
                                    <div
                                      className={`provider-model-card ${model.enabled ? "" : "disabled"}`}
                                      key={model.id}
                                    >
                                      <div className="provider-model-main">
                                        <div className="provider-model-title-line">
                                          <strong title={model.id || modelTitle}>{modelTitle}</strong>
                                          <span
                                            className={
                                              draft.defaultModel.providerId === provider.id &&
                                              draft.defaultModel.modelId === model.id
                                                ? "default"
                                                : model.enabled
                                                  ? "enabled"
                                                  : "disabled"
                                            }
                                          >
                                            {draft.defaultModel.providerId === provider.id &&
                                            draft.defaultModel.modelId === model.id
                                              ? "默认"
                                              : model.enabled
                                                ? "启用"
                                                : "停用"}
                                          </span>
                                        </div>
                                        <div className="provider-model-config-grid">
                                          <label>
                                            上下文窗口
                                            <input
                                              type="number"
                                              min={1}
                                              step={1000}
                                              disabled={provider.locked || !canEditEndpointProfiles}
                                              value={model.contextWindowTokens ?? ""}
                                              onChange={(event) =>
                                                void updateProviderModel(provider.id, model.id, {
                                                  contextWindowTokens: event.target.value
                                                    ? Number(event.target.value)
                                                    : undefined,
                                                })
                                              }
                                              placeholder="例如 1000000"
                                            />
                                          </label>
                                          <label>
                                            最大输出标记数
                                            <input
                                              type="number"
                                              min={1}
                                              step={1000}
                                              disabled={provider.locked || !canEditEndpointProfiles}
                                              value={model.maxOutputTokens ?? ""}
                                              onChange={(event) =>
                                                void updateProviderModel(provider.id, model.id, {
                                                  maxOutputTokens: event.target.value
                                                    ? Number(event.target.value)
                                                    : undefined,
                                                })
                                              }
                                              placeholder="例如 384000"
                                            />
                                          </label>
                                          <label className="settings-inline-check">
                                            <input
                                              type="checkbox"
                                              checked={Boolean(model.supportsVision)}
                                              disabled={provider.locked || !canEditEndpointProfiles}
                                              onChange={(event) =>
                                                void updateProviderModel(provider.id, model.id, {
                                                  supportsVision: event.target.checked,
                                                })
                                              }
                                            />
                                            视觉
                                          </label>
                                          <label className="settings-inline-check">
                                            <input
                                              type="checkbox"
                                              checked={Boolean(model.supportsThinking)}
                                              disabled={provider.locked || !canEditEndpointProfiles}
                                              onChange={(event) =>
                                                void updateProviderModel(provider.id, model.id, {
                                                  supportsThinking: event.target.checked,
                                                })
                                              }
                                            />
                                            思考中
                                          </label>
                                        </div>
                                      </div>
                                      <div
                                        className={`settings-row-actions provider-model-actions ${checkingModelIds.has(modelCheckId) ? "visible" : ""}`}
                                      >
                                        <button
                                          className="icon-button"
                                          disabled={
                                            !provider.enabled ||
                                            !model.enabled ||
                                            (draft.defaultModel.providerId === provider.id &&
                                              draft.defaultModel.modelId === model.id)
                                          }
                                          onClick={() => {
                                            const nextDraft = {
                                              ...draft,
                                              defaultModel: {
                                                providerId: provider.id,
                                                modelId: model.id,
                                              },
                                            };
                                            void commitDraft(nextDraft, `${modelTitle} 已设为默认模型。`);
                                          }}
                                          title={
                                            draft.defaultModel.providerId === provider.id &&
                                            draft.defaultModel.modelId === model.id
                                              ? "已是默认模型"
                                              : "设为默认模型"
                                          }
                                        >
                                          <Check size={13} />
                                        </button>
                                        <button
                                          className="icon-button"
                                          disabled={provider.locked || !canEditEndpointProfiles}
                                          onClick={() => {
                                            const nextDraft = {
                                              ...draft,
                                              providers: draft.providers.map((item) =>
                                                item.id === provider.id
                                                  ? {
                                                      ...item,
                                                      models: item.models.map((current) =>
                                                        current.id === model.id
                                                          ? { ...current, enabled: !current.enabled }
                                                          : current,
                                                      ),
                                                    }
                                                  : item,
                                              ),
                                            };
                                            void commitDraft(
                                              nextDraft,
                                              `${modelTitle}: ${model.enabled ? "已禁用" : "已启用"}。`,
                                            );
                                          }}
                                          title={
                                            model.enabled &&
                                            draft.defaultModel.providerId === provider.id &&
                                            draft.defaultModel.modelId === model.id
                                              ? "默认模型不能直接禁用，请先切换默认模型"
                                              : model.enabled
                                                ? "禁用模型"
                                                : "启用模型"
                                          }
                                        >
                                          {model.enabled ? <Power size={13} /> : <Check size={13} />}
                                        </button>
                                        <button
                                          className="icon-button"
                                          disabled={checkingModelIds.has(modelCheckId)}
                                          onClick={() => void testProviderModel(provider, model.id)}
                                          title={checkingModelIds.has(modelCheckId) ? "探测中" : "发送探测消息"}
                                        >
                                          {checkingModelIds.has(modelCheckId) ? (
                                            <RefreshCcw size={13} />
                                          ) : (
                                            <PlugZap size={13} />
                                          )}
                                        </button>
                                        <button
                                          className="icon-button"
                                          disabled={provider.locked || !canEditEndpointProfiles}
                                          onClick={() => void removeProviderModel(provider.id, model.id)}
                                          title="删除模型"
                                        >
                                          <Trash2 size={13} />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                          {newProviderId === provider.id ? (
                            <div className="provider-draft-panel">
                              <div className="settings-row-actions provider-draft-actions">
                                <button onClick={() => discardNewProviderDraft(provider.id)}>取消</button>
                                <button
                                  className="primary"
                                  disabled={provider.models.length === 0}
                                  onClick={() => void confirmNewProviderDraft(provider.id)}
                                  title={provider.models.length === 0 ? "先添加至少一个模型" : "确认添加供应商"}
                                >
                                  确定
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </SettingsCard>
            </>
          ) : null}

          {section === "mcp" ? (
            <div className="mcp-provider-page">
              <div className="mcp-provider-summary">
                <span>
                  <small>服务</small>
                  <strong>{draft.mcpServers.length}</strong>
                </span>
                <span>
                  <small>启用服务</small>
                  <strong>
                    {enabledMcpCount}/{draft.mcpServers.length || 0}
                  </strong>
                </span>
                <span>
                  <small>可用工具</small>
                  <strong>{discoveredMcpToolCount}</strong>
                </span>
                <button
                  className="settings-summary-action"
                  disabled={refreshingMcpStatus || draft.mcpServers.length === 0}
                  onClick={() => void refreshMcpStatus()}
                  type="button"
                >
                  <RefreshCcw size={14} />
                  {refreshingMcpStatus ? "刷新中" : "刷新状态"}
                </button>
              </div>

              <div className={`mcp-provider-create ${mcpAddMode}`}>
                <div className="mcp-create-head">
                  <div>
                    <strong>添加 MCP 服务</strong>
                    <small>{formatMcpAddModeHint(mcpAddMode)}</small>
                  </div>
                  <div className="mcp-add-mode">
                    {[
                      ["stdio", "命令", "本地进程"],
                      ["http", "HTTP", "远程服务"],
                      ["sse", "SSE", "事件流"],
                      ["json", "JSON", "高级配置"],
                    ].map(([mode, label, note]) => (
                      <button
                        className={mcpAddMode === mode ? "active" : ""}
                        key={mode}
                        onClick={() => setMcpAddMode(mode as McpAddMode)}
                        type="button"
                      >
                        <strong>{label}</strong>
                        <small>{note}</small>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mcp-create-main">
                  <label className="mcp-create-name">
                    服务名称
                    <input
                      value={mcpAddDraft.name}
                      disabled={!canEditMcpServers}
                      onChange={(event) => setMcpAddDraft({ ...mcpAddDraft, name: event.target.value })}
                      placeholder="playwright"
                    />
                  </label>
                  {mcpAddMode === "stdio" ? (
                    <>
                      <label className="mcp-create-command">
                        命令
                        <input
                          value={mcpAddDraft.command}
                          disabled={!canEditMcpServers}
                          onChange={(event) => setMcpAddDraft({ ...mcpAddDraft, command: event.target.value })}
                          placeholder="npx / node / uvx / python"
                        />
                      </label>
                      <div className="mcp-create-args mcp-args-builder">
                        <span>参数</span>
                        {(mcpAddDraft.args.length ? mcpAddDraft.args : [""]).map((arg, index) => (
                          <div className="mcp-arg-entry" key={index}>
                            <input
                              value={arg}
                              disabled={!canEditMcpServers}
                              onChange={(event) => updateMcpDraftArg(index, event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  addMcpDraftArg();
                                }
                              }}
                              placeholder="输入一个参数，如 -y"
                            />
                            {index === 0 ? (
                              <button disabled={!canEditMcpServers} onClick={addMcpDraftArg} type="button">
                                添加
                              </button>
                            ) : (
                              <button
                                disabled={!canEditMcpServers}
                                onClick={() => removeMcpDraftArg(index)}
                                title="删除参数"
                                type="button"
                              >
                                <X size={12} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : null}
                  {mcpAddMode === "http" || mcpAddMode === "sse" ? (
                    <label className="mcp-create-url">
                      服务 URL
                      <input
                        value={mcpAddDraft.url}
                        disabled={!canEditMcpServers}
                        onChange={(event) => setMcpAddDraft({ ...mcpAddDraft, url: event.target.value })}
                        placeholder={mcpAddMode === "http" ? "https://example.com/mcp" : "https://example.com/sse"}
                      />
                    </label>
                  ) : null}
                  {mcpAddMode === "json" ? (
                    <label className="mcp-create-json">
                      配置 JSON
                      <textarea
                        value={mcpAddDraft.json}
                        disabled={!canEditMcpServers}
                        onChange={(event) => setMcpAddDraft({ ...mcpAddDraft, json: event.target.value })}
                        placeholder={'{ "type": "http", "url": "https://example.com/mcp" }'}
                      />
                    </label>
                  ) : null}
                  <div className="settings-row-actions mcp-provider-create-actions">
                    <label className="settings-inline-check provider-enable-check">
                      <input
                        type="checkbox"
                        checked={mcpAddDraft.enabled}
                        disabled={!canEditMcpServers}
                        onChange={(event) => setMcpAddDraft({ ...mcpAddDraft, enabled: event.target.checked })}
                      />
                      启用
                    </label>
                    <button disabled={!canEditMcpServers} onClick={resetMcpAddDraft} title="清空添加表单" type="button">
                      清空
                    </button>
                    <button
                      className="primary"
                      disabled={!canEditMcpServers}
                      onClick={createMcpServerFromDraft}
                      type="button"
                    >
                      <Plus size={14} />
                      添加
                    </button>
                  </div>
                </div>
              </div>

              <div className="provider-list mcp-provider-list">
                {draft.mcpServers.length === 0 ? (
                  <div className="settings-empty-state">
                    <strong>还没有 MCP 服务</strong>
                    <p>使用上方添加栏创建第一个本地工具服务。</p>
                  </div>
                ) : null}
                {draft.mcpServers.map((server) => {
                  const isExpanded = expandedMcpIds.has(server.id);
                  const isChecking = checkingMcpIds.has(server.id);
                  const serverConfig = readMcpConfigRecord(server.config);
                  const serverType = readMcpType(server.config);
                  const serverSummary = formatMcpServerSummary(server, serverType);
                  const serverArgs = readMcpArgs(server.config);
                  const editArgRows = mcpEditArgDrafts[server.id] ?? (serverArgs.length ? serverArgs : [""]);
                  return (
                    <div
                      className={`provider-row mcp-provider-row ${server.enabled ? "" : "disabled"}`}
                      key={server.id}
                    >
                      <div className="provider-row-head">
                        <button
                          className="provider-expand-button"
                          onClick={() => toggleMcpExpanded(server.id)}
                          title={isExpanded ? "收起服务" : "展开服务"}
                          type="button"
                        >
                          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                        <span className={`mcp-server-dot ${server.lastStatus ?? "untested"}`} />
                        <div className="provider-row-title">
                          <div>
                            <strong>{server.name || "未命名服务"}</strong>
                            <span className={`settings-status ${server.lastStatus ?? "untested"}`}>
                              {formatMcpStatus(server)}
                            </span>
                          </div>
                          <small>{serverSummary}</small>
                        </div>
                        <div className="settings-row-actions provider-actions">
                          <label
                            className="settings-inline-check provider-enable-check"
                            title={server.enabled ? "服务已启用" : "服务已停用"}
                          >
                            <input
                              type="checkbox"
                              checked={server.enabled}
                              disabled={server.locked || !canEditMcpServers}
                              onChange={(event) => updateMcpServer(server.id, { enabled: event.target.checked })}
                            />
                            启用
                          </label>
                          <button
                            className="icon-button"
                            disabled={isChecking}
                            onClick={() => void testMcpServer(server)}
                            title={isChecking ? "检查中" : "检查服务"}
                            type="button"
                          >
                            {isChecking ? <RefreshCcw size={14} /> : <PlugZap size={14} />}
                          </button>
                          <button
                            className="icon-button"
                            disabled={server.locked || !canEditMcpServers}
                            onClick={() => removeMcpServer(server)}
                            title="删除服务"
                            type="button"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="provider-row-body mcp-provider-body">
                          <>
                            <div className="provider-fields-grid mcp-provider-fields">
                              <label>
                                服务名称
                                <input
                                  value={server.name}
                                  disabled={server.locked || !canEditMcpServers}
                                  onChange={(event) => updateMcpServer(server.id, { name: event.target.value })}
                                />
                              </label>
                              {serverType === "stdio" ? (
                                <>
                                  <label>
                                    命令
                                    <input
                                      value={readMcpCommand(server.config)}
                                      disabled={server.locked || !canEditMcpServers}
                                      onChange={(event) =>
                                        updateMcpServer(server.id, {
                                          config: { ...serverConfig, command: event.target.value },
                                        })
                                      }
                                    />
                                  </label>
                                  <div className="mcp-args-builder">
                                    <span>参数</span>
                                    {editArgRows.map((arg, index) => (
                                      <div className="mcp-arg-entry" key={index}>
                                        <input
                                          value={arg}
                                          disabled={server.locked || !canEditMcpServers}
                                          onChange={(event) => {
                                            const nextRows = updateArrayValue(editArgRows, index, event.target.value);
                                            setMcpEditArgDrafts((current) => ({ ...current, [server.id]: nextRows }));
                                            updateMcpServer(server.id, {
                                              config: { ...serverConfig, args: compactMcpArgs(nextRows) },
                                            });
                                          }}
                                          onKeyDown={(event) => {
                                            if (event.key === "Enter") {
                                              event.preventDefault();
                                              setMcpEditArgDrafts((current) => ({
                                                ...current,
                                                [server.id]: [...editArgRows, ""],
                                              }));
                                            }
                                          }}
                                          placeholder="输入一个参数，如 -y"
                                        />
                                        {index === 0 ? (
                                          <button
                                            disabled={server.locked || !canEditMcpServers}
                                            onClick={() =>
                                              setMcpEditArgDrafts((current) => ({
                                                ...current,
                                                [server.id]: [...editArgRows, ""],
                                              }))
                                            }
                                            type="button"
                                          >
                                            添加
                                          </button>
                                        ) : (
                                          <button
                                            disabled={server.locked || !canEditMcpServers}
                                            onClick={() => {
                                              const nextRows = editArgRows.filter((_, argIndex) => argIndex !== index);
                                              setMcpEditArgDrafts((current) => ({
                                                ...current,
                                                [server.id]: nextRows.length ? nextRows : [""],
                                              }));
                                              updateMcpServer(server.id, {
                                                config: { ...serverConfig, args: compactMcpArgs(nextRows) },
                                              });
                                            }}
                                            title="删除参数"
                                            type="button"
                                          >
                                            <X size={12} />
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </>
                              ) : null}
                              {serverType === "http" || serverType === "sse" ? (
                                <label>
                                  服务 URL
                                  <input
                                    value={readMcpUrl(server.config)}
                                    disabled={server.locked || !canEditMcpServers}
                                    onChange={(event) =>
                                      updateMcpServer(server.id, {
                                        config: { ...serverConfig, url: event.target.value },
                                      })
                                    }
                                  />
                                </label>
                              ) : null}
                            </div>

                            <details className="mcp-json-editor">
                              <summary>配置 JSON</summary>
                              <textarea
                                value={JSON.stringify(server.config, null, 2)}
                                disabled={server.locked || !canEditMcpServers}
                                onChange={(event) =>
                                  updateMcpServer(server.id, {
                                    config: parseJsonLoose(event.target.value, server.config),
                                  })
                                }
                              />
                            </details>

                            <div className="provider-model-section mcp-tool-section">
                              <div className="provider-model-section-head">
                                <span>工具</span>
                                <div className="settings-row-actions">
                                  <button
                                    disabled={isChecking}
                                    onClick={() => void testMcpServer(server)}
                                    type="button"
                                  >
                                    {isChecking ? <RefreshCcw size={14} /> : <PlugZap size={14} />}
                                    {isChecking ? "检查中" : "检查工具"}
                                  </button>
                                </div>
                              </div>
                              {server.tools?.length ? (
                                <div className="settings-chip-row mcp-tool-list">
                                  {server.tools.map((tool) => (
                                    <span className="settings-chip ok" key={tool}>
                                      <Wrench size={12} />
                                      {tool}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <div className="mcp-provider-empty-tools">
                                  <Wrench size={16} />
                                  <strong>暂无工具</strong>
                                  <small>点击检查后显示服务返回的工具列表。</small>
                                </div>
                              )}
                            </div>
                          </>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {section === "skills" ? (
            <SkillsSettings
              canToggleSkills={canToggleSkills}
              enabledSkillCount={enabledSkillCount}
              marketplaceCursor={marketplaceCursor}
              marketplaceDetail={marketplaceDetail}
              marketplaceError={marketplaceError}
              marketplaceHasMore={marketplaceHasMore}
              marketplaceLoading={marketplaceLoading}
              marketplaceQuery={marketplaceQuery}
              marketplaceSkills={marketplaceSkills}
              marketplaceTotal={marketplaceTotal}
              marketplaceView={marketplaceView}
              onMarketplaceCursorChange={setMarketplaceCursor}
              onMarketplaceDetailChange={setMarketplaceDetail}
              onMarketplaceErrorChange={setMarketplaceError}
              onMarketplaceHasMoreChange={setMarketplaceHasMore}
              onMarketplaceLoadingChange={setMarketplaceLoading}
              onMarketplaceQueryChange={setMarketplaceQuery}
              onMarketplaceSkillsChange={setMarketplaceSkills}
              onMarketplaceTotalChange={setMarketplaceTotal}
              onMarketplaceViewChange={setMarketplaceView}
              onSkillDetailChange={setSkillDetail}
              onSkillsChange={setSkills}
              runtimeSkills={runtimeSnapshot.skills}
              skillDetail={skillDetail}
              skills={skills}
              skillTab={skillTab}
              onSkillTabChange={setSkillTab}
            />
          ) : null}

          {section === "audit" ? (
            <AuditSettings auditEvents={auditEvents} onAuditEventsChange={setAuditEvents} onStatus={setStatus} />
          ) : null}

          {section === "runtime" ? (
            <RuntimeSettings
              draft={draft}
              isPermissionTimeoutManaged={isPermissionTimeoutManaged}
              onCommitDraft={(nextDraft) => void commitDraft(nextDraft)}
              onSwitchRuntime={async (runtimeId) => {
                try {
                  await switchRuntime(runtimeId);
                  setStatus("Runtime 已切换", "ok");
                } catch (error) {
                  setStatus(error instanceof Error ? error.message : "Runtime 切换失败", "error");
                }
              }}
              runtimeState={runtimeState}
            />
          ) : null}
          {section === "security" ? (
            <SecuritySettings
              enterprisePolicy={draft.enterprisePolicy ?? {}}
              onPolicyChange={(policy) => {
                void commitDraft({ ...draft, enterprisePolicy: policy });
              }}
              onExportAuditLog={() => {
                void window.marloues.audit.list(500).then((events) => {
                  const blob = new Blob([JSON.stringify(events, null, 2)], {
                    type: "application/json;charset=utf-8",
                  });
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = `marloues-audit-${new Date().toISOString().slice(0, 10)}.json`;
                  anchor.click();
                  URL.revokeObjectURL(url);
                });
              }}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

