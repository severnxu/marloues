import { Cpu, CheckCircle2, CircleAlert, FolderOpen, PlugZap } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace-store";

/* 触发 settings 页跳转的轻量事件（WorkspaceLayout 监听） */
export const OPEN_SETTINGS_EVENT = "marloues:open-settings";

export interface EmptyChatReadiness {
  hasWorkspace: boolean;
  hasEndpoint: boolean;
  enabledMcpCount: number;
}

const hints = [
  "帮我分析这个项目结构",
  "生成一份需求方案",
  "检查一下这个目录里的文档",
  "整理并总结这个工作区",
];

/* PRD 5.9.1 — 空态特性要点：多内核 / MCP 工具 / 本地优先 */
const features = [
  { title: "多内核", description: "Binary · SDK · 自建，自由切换" },
  { title: "MCP 工具", description: "Skills · Shell · 文件，由你掌控" },
  { title: "本地优先", description: "数据在你电脑上，不经过服务器" },
];

const fallbackReadiness: EmptyChatReadiness = {
  hasWorkspace: false,
  hasEndpoint: false,
  enabledMcpCount: 0,
};

export function EmptyChatState({
  onSend,
  onSelectRuntime,
  onOpenWorkspace,
  readiness = fallbackReadiness,
}: {
  onSend: (text: string) => void | Promise<void>;
  onSelectRuntime?: () => void;
  onOpenWorkspace?: () => void;
  readiness?: EmptyChatReadiness;
}) {
  const ready = readiness.hasWorkspace && readiness.hasEndpoint;
  const copy = getEmptyStateCopy(readiness);

  const selectWorkspace = useWorkspaceStore((state) => state.select);
  const handleSelectRuntime = onSelectRuntime ?? (() => {
    window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { section: "runtime" } }));
  });
  const handleOpenWorkspace = onOpenWorkspace ?? (() => {
    void selectWorkspace();
  });

  return (
    <div className="empty-chat-state">
      {/* PRD 5.9.1 — 居中大标题 + 口号 */}
      <h1 className="empty-chat-brand">marloues</h1>
      <p className="empty-chat-slogan">一个工作台，任意 Agent。</p>

      {/* 行动按钮卡：选择 Runtime / 打开工作区 */}
      <div className="empty-chat-actions">
        <button
          type="button"
          className="empty-chat-action-card primary"
          onClick={handleSelectRuntime}
        >
          <Cpu size={20} />
          <strong>选择 Runtime</strong>
          <small>开始对话</small>
        </button>
        <button
          type="button"
          className="empty-chat-action-card"
          onClick={handleOpenWorkspace}
        >
          <FolderOpen size={20} />
          <strong>打开工作区</strong>
          <small>浏览文件</small>
        </button>
      </div>

      {/* PRD 5.9.1 — 下方 3 个特性要点，纯文字，不用图标 */}
      <div className="empty-chat-features">
        {features.map((feature) => (
          <div key={feature.title} className="empty-chat-feature">
            <span className="empty-chat-feature-title">{feature.title}</span>
            <span className="empty-chat-feature-desc">{feature.description}</span>
          </div>
        ))}
      </div>

      {/* 功能引导（保留 readiness + hints） */}
      <div className="empty-chat-readiness" aria-label="准备状态">
        <ReadinessChip
          ok={readiness.hasWorkspace}
          label={readiness.hasWorkspace ? "工作区已选" : "待选工作区"}
        />
        <ReadinessChip
          ok={readiness.hasEndpoint}
          label={readiness.hasEndpoint ? "模型端点已配" : "待配模型端点"}
        />
        <span className={readiness.enabledMcpCount > 0 ? "ok" : "neutral"}>
          <PlugZap size={13} />
          MCP {readiness.enabledMcpCount > 0 ? `${readiness.enabledMcpCount} 个已启用` : "可选"}
        </span>
      </div>
      <p className="empty-chat-status">{copy.description}</p>
      <div className="empty-chat-hints">
        {hints.map((hint) => (
          <button
            key={hint}
            type="button"
            disabled={!ready}
            title={ready ? hint : "先选择工作区并配置模型端点"}
            onClick={() => void onSend(hint)}
          >
            {hint}
          </button>
        ))}
      </div>
    </div>
  );
}

function ReadinessChip({ ok, label }: { ok: boolean; label: string }) {
  const Icon = ok ? CheckCircle2 : CircleAlert;
  return (
    <span className={ok ? "ok" : "warn"}>
      <Icon size={13} />
      {label}
    </span>
  );
}

function getEmptyStateCopy(readiness: EmptyChatReadiness): { description: string } {
  if (!readiness.hasWorkspace && !readiness.hasEndpoint) {
    return { description: "选择工作区并配好模型端点后，Marloues 就能在本地项目里执行任务。" };
  }
  if (!readiness.hasWorkspace) {
    return { description: "对话会以工作区作为 cwd 运行，这样才能读写项目文件和调用本地工具。" };
  }
  if (!readiness.hasEndpoint) {
    return { description: "添加内网网关或测试 provider，确认 Base URL、Token 和默认模型可用。" };
  }
  return {
    description:
      readiness.enabledMcpCount > 0
        ? `Marloues 已就绪，当前有 ${readiness.enabledMcpCount} 个 MCP 工具可用。`
        : "Marloues 已就绪，可以直接处理这个本地工作区里的任务。",
  };
}
