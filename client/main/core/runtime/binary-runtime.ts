import type {
  AgentRuntime,
  Message,
  PermissionMode,
  RuntimeCapabilities,
  RuntimeEvent,
  Thread,
  ToolDefinition,
} from "@shared/agent-runtime";
import type { AgentSettings, ModelOption } from "@shared/types";
import { eventLog } from "../../codex/event-log";
import { codexService, type ThreadEvent } from "../../codex/service";
import { getAgentSettings } from "../../services/config-service";
import { resolveModelProvider } from "../config/model-provider";
import { configuredMcpTools } from "./mcp-tools";
import { configuredRuntimeModels } from "./runtime-models";
import { workflowThreadStore } from "./workflow-thread-store";

function genId(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Date.now();
}

function modelSnapshotFromSettings(): { modelId: string; modelName: string } {
  const modelProvider = resolveModelProvider(getAgentSettings());
  const modelId = modelProvider.selection.modelId || modelProvider.model;
  const model = modelProvider.provider?.models.find(
    (item) => item.id === modelId,
  );
  return {
    modelId,
    modelName: model?.label || modelId,
  };
}

const threads = new Map<string, Thread>();

function ensureThread(id: string): Thread {
  let thread = threads.get(id);
  if (!thread) {
    thread = {
      id,
      title: "New chat",
      messages: [],
      createdAt: now(),
      updatedAt: now(),
    };
    threads.set(id, thread);
  }
  return thread;
}

function pushMessage(threadId: string, message: Message): void {
  const thread = ensureThread(threadId);
  thread.messages.push(message);
  thread.updatedAt = now();
}

export class BinaryRuntime implements AgentRuntime {
  readonly name = "Binary";
  readonly capabilities: RuntimeCapabilities = {
    forkThread: true,
    interruptTurn: true,
    setModel: false,
    setPermissionMode: true,
    registerTool: false,
    cancelTool: false,
    editMessage: false,
    sandbox: true,
  };

  private turnToThread = new Map<string, string>();
  private permissionMode: PermissionMode = "default";

  async initialize(): Promise<void> {
    codexService.refreshProvider();
  }

  async destroy(): Promise<void> {
    codexService.removeAllListeners();
    eventLog.destroy();
  }

