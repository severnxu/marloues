import { Cpu, Gauge, TerminalSquare } from "lucide-react";
import {
  SettingRow,
  SettingsCard,
  SettingsCheckbox,
  SettingsSelect,
  SettingsTextField,
} from "@/components/settings";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { notify } from "@/lib/notifications";
import { runtimePresentation } from "@/lib/runtime-presentation";
import { useSettingsStore } from "@/stores/settings-store";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import type {
  AgentSettings,
  MarketplaceEndpoint,
  RuntimeKind,
} from "@shared/types";

export function RuntimeSettings({
  draft,
  onCommitDraft,
}: {
  draft: AgentSettings;
  onCommitDraft: (nextDraft: AgentSettings) => void;
}) {
  const runtimeState = useSettingsStore((state) => state.runtimeState);
  const switchingRuntimeId = useSettingsStore(
    (state) => state.switchingRuntimeId,
  );
  const switchRuntime = useSettingsStore((state) => state.switchRuntime);
  const hasRunningTask = useUnifiedChatStore((state) => state.isStreaming);
  const { showConfirm, DialogComponent } = useConfirmDialog();
  const activeRuntimeId =
    runtimeState?.activeRuntimeId ?? draft.activeRuntimeId ?? "sdk";
  const activeRuntime = runtimePresentation(activeRuntimeId);
  const runtimeOptions =
    runtimeState?.runtimes
      .filter((runtime) => runtime.status === "available")
      .map((runtime) => ({
        value: runtime.id,
        label: `${runtimePresentation(runtime.id).label} · ${
          runtimePresentation(runtime.id).protocol
        }`,
      })) ?? [];

  const handleRuntimeChange = async (value: string) => {
    const runtimeId = value as RuntimeKind;
    if (runtimeId === activeRuntimeId) return;
    if (hasRunningTask) {
      const confirmed = await showConfirm({
        title: "切换运行时？",
        message:
          "当前有任务正在运行。切换运行时会先停止正在运行的会话，然后后续任务将使用新的运行时。",
        confirmLabel: "停止并切换",
        variant: "warning",
      });
      if (!confirmed) return;
      await stopRunningSessions();
    }
    try {
      await switchRuntime(runtimeId);
      notify({
        title: `已切换到 ${runtimePresentation(runtimeId).label}`,
        description: `模型请求将使用 ${
          runtimePresentation(runtimeId).protocol
        } 协议路由。`,
        tone: "success",
      });
    } catch (error) {
      notify({
        title: "运行时切换失败",
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    }
  };

  const updateMarketplaceEndpoint = (
    kind: "skillMarketplaceEndpoint" | "mcpMarketplaceEndpoint",
    patch: Partial<MarketplaceEndpoint>,
  ) => {
    const endpoint = draft[kind];
    const addressChanged = patch.baseUrl !== undefined;
    onCommitDraft({
      ...draft,
      [kind]: {
        id: endpoint?.id ?? crypto.randomUUID(),
        baseUrl: endpoint?.baseUrl ?? "",
        adapter: endpoint?.adapter ?? "custom",
        enabled: endpoint?.enabled ?? true,
        lastStatus: addressChanged
          ? "untested"
          : (endpoint?.lastStatus ?? "untested"),
        lastError: addressChanged ? undefined : endpoint?.lastError,
        ...patch,
      },
    });
  };

  const testMarketplaceEndpoint = async (
    kind: "skillMarketplaceEndpoint" | "mcpMarketplaceEndpoint",
  ) => {
    const endpoint = draft[kind];
    if (!endpoint || !isConfiguredMarketplaceUrl(endpoint.baseUrl)) {
      notify({ title: "请先填写市场地址", tone: "error" });
      return;
    }
    const result =
      await window.marloues.config.testMarketplaceEndpoint(endpoint);
    updateMarketplaceEndpoint(kind, {
      lastStatus: result.ok ? "ok" : "error",
      lastError: result.ok ? undefined : result.message,
      lastCheckedAt: Date.now(),
    });
    notify({
      title: result.ok ? "市场端点连接正常" : "市场端点连接失败",
      description: result.message,
      tone: result.ok ? "success" : "error",
    });
  };

  return (
    <>
      {DialogComponent}
      <SettingsCard
        title="Agent 运行时"
        description="选择执行任务的引擎，模型供应商会自动匹配对应协议。"
        icon={<Cpu size={16} />}
      >
        <SettingRow
          icon={<TerminalSquare size={16} />}
          title="默认运行时"
          description={`${activeRuntime.description}；当前协议为 ${activeRuntime.protocol}。`}
          trailing={
            <div className="runtime-settings-select">
              <SettingsSelect
                ariaLabel="默认 Agent 运行时"
                value={activeRuntimeId}
                options={runtimeOptions}
                disabled={Boolean(switchingRuntimeId)}
                onChange={(value) => void handleRuntimeChange(value)}
              />
            </div>
          }
        />
      </SettingsCard>

      <SettingsCard
        title="任务运行"
        description="控制任务轮次和模型思考预算。"
        icon={<Gauge size={16} />}
      >
        <SettingsTextField
          label="最大轮次"
          type="number"
          value={draft.maxTurns}
          onValueChange={(value) =>
            onCommitDraft({
              ...draft,
              maxTurns: Number(value) || 50,
            })
          }
        />
        <SettingsTextField
          label="最大思考 Token"
          type="number"
          value={draft.maxThinkingTokens}
          onValueChange={(value) =>
            onCommitDraft({
              ...draft,
              maxThinkingTokens: Number(value) || 0,
            })
          }
        />
        <label className="settings-toggle">
          <SettingsCheckbox
            checked={draft.thinkingEnabled}
            onChange={(event) =>
              onCommitDraft({ ...draft, thinkingEnabled: event.target.checked })
            }
          />
          启用思考
        </label>
      </SettingsCard>

      <SettingsCard
        title="端点配置"
        description="分别配置 Skill 与 MCP 市场端点；可填写相同地址，也可使用不同的市场服务。"
        icon={<TerminalSquare size={16} />}
        surface="plain"
      >
        <div className="provider-list">
          <MarketplaceEndpointRow
            title="Skill 市场端点"
            endpoint={draft.skillMarketplaceEndpoint}
            onUpdate={(patch) =>
              updateMarketplaceEndpoint("skillMarketplaceEndpoint", patch)
            }
            onTest={() =>
              void testMarketplaceEndpoint("skillMarketplaceEndpoint")
            }
          />
          <MarketplaceEndpointRow
            title="MCP 市场端点"
            endpoint={draft.mcpMarketplaceEndpoint}
            onUpdate={(patch) =>
              updateMarketplaceEndpoint("mcpMarketplaceEndpoint", patch)
            }
            onTest={() =>
              void testMarketplaceEndpoint("mcpMarketplaceEndpoint")
            }
          />
        </div>
      </SettingsCard>
    </>
  );
}

function MarketplaceEndpointRow({
  title,
  endpoint,
  onUpdate,
  onTest,
}: {
  title: string;
  endpoint?: MarketplaceEndpoint;
  onUpdate: (patch: Partial<MarketplaceEndpoint>) => void;
  onTest: () => void;
}) {
  const enabled = endpoint?.enabled ?? true;
  const status = isConfiguredMarketplaceUrl(endpoint?.baseUrl)
    ? (endpoint?.lastStatus ?? "untested")
    : "untested";
  return (
    <div className="provider-row marketplace-endpoint-row">
      <div className="provider-row-head">
        <div className="provider-row-title">
          <div>
            <strong>{title}</strong>
            <span
              className={`settings-chip marketplace-endpoint-status ${status}`}
            >
              {status === "ok"
                ? "连接正常"
                : status === "error"
                  ? "连接失败"
                  : "未测试"}
            </span>
          </div>
        </div>
        <div className="settings-row-actions provider-actions">
          <label className="settings-inline-check provider-enable-check">
            <SettingsCheckbox
              checked={enabled}
              onChange={(event) => onUpdate({ enabled: event.target.checked })}
            />
            启用
          </label>
          <button
            className="settings-action-button"
            type="button"
            disabled={!isConfiguredMarketplaceUrl(endpoint?.baseUrl)}
            onClick={onTest}
          >
            测试连接
          </button>
        </div>
      </div>
      <div className="marketplace-endpoint-fields">
        <input
          className="marketplace-endpoint-input"
          type="url"
          aria-label={`${title}地址`}
          value={endpoint?.baseUrl ?? ""}
          placeholder="https://market.example.com"
          onChange={(event) => onUpdate({ baseUrl: event.target.value })}
        />
      </div>
    </div>
  );
}

function isConfiguredMarketplaceUrl(value: string | undefined): boolean {
  const normalized = value?.trim() ?? "";
  return Boolean(
    normalized && normalized !== "https://" && normalized !== "http://",
  );
}

async function stopRunningSessions(): Promise<void> {
  const chatStore = useUnifiedChatStore.getState();
  const runningSessionIds = Object.entries(chatStore.streamingSessionIds)
    .filter(([, running]) => Boolean(running))
    .map(([sessionId]) => sessionId);

  if (!runningSessionIds.length) {
    await chatStore.abort();
    return;
  }

  await Promise.all(
    runningSessionIds.map((sessionId) => chatStore.abort(sessionId)),
  );
}
