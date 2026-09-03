import { CodexTransport } from "./transport/connection";
import { JsonRpcClient } from "./transport/jsonrpc-client";
import { log } from "../logger";
import {
  ClientMethods,
  ServerNotifications,
  type InitializeParams,
  type InitializeResult,
  type ThreadStartResult,
} from "./transport/types";
import { normalizeCodexItem, type NormalizedThreadItem } from "./normalize";

export type SessionEvent =
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "initialized" }
  | { type: "thread_started"; threadId: string }
  | { type: "thread_resumed"; threadId: string }
  | { type: "thread_forked"; threadId: string; sourceThreadId: string }
  | { type: "turn_started" }
  | {
      type: "turn_step_failed";
      stepIndex: number;
      stepType: string;
      error: string;
    }
  | {
      type: "context_compacted";
      originalTokens: number;
      compactedTokens: number;
    }
  | { type: "raw_event"; event: CodexRawEvent }
  | { type: "assistant_message"; content: string }
  | { type: "tool_call"; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; tool: string; result: unknown }
  | {
      type: "item_event";
      phase: "started" | "updated" | "completed";
      item: NormalizedThreadItem;
    }
  | { type: "turn_completed" }
  | {
      type: "approval_requested";
      id: string;
      tool: string;
      toolInput: Record<string, unknown>;
      threadId: string;
      cwd?: string;
      allowSession: boolean;
    }
  | { type: "error"; message: string };

export interface CodexRawEvent {
  method: string;
  params: unknown;
  receivedAt: number;
}

type EventCallback = (event: SessionEvent) => void;
type StatusCallback = (status: string) => void;

// Raw notification from Codex CLI
type RawNotification = CodexRawEvent;

type PendingCodexApproval =
  | { kind: "legacy" }
  | {
      kind: "server-request";
      requestId: string | number;
      method: string;
      requestedPermissions?: Record<string, unknown>;
    };

export interface ThreadStartOptions {
  cwd?: string;
  approvalPolicy?: string;
  permissions?: string;
  config?: Record<string, unknown>;
}

export class CodexAppServerSession {
  private readonly sessionId: string;
  private readonly transport: CodexTransport;
  private readonly rpc: JsonRpcClient;
  private readonly threadStartOptions: ThreadStartOptions;
  private threadId: string | null = null;
  private eventListeners: EventCallback[] = [];
  private statusListeners: StatusCallback[] = [];
  private notificationQueue: RawNotification[] = [];
  private notificationWaiters: Array<() => void> = [];
  private started = false;
  private pendingApprovals = new Map<string, PendingCodexApproval>();

  constructor(
    sessionId: string,
    rpc: JsonRpcClient,
    transport: CodexTransport,
    threadStartOptions: ThreadStartOptions = {},
  ) {
    this.sessionId = sessionId;
    this.rpc = rpc;
    this.transport = transport;
    this.threadStartOptions = threadStartOptions;
  }

  async start(): Promise<void> {
    if (this.started) return;

    this.transport.onNotification((method, params) => {
      this.handleNotification(method, params);
    });
    this.transport.onServerRequest((id, method, params) => {
      this.handleServerRequest(id, method, params);
    });

    await this.transport.start();

    const initParams: InitializeParams = {
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
      clientInfo: {
        name: "marloues",
        title: "Marloues",
        version: "0.2.0",
      },
    };

    const initResult = await this.rpc.request<InitializeResult>(
      ClientMethods.Initialize,
      initParams,
    );

    log("[session] initialize result:", JSON.stringify(initResult));

    if (!initResult) {
      throw new Error("Codex initialization failed: no result");
    }

    this.rpc.notify(ServerNotifications.Initialized, {});

    this.started = true;
    this.emit({ type: "initialized" });
  }

