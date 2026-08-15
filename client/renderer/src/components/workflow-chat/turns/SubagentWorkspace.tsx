import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Brain,
  CheckCircle2,
  CircleDashed,
  FileText,
  LoaderCircle,
  Plus,
  Terminal,
  UserRoundCog,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import type { ExecutionSubagentRecord } from "@/stores/unified-chat-store";
import type { TimelineItem } from "@shared/types";
import {
  WORKFLOW_READ_THREAD_SCHEMA_VERSION,
  type WorkflowDynamicToolCallItem,
  type WorkflowReadThreadResponse,
  type WorkflowReasoningItem,
  type WorkflowTurnItem,
  type WorkflowTurnStatus,
} from "@shared/workflow-read-thread-contract";
import { WorkflowReadThreadTurnList } from "./ReadThreadTurnList";

const SUBAGENT_ICONS: LucideIcon[] = [
  Bot,
  Brain,
  UserRoundCog,
  Terminal,
  FileText,
  Wrench,
];

export function WorkflowSubagentWorkspace({
  subagentId,
}: {
  subagentId?: string;
}) {
  const activeSessionId = useUnifiedChatStore((state) => state.activeSessionId);
  const execution = useUnifiedChatStore((state) =>
    activeSessionId
      ? (state.executionBySession[activeSessionId] ?? null)
      : null,
  );
  const selectExecutionSubagent = useUnifiedChatStore(
    (state) => state.selectExecutionSubagent,
  );
  const [closedIds, setClosedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setClosedIds(new Set());
  }, [activeSessionId]);

  const subagents = useMemo(
    () =>
      Object.values(execution?.subagents ?? {})
        .sort((a, b) => a.ordinal - b.ordinal)
        .filter((subagent) => !closedIds.has(subagent.id)),
    [closedIds, execution?.subagents],
  );
  const selectedSubagent =
    (subagentId ? subagents.find((item) => item.id === subagentId) : null) ??
    subagents.find((item) => item.id === execution?.selectedSubagentId) ??
    subagents[0] ??
    null;

  useEffect(() => {
    if (subagentId || !activeSessionId || !selectedSubagent) return;
    if (execution?.selectedSubagentId === selectedSubagent.id) return;
    selectExecutionSubagent(activeSessionId, selectedSubagent.id);
  }, [
    activeSessionId,
    execution?.selectedSubagentId,
    selectExecutionSubagent,
    selectedSubagent,
    subagentId,
  ]);

  if (!subagents.length) return null;

  const closeSubagent = (subagentId: string) => {
    setClosedIds((current) => {
      const next = new Set(current);
      next.add(subagentId);
      return next;
    });
    if (activeSessionId && selectedSubagent?.id === subagentId) {
      const nextSelected = subagents.find((item) => item.id !== subagentId);
      if (nextSelected) {
        selectExecutionSubagent(activeSessionId, nextSelected.id);
      }
    }
  };

  return (
    <aside className="subagent-workspace" aria-label="子代理工作区">
      {subagents.length ? (
        <div
          className="subagent-tabs"
          role="tablist"
          aria-label="子代理列表"
          hidden={Boolean(subagentId)}
        >
          {subagents.map((subagent) => (
            <SubagentTab
              key={subagent.id}
              subagent={subagent}
              selected={subagent.id === selectedSubagent?.id}
              onSelect={() => {
                if (activeSessionId) {
                  selectExecutionSubagent(activeSessionId, subagent.id);
                }
              }}
              onClose={() => closeSubagent(subagent.id)}
            />
          ))}
          <button
            type="button"
            className="subagent-tab-plus"
            title="子代理会在创建后自动出现在这里"
            aria-label="子代理会在创建后自动出现在这里"
          >
            <Plus size={14} />
          </button>
        </div>
      ) : null}

      <div className="subagent-workspace-body scrollbar-thin">
        {selectedSubagent ? (
          <SubagentThread subagent={selectedSubagent} />
        ) : (
          <div className="subagent-empty-state">
            <Bot size={24} />
            <span>等待 subagent 创建</span>
          </div>
        )}
      </div>
    </aside>
  );
}

