import { useEffect, useState } from "react";
import { PlugZap, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { notify } from "@/lib/notifications";
import { useSettingsStore } from "@/stores/settings-store";
import type { McpServerConfig } from "@shared/types";
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
  if (server.lastStatus === "running")
    return { label: "连接中", tone: "running" };
  if (server.lastStatus === "ok") return { label: "正常", tone: "ok" };
  return { label: "未测试", tone: "off" };
}

export function McpServersPanel() {
  const settings = useSettingsStore((state) => state.settings);
  const load = useSettingsStore((state) => state.load);
  const save = useSettingsStore((state) => state.save);
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [mode, setMode] = useState<McpAddMode>("stdio");
  const [draft, setDraft] = useState<McpAddDraft>(() => emptyMcpAddDraft());
  const [dialog, setDialog] = useState<DialogState>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<McpServerConfig | null>(null);

  useEffect(() => {
    if (!settings) void load();
  }, [load, settings]);

  useEffect(() => {
    if (settings) setServers(settings.mcpServers ?? []);
  }, [settings]);

  if (!settings) {
    return (
      <div className="plugin-mcp-state" role="status">
        正在加载 MCP 配置...
      </div>
    );
  }

  const canEdit = settings.enterprisePolicy?.allowLocalMcpServers !== false;

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

  return (
    <div className="mcp-provider-page">
      <div className="plugin-mcp-summary">
        <dl>
          <div>
            <dt>服务</dt>
            <dd>{servers.length}</dd>
          </div>
          <div>
            <dt>启用服务</dt>
            <dd>
              {enabledCount}/{servers.length}
            </dd>
          </div>
          <div>
            <dt>可用工具</dt>
            <dd>{toolCount}</dd>
          </div>
        </dl>
        <div className="plugin-mcp-summary-actions">
          <button
            className={`plugin-mcp-secondary-action${refreshing ? " is-loading" : ""}`}
            type="button"
            disabled={refreshing || servers.length === 0}
            onClick={() => void refreshStatus()}
          >
            <RefreshCcw aria-hidden="true" />
            {refreshing ? "刷新中" : "刷新状态"}
          </button>
          <button
            className="plugin-mcp-primary-action"
            type="button"
            disabled={!canEdit}
            onClick={openCreate}
          >
            <Plus aria-hidden="true" />
            添加 MCP 服务
          </button>
        </div>
      </div>

      <div className="plugin-mcp-service-scroll">
        {servers.length === 0 ? (
          <div className="plugin-mcp-state">
            还没有 MCP 服务，点击右上角添加第一个服务。
          </div>
        ) : (
          servers.map((server) => {
            const status = statusOf(server);
            return (
              <article
                className={`plugin-mcp-service${server.enabled ? " is-enabled" : ""}`}
                key={server.id}
              >
                <div className="plugin-mcp-service-row">
                  <button
                    className="plugin-mcp-service-main"
                    type="button"
                    aria-label={`编辑 ${server.name}`}
                    onClick={() => openEdit(server)}
                  >
                    <span
                      className={`plugin-mcp-status-dot is-${status.tone}`}
                      aria-hidden="true"
                    />
                    <span className="plugin-mcp-service-identity">
                      <strong>{server.name || "未命名服务"}</strong>
                      <small>
                        {transportLabel(server)} · {server.tools?.length ?? 0}{" "}
                        个工具
                      </small>
                    </span>
                    <span
                      className={`plugin-mcp-status-label is-${status.tone}`}
                    >
                      {status.label}
                    </span>
                  </button>
                  <div className="plugin-mcp-service-actions">
                    <button
                      className="scheduled-switch"
                      type="button"
                      role="switch"
                      aria-checked={server.enabled}
                      aria-label={`${server.enabled ? "停用" : "启用"} ${server.name}`}
                      disabled={server.locked || !canEdit || saving}
                      onClick={() =>
                        void commit(
                          servers.map((item) =>
                            item.id === server.id
                              ? { ...item, enabled: !item.enabled }
                              : item,
                          ),
                        )
                      }
                    >
                      <span />
                    </button>
                    <button
                      className="plugin-mcp-icon-action"
                      type="button"
                      title="连通性检测"
                      aria-label={`检测 ${server.name} 的连通性`}
                      disabled={checkingId === server.id}
                      onClick={() => void testServer(server)}
                    >
                      {checkingId === server.id ? (
                        <RefreshCcw className="is-spinning" />
                      ) : (
                        <PlugZap />
                      )}
                    </button>
                    <button
                      className="plugin-mcp-icon-action is-danger"
                      type="button"
                      title="删除服务"
                      aria-label={`删除 ${server.name}`}
                      disabled={server.locked || !canEdit || saving}
                      onClick={() => setDeleting(server)}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                </div>
                {server.lastStatus === "error" && server.lastError ? (
                  <p className="plugin-mcp-row-error">{server.lastError}</p>
                ) : null}
              </article>
            );
          })
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