  async send(prompt: string): Promise<void> {
    log(
      "[session] send() called, threadId=",
      this.threadId,
      "prompt=",
      prompt.slice(0, 50),
    );

    if (!this.threadId) {
      log("[session] calling thread/start (no message)");
      const opts = this.threadStartOptions;
      const result = await this.rpc.request<ThreadStartResult>(
        ClientMethods.ThreadStart,
        {
          cwd: opts.cwd || process.cwd(),
          approvalPolicy: opts.approvalPolicy || "on-request",
          permissions: opts.permissions || ":read-only",
          config: opts.config,
        },
      );
      log("[session] thread/start result threadId=", result.thread?.id);
      this.threadId = result.thread.id;
      this.emit({ type: "thread_started", threadId: result.thread.id });
    }

    log("[session] calling turn/start threadId=", this.threadId);
    const turnResult = await this.rpc.request(ClientMethods.TurnStart, {
      threadId: this.threadId,
      input: [{ type: "text", text: prompt }],
    });
    log("[session] turn/start result=", JSON.stringify(turnResult));

    this.emit({ type: "turn_started" });
    log("[session] waiting for turn to complete...");
    await this.streamUntilTurnComplete();
    log("[session] turn complete");
  }

  async close(): Promise<void> {
    await this.transport.stop();
    this.emit({ type: "disconnected" });
  }

  async interrupt(): Promise<void> {
    if (!this.threadId || !this.rpc.isOpen()) return;
    await this.rpc.request(ClientMethods.TurnInterrupt, {
      threadId: this.threadId,
    });
  }

  async setSkillExtraRoots(extraRoots: string[]): Promise<void> {
    if (!this.started) {
      throw new Error(
        "Codex session must be initialized before setting Skill roots",
      );
    }
    await this.rpc.request("skills/extraRoots/set", { extraRoots });
  }

