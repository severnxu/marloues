import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  LayoutGrid,
  List as ListIcon,
  PlugZap,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { notify } from "@/lib/notifications";
import { useSettingsStore } from "@/stores/settings-store";
import type { McpMarketplaceItem, McpServerConfig } from "@shared/types";
import {
  buildMcpConfigFromDraft,
  emptyMcpAddDraft,
  formatMcpError,
  readMcpArgs,
  readMcpCommand,
  readMcpType,
  readMcpUrl,
  type McpAddDraft,
  type McpAddMode,
} from "@/components/settings";
import { McpAddDialog } from "./McpAddDialog";

type DialogState =
  { kind: "create" } | { kind: "edit"; serverId: string } | null;

type McpView = "discover" | "installed";
type McpLayout = "grid" | "list";

const SEARCH_DEBOUNCE_MS = 300;

function transportLabel(server: McpServerConfig) {
  const type = readMcpType(server.config);
  if (type === "stdio") return "本地进程";
  if (type === "http") return "HTTP";
  if (type === "sse") return "SSE";
  return "JSON";
}

function statusOf(server: McpServerConfig): { label: string; tone: string } {
  if (!server.enabled || server.lastStatus === "disconnected") {
    return { label: "已断开", tone: "off" };
  }
  if (server.lastStatus === "error") return { label: "异常", tone: "error" };
  if (server.lastStatus === "running") {
    return { label: "连接中", tone: "running" };
  }
  if (server.lastStatus === "ok") return { label: "正常", tone: "ok" };
  return { label: "未测试", tone: "off" };
}

function isConfiguredMarketplaceUrl(value: string | undefined): boolean {
  const normalized = value?.trim() ?? "";
  return Boolean(
    normalized &&
    normalized !== "https://" &&
    normalized !== "http://" &&
    normalized !== "https:" &&
    normalized !== "http:",
  );
}

function activateCard(event: React.KeyboardEvent, activate: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activate();
  }
}

function McpMarketplaceCard({
  item,
  layout,
  installingId,
  canInstall,
  onInstall,
}: {
  item: McpMarketplaceItem;
  layout: McpLayout;
  installingId: string | null;
  canInstall: boolean;
  onInstall: (item: McpMarketplaceItem) => void;
}) {
  return (
    <article
      className={`plugin-card${layout === "list" ? " is-list" : ""}`}
      aria-label={`${item.name} ${item.installed ? "已安装" : "未安装"}`}
    >
      <header className="plugin-card-head">
        <span className="plugin-card-identity">
          <strong>{item.name}</strong>
          <small>
            {[
              item.author || "MCP 市场",
              item.version ? `v${item.version}` : undefined,
            ]
              .filter(Boolean)
              .join(" · ")}
          </small>
        </span>
        <span
          className={`plugin-install-status${item.installed ? " is-installed" : ""}`}
        >
          {item.installed ? "已安装" : item.verified ? "已验证" : "未安装"}
        </span>
      </header>
      <p>{item.description || "暂无简介，安装后可在已安装列表中配置。"}</p>
      <footer>
        <span />
        <button
          className="plugin-install-button"
          type="button"
          disabled={!canInstall || item.installed || installingId === item.id}
          onClick={() => onInstall(item)}
        >
          {installingId === item.id ? "安装中..." : "安装"}
        </button>
      </footer>
    </article>
  );
}