  async listThreads(): Promise<Thread[]> {
    return Array.from(threads.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  }

  async createThread(title?: string): Promise<Thread> {
    const thread: Thread = {
      id: genId(),
      title: title ?? "New chat",
      messages: [],
      createdAt: now(),
      updatedAt: now(),
    };
    threads.set(thread.id, thread);
    workflowThreadStore.ensureThread(thread.id, { title: thread.title });
    return thread;
  }

  async deleteThread(threadId: string): Promise<void> {
    threads.delete(threadId);
    workflowThreadStore.deleteThread(threadId);
    await codexService.closeSession(threadId);
  }

  async clearThread(threadId: string): Promise<void> {
    const thread = ensureThread(threadId);
    thread.messages = [];
    thread.updatedAt = now();
    workflowThreadStore.clearThread(threadId);
    await codexService.closeSession(threadId);
  }

  async forkThread(threadId: string, upToMessageId?: string): Promise<Thread> {
    const source = ensureThread(threadId);
    const endIndex = upToMessageId
      ? source.messages.findIndex((message) => message.id === upToMessageId)
      : -1;
    const messages =
      endIndex >= 0
        ? source.messages.slice(0, endIndex + 1)
        : [...source.messages];
    const forked: Thread = {
      id: genId(),
      title: `Forked: ${source.title}`,
      messages,
      createdAt: now(),
      updatedAt: now(),
    };
    threads.set(forked.id, forked);
    workflowThreadStore.cloneThread(threadId, forked.id, {
      title: forked.title,
      upToMessageId,
    });
    return forked;
  }

  async sendMessage(opts: {
    threadId: string;
    turnId?: string;
    content: string;
    displayContent?: string;
    cwd?: string;
    attachments?: unknown[];
    messageId?: string;
    runtimeThreadId?: string;
    settingsSnapshot?: AgentSettings;
  }): Promise<AsyncIterable<RuntimeEvent>> {
    const turnId = opts.turnId ?? genId();
    this.turnToThread.set(turnId, opts.threadId);
    const userMessageId = opts.messageId ?? genId();
    const displayContent = opts.displayContent ?? opts.content;
    pushMessage(opts.threadId, {
      id: userMessageId,
      role: "user",
      content: displayContent,
      timestamp: now(),
    });
    const modelSnapshot = modelSnapshotFromSettings();
    workflowThreadStore.startTurn({
      threadId: opts.threadId,
      turnId,
      content: displayContent,
      attachments: opts.attachments,
      userMessageId,
      startedAt: now(),
      cwd: opts.cwd ?? null,
      modelId: modelSnapshot.modelId,
      modelName: modelSnapshot.modelName,
    });

    const stream = async function* (
      this: BinaryRuntime,
    ): AsyncIterable<RuntimeEvent> {
      const startEvent: RuntimeEvent = {
        kind: "turn-start",
        payload: { turnId, timestamp: now() },
      };
      yield startEvent;
      const statusEvent: RuntimeEvent = {
        kind: "runtime-status",
        payload: {
          turnId,
          label: "Binary runtime",
          detail: `permission=${this.permissionMode}; cwd=${opts.cwd ?? process.cwd()}`,
          status: "running",
        },
      };
      workflowThreadStore.applyRuntimeEvent(opts.threadId, turnId, statusEvent);
      yield statusEvent;

      const queue: RuntimeEvent[] = [];
      let completed = false;
      let error: string | null = null;
      let assistantText = "";
      const wakeups: Array<() => void> = [];
      const wake = () => wakeups.splice(0).forEach((resolve) => resolve());

      const onEvent = (sessionId: string, event: ThreadEvent) => {
        if (sessionId !== opts.threadId) return;
        const converted = convertThreadEvent(turnId, event);
        for (const runtimeEvent of converted) {
          if (runtimeEvent.kind === "text-chunk")
            assistantText += runtimeEvent.payload.content;
          if (runtimeEvent.kind === "turn-complete") completed = true;
          workflowThreadStore.applyRuntimeEvent(
            opts.threadId,
            turnId,
            runtimeEvent,
          );
          queue.push(runtimeEvent);
        }
        wake();
      };
      const onError = (sessionId: string, message: string) => {
        if (sessionId !== opts.threadId) return;
        error = message;
        completed = true;
        const errorEvent: RuntimeEvent = {
          kind: "error",
          payload: {
            code: "BINARY_RUNTIME_ERROR",
            message,
            recoverable: false,
          },
        };
        const completeEvent: RuntimeEvent = {
          kind: "turn-complete",
          payload: { turnId, result: "error", error: message },
        };
        workflowThreadStore.applyRuntimeEvent(
          opts.threadId,
          turnId,
          errorEvent,
        );
        workflowThreadStore.applyRuntimeEvent(
          opts.threadId,
          turnId,
          completeEvent,
        );
        queue.push(errorEvent, completeEvent);
        wake();
      };

      codexService.onEvent(onEvent);
      codexService.onError(onError);
      void codexService
        .sendMessage(opts.threadId, opts.content)
        .catch((err) => {
          onError(
            opts.threadId,
            err instanceof Error ? err.message : String(err),
          );
        });

      while (!completed || queue.length > 0) {
        const next = queue.shift();
        if (next) {
          yield next;
          continue;
        }
        await new Promise<void>((resolve) => wakeups.push(resolve));
      }

      if (assistantText.trim()) {
        pushMessage(opts.threadId, {
          id: genId(),
          role: "assistant",
          content: assistantText,
          timestamp: now(),
        });
      }
      if (error) return;
    }.bind(this);

    return stream();
  }

  async interruptTurn(turnId: string): Promise<void> {
    const threadId = this.turnToThread.get(turnId);
    if (threadId) await codexService.abortSession(threadId);
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.permissionMode = mode;
  }

  async getAvailableModels(): Promise<ModelOption[]> {
    return configuredRuntimeModels();
  }

  async listTools(): Promise<ToolDefinition[]> {
    return configuredMcpTools();
  }

  async readThread(
    input: import("@shared/workflow-thread-data-source").WorkflowReadThreadInput,
  ) {
    return workflowThreadStore.readThread(input);
  }

  subscribeThread(
    input: import("@shared/workflow-thread-data-source").WorkflowSubscribeThreadInput,
  ) {
    return workflowThreadStore.subscribeThread(input);
  }

  respondApproval(
    requestId: string,
    approved: boolean,
    _scope: "once" | "session" = "once",
    reason?: string,
  ): void {
    for (const threadId of this.turnToThread.values()) {
      void codexService.respondToApproval(
        threadId,
        requestId,
        approved ? "approve" : "deny",
        reason,
      );
    }
  }
}

function convertThreadEvent(
  turnId: string,
  event: ThreadEvent,
): RuntimeEvent[] {
  if (event.type === "turn.completed") {
    return [{ kind: "turn-complete", payload: { turnId, result: "success" } }];
  }
  if (event.type === "turn.failed") {
    const message = event.error?.message ?? "Binary runtime failed";
    return [
      {
        kind: "error",
        payload: {
          code: "BINARY_TURN_FAILED",
          message,
          recoverable: Boolean(event.error?.recoverable),
        },
      },
      {
        kind: "turn-complete",
        payload: { turnId, result: "error", error: message },
      },
    ];
  }
  if (event.type === "approval_requested" && event.approval) {
    return [
      {
        kind: "approval-request",
        payload: {
          requestId: event.approval.id,
          toolName: event.approval.tool,
          reason: JSON.stringify(event.approval.toolInput ?? {}),
          timeout: 120_000,
        },
      },
    ];
  }
  if (!event.item) return [];

  if (event.item.type === "agent_message" && event.item.text) {
    return [
      { kind: "text-chunk", payload: { turnId, content: event.item.text } },
    ];
  }
  if (event.item.type === "reasoning" && event.item.text) {
    return [
      { kind: "thinking-chunk", payload: { turnId, content: event.item.text } },
    ];
  }
  if (event.type === "item.started" && event.item.type === "mcp_tool_call") {
    return [
      {
        kind: "tool-start",
        payload: {
          turnId,
          toolId: event.item.id,
          toolName: event.item.tool ?? "tool",
          input: event.item.args ?? event.item.arguments ?? {},
        },
      },
    ];
  }
  if (event.type === "item.completed" && event.item.type === "mcp_tool_call") {
    return [
      {
        kind: "tool-complete",
        payload: {
          turnId,
          toolId: event.item.id,
          output: event.item.result ?? "",
          isError: event.item.status === "error",
        },
      },
    ];
  }
  if (event.item.type === "error") {
    const message =
      event.item.message ??
      event.item.error?.message ??
      "Binary runtime item error";
    return [
      {
        kind: "error",
        payload: { code: "BINARY_ITEM_ERROR", message, recoverable: true },
      },
    ];
  }
  return [];
}