  async respondToApproval(
    approvalId: string,
    decision: "approve" | "deny",
    scope: "once" | "session" = "once",
    reason?: string,
  ): Promise<void> {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) {
      throw new Error(`Unknown Codex approval request: ${approvalId}`);
    }
    this.pendingApprovals.delete(approvalId);
    if (pending.kind === "legacy") {
      await this.rpc.request("approval/respond", {
        id: approvalId,
        decision,
        reason,
      });
      return;
    }
    if (pending.method === "item/permissions/requestApproval") {
      this.rpc.respond(pending.requestId, {
        permissions:
          decision === "approve" ? (pending.requestedPermissions ?? {}) : {},
        scope:
          decision === "approve" && scope === "session" ? "session" : "turn",
      });
      return;
    }
    this.rpc.respond(pending.requestId, {
      decision:
        decision === "deny"
          ? "decline"
          : scope === "session"
            ? "acceptForSession"
            : "accept",
    });
  }

  async resume(threadId: string, cwd?: string): Promise<void> {
    log("[session] resume() called, threadId=", threadId);
    const result = await this.rpc.request<{ thread: { id: string } }>(
      ClientMethods.ThreadResume,
      {
        threadId,
        cwd: cwd || process.cwd(),
        permissions: this.threadStartOptions.permissions || ":read-only",
        config: this.threadStartOptions.config,
      },
    );
    log("[session] thread/resume result threadId=", result.thread?.id);
    this.threadId = result.thread?.id || threadId;
    this.emit({ type: "thread_resumed", threadId: this.threadId });
  }

  async fork(sourceThreadId: string, cwd?: string): Promise<string> {
    log("[session] fork() called, sourceThreadId=", sourceThreadId);
    const result = await this.rpc.request<{ thread: { id: string } }>(
      ClientMethods.ThreadFork,
      {
        sourceThreadId,
        cwd: cwd || process.cwd(),
        permissions: this.threadStartOptions.permissions || ":read-only",
        config: this.threadStartOptions.config,
      },
    );
    const newThreadId = result.thread?.id;
    log("[session] thread/fork result newThreadId=", newThreadId);
    if (newThreadId) {
      this.threadId = newThreadId;
      this.emit({
        type: "thread_forked",
        threadId: newThreadId,
        sourceThreadId,
      });
    }
    return newThreadId || "";
  }

  onEvent(callback: EventCallback): void {
    this.eventListeners.push(callback);
  }

  onStatus(callback: StatusCallback): void {
    this.statusListeners.push(callback);
  }

  private async streamUntilTurnComplete(): Promise<void> {
    const agentMessages = new Map<string, string>(); // itemId -> accumulated text

    while (true) {
      const notif = await this.waitForNotification();
      const method = notif.method;
      const params = notif.params as Record<string, unknown>;
      this.emit({ type: "raw_event", event: notif });

      if (method === "turn/completed") {
        const turn = asRecord(params?.turn);
        if (turn.status === "failed") {
          this.emit({
            type: "error",
            message: extractErrorMessage(turn, "Turn failed"),
          });
          break;
        }
        await this.probeCompletedTurnItems(params);
        this.emit({ type: "turn_completed" });
        break;
      }

      if (method === "turn/failed") {
        const err =
          ((params?.error as Record<string, unknown>)?.message as string) ||
          "Turn failed";
        const failedStep = params?.failedStep as
          Record<string, unknown> | undefined;
        if (failedStep) {
          const stepIndex = (failedStep.index as number) || 0;
          const stepType = (failedStep.type as string) || "unknown";
          this.emit({
            type: "turn_step_failed",
            stepIndex,
            stepType,
            error: err,
          });
        }
        this.emit({ type: "error", message: err });
        break;
      }

      // Streaming text delta from agentMessage
      if (method === "item/agentMessage/delta") {
        const delta = (params?.delta as string) || "";
        const itemId = (params?.itemId as string) || "";
        if (delta && itemId) {
          const prev = agentMessages.get(itemId) || "";
          const fullText = prev + delta;
          agentMessages.set(itemId, fullText);
          this.emit({
            type: "item_event",
            phase: "updated",
            item: {
              id: itemId,
              type: "agent_message",
              rawType: "agentMessage",
              phase: "updated",
              text: fullText,
              status: "in_progress",
              rawItem: params,
            },
          });
          this.emit({ type: "assistant_message", content: fullText });
        }
        continue;
      }

      if (
        method === "item/started" ||
        method === "item/updated" ||
        method === "item/completed"
      ) {
        const item = params?.item as Record<string, unknown> | undefined;
        if (!item) continue;

        const itemType = item.type as string;
        const phase =
          method === "item/started"
            ? "started"
            : method === "item/updated"
              ? "updated"
              : "completed";
        const normalized = normalizeItem(item, params, phase);
        if (normalized) {
          this.emit({ type: "item_event", phase, item: normalized });
        }

        if (itemType === "agentMessage") {
          const text = (item.text as string) || "";
          if (method === "item/completed" && text) {
            // Emit full text including think tags
            this.emit({ type: "assistant_message", content: text });
          }
        } else if (
          itemType === "toolCall" ||
          itemType === "functionCall" ||
          itemType === "mcpToolCall"
        ) {
          const toolName = (item.name as string) || (item.tool as string) || "";
          const args = (item.arguments as Record<string, unknown>) || {};
          if (method === "item/started") {
            this.emit({ type: "tool_call", tool: toolName, args });
          } else if (method === "item/completed") {
            this.emit({
              type: "tool_result",
              tool: toolName,
              result: item.output,
            });
          }
        }
      }

      if (method === "error") {
        const msg = extractErrorMessage(params, "Unknown error");
        this.emit({ type: "error", message: msg });
        break;
      }

      if (method === "context/compacted" || method === "context_compacted") {
        const originalTokens = (params?.originalTokens as number) || 0;
        const compactedTokens = (params?.compactedTokens as number) || 0;
        this.emit({
          type: "context_compacted",
          originalTokens,
          compactedTokens,
        });
      }

      if (method === "approval/request" || method === "approval_request") {
        const id = (params?.id as string) || "";
        const tool = (params?.tool as string) || (params?.name as string) || "";
        const toolInput =
          (params?.toolInput as Record<string, unknown>) ||
          (params?.input as Record<string, unknown>) ||
          {};
        const cwd = params?.cwd as string | undefined;
        this.pendingApprovals.set(id, { kind: "legacy" });
        this.emit({
          type: "approval_requested",
          id,
          tool,
          toolInput,
          threadId: this.threadId || "",
          cwd,
          allowSession: false,
        });
      }
    }
  }

  private async waitForNotification(): Promise<RawNotification> {
    if (this.notificationQueue.length > 0) {
      return this.notificationQueue.shift()!;
    }
    return new Promise((resolve) => {
      this.notificationWaiters.push(() => {
        resolve(this.notificationQueue.shift()!);
      });
    });
  }

  private handleNotification(method: string, params: unknown): void {
    log(
      "[session] notification received method=",
      method,
      "params=",
      JSON.stringify(params),
    );
    this.notificationQueue.push({ method, params, receivedAt: Date.now() });

    while (this.notificationWaiters.length > 0) {
      const waiter = this.notificationWaiters.shift()!;
      waiter();
    }
  }

  private handleServerRequest(
    requestId: string | number,
    method: string,
    value: unknown,
  ): void {
    const params = asRecord(value);
    if (
      method !== "item/commandExecution/requestApproval" &&
      method !== "item/fileChange/requestApproval" &&
      method !== "item/permissions/requestApproval"
    ) {
      this.rpc.respondError(
        requestId,
        -32601,
        `Unsupported Codex server request: ${method}`,
      );
      return;
    }

    const approvalId = `codex-${this.sessionId}-${String(requestId)}`;
    const availableDecisions = Array.isArray(params.availableDecisions)
      ? params.availableDecisions
      : undefined;
    log(
      "[session] approval capabilities:",
      JSON.stringify({
        method,
        availableDecisions,
        hasProposedExecpolicyAmendment:
          Object.keys(asRecord(params.proposedExecpolicyAmendment)).length > 0,
      }),
    );
    const allowSession =
      method === "item/permissions/requestApproval" ||
      !availableDecisions ||
      availableDecisions.includes("acceptForSession");
    const requestedPermissions = asRecord(params.permissions);
    this.pendingApprovals.set(approvalId, {
      kind: "server-request",
      requestId,
      method,
      ...(method === "item/permissions/requestApproval"
        ? { requestedPermissions }
        : {}),
    });
    this.emit({
      type: "approval_requested",
      id: approvalId,
      tool:
        method === "item/commandExecution/requestApproval"
          ? "Bash"
          : method === "item/fileChange/requestApproval"
            ? "Write"
            : "Permissions",
      toolInput: params,
      threadId:
        typeof params.threadId === "string"
          ? params.threadId
          : this.threadId || "",
      cwd: typeof params.cwd === "string" ? params.cwd : undefined,
      allowSession,
    });
  }

  private emit(event: SessionEvent): void {
    this.eventListeners.forEach((cb) => cb(event));
  }

  private async probeCompletedTurnItems(
    _params: Record<string, unknown>,
  ): Promise<void> {
    if (!this.threadId) return;

    const attempts: Array<{ method: string; params: Record<string, unknown> }> =
      [];

    attempts.push({
      method: "thread/turns/list",
      params: {
        threadId: this.threadId,
        limit: 1,
        sortDirection: "desc",
        itemsView: "full",
      },
    });

    for (const attempt of attempts) {
      try {
        const result = await withTimeout(
          this.rpc.request(attempt.method, attempt.params),
          4000,
        );
        this.emit({
          type: "raw_event",
          event: {
            method: `${attempt.method}/result`,
            params: {
              request: attempt.params,
              result,
            },
            receivedAt: Date.now(),
          },
        });
        return;
      } catch (err) {
        log(
          "[session] turn items probe failed:",
          attempt.method,
          JSON.stringify(attempt.params),
          err,
        );
      }
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function normalizeItem(
  item: Record<string, unknown>,
  params: Record<string, unknown>,
  phase: "started" | "updated" | "completed",
): NormalizedThreadItem | null {
  return normalizeCodexItem(item, params, phase);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function extractErrorMessage(
  value: Record<string, unknown>,
  fallback: string,
): string {
  if (typeof value.message === "string" && value.message) {
    return value.message;
  }
  const error = asRecord(value.error);
  return typeof error.message === "string" && error.message
    ? error.message
    : fallback;
}