function SubagentTab({
  subagent,
  selected,
  onSelect,
  onClose,
}: {
  subagent: ExecutionSubagentRecord;
  selected: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const Icon = iconFromSeed(subagent.iconSeed);
  const label =
    subagent.agentName ??
    subagent.agentType ??
    subagent.title ??
    `#${subagent.ordinal}`;

  return (
    <div className={`subagent-tab ${selected ? "selected" : ""}`} role="tab">
      <button
        type="button"
        className="subagent-tab-main"
        onClick={onSelect}
        aria-selected={selected}
        title={subagent.title ?? label}
      >
        <Icon size={15} />
        <span>{label}</span>
        <StatusIcon status={subagent.status} />
      </button>
      <button
        type="button"
        className="subagent-tab-close"
        onClick={onClose}
        aria-label={`关闭 ${label}`}
        title="关闭标签"
      >
        <X size={13} />
      </button>
    </div>
  );
}

function SubagentThread({ subagent }: { subagent: ExecutionSubagentRecord }) {
  const readThread = useMemo(() => subagentToReadThread(subagent), [subagent]);
  const isStreaming =
    subagent.status === "creating" || subagent.status === "running";

  return (
    <div className="subagent-thread-shell">
      <WorkflowReadThreadTurnList
        readThread={readThread}
        isStreaming={isStreaming}
        plainTextAnswers
        stateScopeKey={`subagent:${subagent.id}`}
        showFooterMetadata={false}
      />
    </div>
  );
}

function subagentToReadThread(
  subagent: ExecutionSubagentRecord,
): WorkflowReadThreadResponse {
  const threadTitle =
    subagent.agentName ??
    subagent.agentType ??
    subagent.description ??
    `Subagent #${subagent.ordinal}`;
  const promptText = subagent.prompt ?? subagent.description ?? subagent.title;
  const items = subagentToTurnItems(subagent, promptText);
  const completedAt = subagent.completedAt ?? null;
  const running =
    subagent.status === "creating" || subagent.status === "running";

  return {
    schemaVersion: WORKFLOW_READ_THREAD_SCHEMA_VERSION,
    thread: {
      id: `subagent:${subagent.id}`,
      title: threadTitle,
      preview: subagent.text.trim() || promptText || threadTitle,
      status: running ? { type: "active", activeFlags: {} } : { type: "idle" },
      cwd: null,
      createdAt: subagent.createdAt,
      updatedAt: subagent.updatedAt,
    },
    page: {
      order: "newest_first",
      limit: 1,
      nextCursor: null,
      hasMore: false,
    },
    turns: [
      {
        id: `subagent-turn:${subagent.id}`,
        // subagent 视角属于桌面工作区展示
        zone: "workspace",
        ordinal: subagent.ordinal,
        status: subagentStatusToTurnStatus(subagent.status),
        error:
          subagent.status === "failed"
            ? { message: `${subagent.agentType ?? "Subagent"} failed` }
            : null,
        startedAt: subagent.createdAt,
        completedAt,
        durationMs: completedAt ? completedAt - subagent.createdAt : null,
        modelId: null,
        modelName: subagent.agentName ?? subagent.agentType ?? null,
        items,
      },
    ],
  };
}

function subagentToTurnItems(
  subagent: ExecutionSubagentRecord,
  promptText?: string,
): WorkflowTurnItem[] {
  const items: WorkflowTurnItem[] = [];
  if (promptText?.trim()) {
    items.push({
      type: "userMessage",
      id: `subagent-user:${subagent.id}`,
      content: [
        {
          type: "text",
          text: promptText,
          workflowDelegation: {
            sourceThreadId: subagent.parentToolId,
            input: promptText,
          },
        },
      ],
    });
  }

  const reasoning = reasoningItemFromTimeline(subagent.timeline, subagent.id);
  if (reasoning) items.push(reasoning);

  for (const item of toolItemsFromTimeline(subagent.timeline)) {
    items.push(item);
  }

  if (subagent.text.trim()) {
    items.push({
      type: "agentMessage",
      id: `subagent-answer:${subagent.id}`,
      text: subagent.text.trim(),
      phase: subagent.status === "completed" ? "final" : "streaming",
    });
  }

  if (!items.length && subagent.status !== "completed") {
    items.push({
      type: "unknown",
      id: `subagent-status:${subagent.id}`,
      rawType: "runtime-status",
      raw: {
        label:
          subagent.status === "creating" ? "正在创建子代理" : "子代理运行中",
      },
    });
  }

  return items;
}

function reasoningItemFromTimeline(
  timeline: TimelineItem[],
  subagentId: string,
): WorkflowReasoningItem | null {
  const content = timeline
    .filter((item) => item.type === "thinking" && item.detail)
    .map((item) => item.detail ?? "")
    .join("");
  if (!content.trim()) return null;
  return {
    type: "reasoning",
    id: `subagent-reasoning:${subagentId}`,
    summary: "思考",
    content: [{ text: content, truncated: false }],
  };
}

function toolItemsFromTimeline(
  timeline: TimelineItem[],
): WorkflowDynamicToolCallItem[] {
  const records = new Map<string, WorkflowDynamicToolCallItem>();
  for (const item of timeline) {
    if (
      item.type !== "tool_start" &&
      item.type !== "tool_delta" &&
      item.type !== "tool_result" &&
      item.type !== "error"
    ) {
      continue;
    }

    const existing = records.get(item.id);
    const toolName = item.toolName ?? existing?.tool ?? item.label;
    const status =
      item.type === "tool_result"
        ? item.isError
          ? "failed"
          : "completed"
        : item.status === "pending"
          ? "pending"
          : "running";
    const next: WorkflowDynamicToolCallItem = {
      type: "dynamicToolCall",
      id: item.id,
      tool: toolName,
      arguments: item.toolInput ?? existing?.arguments,
      status,
      success:
        status === "completed" ? true : status === "failed" ? false : undefined,
      output:
        item.detail || item.toolOutput
          ? {
              text:
                item.detail ??
                (typeof item.toolOutput === "string"
                  ? item.toolOutput
                  : JSON.stringify(item.toolOutput, null, 2)),
              truncated: false,
            }
          : existing?.output,
    };
    records.set(item.id, next);
  }
  return [...records.values()];
}

function StatusIcon({
  status,
}: {
  status: "creating" | "running" | "completed" | "failed";
}) {
  if (status === "completed") return <CheckCircle2 size={12} />;
  if (status === "failed") return <XCircle size={12} />;
  if (status === "running") {
    return <LoaderCircle size={12} className="animate-spin" />;
  }
  return <CircleDashed size={12} />;
}

function iconFromSeed(seed: string): LucideIcon {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return SUBAGENT_ICONS[hash % SUBAGENT_ICONS.length];
}

function subagentStatusToTurnStatus(
  status: ExecutionSubagentRecord["status"],
): WorkflowTurnStatus {
  if (status === "failed") return "failed";
  if (status === "completed") return "completed";
  return "running";
}