function McpInstalledCard({
  server,
  layout,
  canEdit,
  saving,
  checkingId,
  onEdit,
  onToggle,
  onTest,
  onDelete,
}: {
  server: McpServerConfig;
  layout: McpLayout;
  canEdit: boolean;
  saving: boolean;
  checkingId: string | null;
  onEdit: (server: McpServerConfig) => void;
  onToggle: (server: McpServerConfig) => void;
  onTest: (server: McpServerConfig) => void;
  onDelete: (server: McpServerConfig) => void;
}) {
  const status = statusOf(server);
  return (
    <article
      className={`plugin-card${layout === "list" ? " is-list" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`编辑 ${server.name}`}
      onClick={() => onEdit(server)}
      onKeyDown={(event) => activateCard(event, () => onEdit(server))}
    >
      <header className="plugin-card-head">
        <span className="plugin-card-identity">
          <strong>{server.name || "未命名服务"}</strong>
          <small>
            {transportLabel(server)} · {server.tools?.length ?? 0} 个工具
          </small>
        </span>
        <span
          className={`plugin-install-status${server.lastStatus === "ok" ? " is-installed" : ""}`}
        >
          {status.label}
        </span>
      </header>
      <p>
        {server.lastStatus === "error" && server.lastError
          ? server.lastError
          : "点击卡片编辑连接配置、启用状态或执行连通性检测。"}
      </p>
      <footer
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <button
          className="plugin-card-icon-action"
          type="button"
          title="连通性检测"
          aria-label={`检测 ${server.name} 的连通性`}
          disabled={checkingId === server.id}
          onClick={() => onTest(server)}
        >
          {checkingId === server.id ? (
            <RefreshCcw className="is-spinning" />
          ) : (
            <PlugZap />
          )}
        </button>
        <div className="plugin-card-actions">
          <button
            className="scheduled-switch"
            type="button"
            role="switch"
            aria-checked={server.enabled}
            aria-label={`${server.enabled ? "停用" : "启用"} ${server.name}`}
            disabled={server.locked || !canEdit || saving}
            onClick={() => onToggle(server)}
          >
            <span />
          </button>
          <button
            className="plugin-card-icon-action is-danger"
            type="button"
            title="删除服务"
            aria-label={`删除 ${server.name}`}
            disabled={server.locked || !canEdit || saving}
            onClick={() => onDelete(server)}
          >
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      </footer>
    </article>
  );
}

function draftFromServer(server: McpServerConfig): {
  mode: McpAddMode;
  draft: McpAddDraft;
} {
  const mode = readMcpType(server.config);
  return {
    mode,
    draft: {
      name: server.name,
      command: readMcpCommand(server.config),
      args: readMcpArgs(server.config),
      url: readMcpUrl(server.config),
      json: JSON.stringify(server.config ?? {}, null, 2),
      enabled: server.enabled,
    },
  };
}

export function McpServersPanel() {
  const settings = useSettingsStore((state) => state.settings);
  const load = useSettingsStore((state) => state.load);
  const save = useSettingsStore((state) => state.save);
  const mcpMarketplaceEndpoint = settings?.mcpMarketplaceEndpoint;
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [mode, setMode] = useState<McpAddMode>("stdio");
  const [draft, setDraft] = useState<McpAddDraft>(() => emptyMcpAddDraft());
  const [dialog, setDialog] = useState<DialogState>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<McpServerConfig | null>(null);
  const [marketplaceItems, setMarketplaceItems] = useState<
    McpMarketplaceItem[]
  >([]);
  const [marketplaceQuery, setMarketplaceQuery] = useState("");
  const [debouncedMarketplaceQuery, setDebouncedMarketplaceQuery] =
    useState("");
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
  const [marketplaceTotal, setMarketplaceTotal] = useState<
    number | undefined
  >();
  const [marketplaceHasMore, setMarketplaceHasMore] = useState(false);
  const [marketplaceNextCursor, setMarketplaceNextCursor] = useState<
    string | undefined
  >();
  const [installingMarketplaceId, setInstallingMarketplaceId] = useState<
    string | null
  >(null);
  const [view, setView] = useState<McpView>("discover");
  const [layout, setLayout] = useState<McpLayout>("grid");
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMarketplaceQueryChange = useCallback((value: string) => {
    setMarketplaceQuery(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedMarketplaceQuery(value);
    }, SEARCH_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!settings) void load();
  }, [load, settings]);

  useEffect(() => {
    if (settings) setServers(settings.mcpServers ?? []);
  }, [settings]);

  const loadMarketplace = useCallback(
    async (query: string, cursor?: string) => {
      const endpointConfigured =
        Boolean(mcpMarketplaceEndpoint?.enabled) &&
        isConfiguredMarketplaceUrl(mcpMarketplaceEndpoint?.baseUrl);
      if (!endpointConfigured) {
        setMarketplaceItems([]);
        setMarketplaceError(null);
        setMarketplaceHasMore(false);
        setMarketplaceNextCursor(undefined);
        setMarketplaceTotal(undefined);
        return;
      }
      setMarketplaceLoading(true);
      setMarketplaceError(null);
      try {
        const response = await window.marloues.mcp.marketplaceList({
          query,
          page: cursor ? Number(cursor) || 1 : 1,
          cursor,
          pageSize: 20,
        });
        setMarketplaceItems((previous) =>
          cursor
            ? [
                ...previous,
                ...response.items.filter(
                  (item) => !previous.some((current) => current.id === item.id),
                ),
              ]
            : response.items,
        );
        setMarketplaceHasMore(response.hasMore);
        setMarketplaceNextCursor(response.nextCursor);
        setMarketplaceTotal(response.total);
      } catch (caught) {
        setMarketplaceItems([]);
        setMarketplaceTotal(undefined);
        setMarketplaceError(
          caught instanceof Error ? caught.message : "MCP 市场加载失败。",
        );
      } finally {
        setMarketplaceLoading(false);
      }
    },
    [mcpMarketplaceEndpoint],
  );

  useEffect(() => {
    void loadMarketplace(debouncedMarketplaceQuery);
  }, [loadMarketplace, debouncedMarketplaceQuery]);

  const filteredServers = useMemo(() => {
    const normalized = marketplaceQuery.trim().toLowerCase();
    if (!normalized) return servers;
    return servers.filter((server) =>
      [server.name, JSON.stringify(server.config ?? {})]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [marketplaceQuery, servers]);

  if (!settings) {
    return (
      <div className="plugin-mcp-state" role="status">
        正在加载 MCP 配置...
      </div>
    );
  }

  const canEdit = settings.enterprisePolicy?.allowLocalMcpServers !== false;
  const marketplaceConfigured =
    Boolean(mcpMarketplaceEndpoint?.enabled) &&
    isConfiguredMarketplaceUrl(mcpMarketplaceEndpoint?.baseUrl);

  const commit = async (next: McpServerConfig[], message?: string) => {
    setServers(next);
    setSaving(true);
    try {
      await save({ ...settings, mcpServers: next });
      if (message) notify({ title: message, tone: "success" });
    } catch (caught) {
      notify({
        title: "保存 MCP 配置失败",
        description: caught instanceof Error ? caught.message : String(caught),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const openCreate = () => {
    setMode("stdio");
    setDraft(emptyMcpAddDraft());
    setValidationError(null);
    setDialog({ kind: "create" });
  };

  const openEdit = (server: McpServerConfig) => {
    const next = draftFromServer(server);
    setMode(next.mode);
    setDraft(next.draft);
    setValidationError(null);
    setDialog({ kind: "edit", serverId: server.id });
  };

  const submitDialog = () => {
    const config = buildMcpConfigFromDraft(mode, draft);
    if (!draft.name.trim()) {
      setValidationError("服务名称不能为空。");
      return;
    }
    if (!config) {
      setValidationError("请填写当前接入方式所需的有效连接信息。");
      return;
    }
    if (dialog?.kind === "edit") {
      const next = servers.map((server) =>
        server.id === dialog.serverId
          ? {
              ...server,
              name: draft.name.trim(),
              config,
              enabled: draft.enabled,
            }
          : server,
      );
      setDialog(null);
      void commit(next, `${draft.name.trim()} 已更新`);
      return;
    }
    const nextServer: McpServerConfig = {
      id: crypto.randomUUID(),
      name: draft.name.trim(),
      config,
      enabled: draft.enabled,
      lastStatus: "untested",
    };
    setDialog(null);
    void commit([nextServer, ...servers], `${nextServer.name} 已添加`);
  };

  const refreshStatus = async () => {
    setRefreshing(true);
    try {
      const refreshed = await window.marloues.mcp.refreshStatus();
      await commit(refreshed, "MCP 状态已刷新");
    } catch (caught) {
      notify({
        title: "刷新 MCP 状态失败",
        description: caught instanceof Error ? caught.message : String(caught),
        tone: "error",
      });
    } finally {
      setRefreshing(false);
    }
  };

  const testServer = async (server: McpServerConfig) => {
    setCheckingId(server.id);
    try {
      const tested = await window.marloues.mcp.testServer(server);
      await commit(
        servers.map((candidate) =>
          candidate.id === server.id ? tested : candidate,
        ),
        tested.lastStatus === "ok"
          ? `${server.name} 已连接`
          : `${server.name} 连接失败：${formatMcpError(tested.lastError)}`,
      );
    } catch (caught) {
      notify({
        title: `${server.name} 连接失败`,
        description: caught instanceof Error ? caught.message : String(caught),
        tone: "error",
      });
    } finally {
      setCheckingId(null);
    }
  };

  const enabledCount = servers.filter((server) => server.enabled).length;
  const toolCount = new Set(servers.flatMap((server) => server.tools ?? []))
    .size;

  const installMarketplaceServer = async (item: McpMarketplaceItem) => {
    setInstallingMarketplaceId(item.id);
    try {
      const nextServers = await window.marloues.mcp.marketplaceInstall(item.id);
      setServers(nextServers);
      await load();
      await loadMarketplace(debouncedMarketplaceQuery);
      notify({ title: `${item.name} 已安装`, tone: "success" });
    } catch (caught) {
      notify({
        title: `${item.name} 安装失败`,
        description: caught instanceof Error ? caught.message : String(caught),
        tone: "error",
      });
    } finally {
      setInstallingMarketplaceId(null);
    }
  };

  const loadMoreMarketplace = async () => {
    if (!marketplaceNextCursor || marketplaceLoading) return;
    await loadMarketplace(debouncedMarketplaceQuery, marketplaceNextCursor);
  };

  const refreshCurrentView = async () => {
    if (view === "discover") {
      await loadMarketplace(debouncedMarketplaceQuery);
      return;
    }
    await refreshStatus();
  };

  const resultLabel =
    view === "discover"
      ? `${marketplaceItems.length}${
          marketplaceTotal !== undefined ? ` / ${marketplaceTotal}` : ""
        } 个 MCP 服务`
      : `${filteredServers.length} 个 · ${enabledCount} 启用 · ${toolCount} 工具`;

  return (
    <div data-testid="mcp-marketplace-page" className="skill-marketplace-page">
      <div className="toolbar">
        <form
          className="search"
          onSubmit={(event) => {
            event.preventDefault();
            if (searchTimeoutRef.current) {
              clearTimeout(searchTimeoutRef.current);
              searchTimeoutRef.current = null;
            }
            setDebouncedMarketplaceQuery(marketplaceQuery);
            setView("discover");
          }}
        >
          <Search aria-hidden="true" />
          <input
            value={marketplaceQuery}
            placeholder={
              view === "discover" ? "搜索 MCP 市场" : "搜索已安装 MCP"
            }
            onChange={(event) =>
              handleMarketplaceQueryChange(event.target.value)
            }
          />
          {marketplaceQuery ? (
            <button
              type="button"
              aria-label="清除搜索"
              onClick={() => {
                if (searchTimeoutRef.current) {
                  clearTimeout(searchTimeoutRef.current);
                  searchTimeoutRef.current = null;
                }
                setMarketplaceQuery("");
                setDebouncedMarketplaceQuery("");
              }}
            >
              <X size={14} />
            </button>
          ) : null}
          <button
            type="submit"
            aria-label="搜索"
            disabled={view === "discover" && !marketplaceConfigured}
          >
            <Search />
          </button>
        </form>

        <div className="subseg" role="tablist" aria-label="MCP 视图">
          <button
            role="tab"
            aria-selected={view === "discover"}
            type="button"
            className={view === "discover" ? "active" : ""}
            onClick={() => setView("discover")}
          >
            发现
          </button>
          <button
            role="tab"
            aria-selected={view === "installed"}
            type="button"
            className={view === "installed" ? "active" : ""}
            onClick={() => setView("installed")}
          >
            已安装
          </button>
        </div>

        <button
          className="plugin-refresh-button"
          type="button"
          aria-label="刷新当前 MCP 视图"
          disabled={marketplaceLoading || refreshing}
          onClick={() => void refreshCurrentView()}
        >
          <RefreshCcw
            className={
              marketplaceLoading || refreshing ? "is-spinning" : undefined
            }
          />
        </button>

        <button
          className="plugin-local-import-button"
          type="button"
          disabled={!canEdit}
          onClick={openCreate}
        >
          <Plus /> 添加 MCP 服务
        </button>
      </div>

      {marketplaceError && view === "discover" ? (
        <div className="plugin-inline-message" role="alert">
          <span>{marketplaceError}</span>
          <button
            type="button"
            aria-label="关闭错误提示"
            onClick={() => setMarketplaceError(null)}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className="plugin-results-scroll" aria-busy={marketplaceLoading}>
        <div className="resbar">
          <span>
            {view === "discover" ? "发现" : "已安装"} · {resultLabel}
          </span>
          <span className="view">
            <button
              aria-pressed={layout === "list"}
              className="viewbtn"
              type="button"
              title="列表视图"
              aria-label="列表视图"
              onClick={() => setLayout("list")}
            >
              <ListIcon />
            </button>
            <button
              aria-pressed={layout === "grid"}
              className="viewbtn"
              type="button"
              title="卡片视图"
              aria-label="卡片视图"
              onClick={() => setLayout("grid")}
            >
              <LayoutGrid />
            </button>
          </span>
        </div>

        {view === "discover" ? (
          <>
            {marketplaceLoading && marketplaceItems.length === 0 ? (
              <div className="plugin-mcp-state" role="status">
                正在加载 MCP 市场...
              </div>
            ) : null}

            {!marketplaceLoading && !marketplaceConfigured ? (
              <div className="plugin-empty-state">
                <span>
                  <Search aria-hidden="true" />
                </span>
                <strong>未配置 MCP 市场端点</strong>
                <p>在设置 → 运行时中配置端点后，可在这里发现 MCP 服务。</p>
              </div>
            ) : null}

            {!marketplaceLoading &&
            marketplaceConfigured &&
            marketplaceItems.length === 0 ? (
              <div className="plugin-empty-state">
                <span>
                  <Search aria-hidden="true" />
                </span>
                <strong>没有找到符合条件的 MCP 服务</strong>
                <p>尝试更换搜索词。</p>
              </div>
            ) : null}

            <div
              className={`plugin-card-grid${layout === "list" ? " is-list" : ""}`}
            >
              {marketplaceItems.map((item) => (
                <McpMarketplaceCard
                  key={item.id}
                  item={item}
                  layout={layout}
                  installingId={installingMarketplaceId}
                  canInstall={canEdit}
                  onInstall={(next) => void installMarketplaceServer(next)}
                />
              ))}
              {marketplaceHasMore && marketplaceNextCursor ? (
                <div className="skill-market-load-more">
                  <button
                    type="button"
                    disabled={marketplaceLoading}
                    onClick={() => void loadMoreMarketplace()}
                  >
                    {marketplaceLoading ? "加载中..." : "加载更多"}
                  </button>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <>
            {filteredServers.length === 0 ? (
              <div className="plugin-empty-state">
                <span>
                  <Download aria-hidden="true" />
                </span>
                <strong>暂无已安装的 MCP 服务</strong>
                <p>切换到发现页安装服务，或点击右上角手动添加。</p>
              </div>
            ) : null}

            <div
              className={`plugin-card-grid${layout === "list" ? " is-list" : ""}`}
            >
              {filteredServers.map((server) => (
                <McpInstalledCard
                  key={server.id}
                  server={server}
                  layout={layout}
                  canEdit={canEdit}
                  saving={saving}
                  checkingId={checkingId}
                  onEdit={openEdit}
                  onToggle={(next) =>
                    void commit(
                      servers.map((item) =>
                        item.id === next.id
                          ? { ...item, enabled: !item.enabled }
                          : item,
                      ),
                    )
                  }
                  onTest={(next) => void testServer(next)}
                  onDelete={setDeleting}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {dialog ? (
        <McpAddDialog
          mode={mode}
          setMode={setMode}
          draft={draft}
          setDraft={setDraft}
          canEdit={canEdit}
          saving={saving}
          editing={dialog.kind === "edit"}
          error={validationError}
          onSubmit={submitDialog}
          onCancel={() => setDialog(null)}
          onReset={() => {
            if (dialog.kind === "edit") {
              const server = servers.find(
                (item) => item.id === dialog.serverId,
              );
              if (server) {
                const next = draftFromServer(server);
                setMode(next.mode);
                setDraft(next.draft);
              }
            } else {
              setDraft(emptyMcpAddDraft());
            }
            setValidationError(null);
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`删除 MCP 服务「${deleting.name}」？`}
          message="该服务配置将从本机移除，此操作不可撤销。"
          confirmLabel="删除"
          cancelLabel="取消"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            void commit(servers.filter((server) => server.id !== id));
          }}
        />
      ) : null}
    </div>
  );
}
