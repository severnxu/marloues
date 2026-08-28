import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
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
import { configuredMcpTools } from "./mcp-tools";
import { getAgentSettings } from "../../services/config-service";
import { ToolStormBreaker, type ToolStormDecision } from "./tool-storm-breaker";
import {
  createRuntimeSecurityHost,
  type SecurityDecision,
  type SecurityHost,
} from "../security/security-host";
import type { SecurityOperation } from "../security/operation-factory";
import type { SecurityPermit } from "../security/sandbox-broker";
import type { SandboxProfile } from "../security/sandbox-broker";
import {
  guardianReviewDetail,
  runGuardianReview,
} from "../security/guardian-reviewer";
import { validatePathBoundary } from "../permissions/path-boundary-validator";
import { terminalService } from "../../services/terminal-service";
import { cdpBrowserService } from "../../services/cdp-browser-service";

function genId(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Date.now();
}

const threads = new Map<string, Thread>();
const APPROVAL_TIMEOUT_MS = 120_000;
const MAX_READ_BYTES = 512 * 1024;

function ensureThread(id: string): Thread {
  let thread = threads.get(id);
  if (!thread) {
    thread = {
      id,
      title: "新对话",
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

export class SelfBuiltRuntime implements AgentRuntime {
  readonly name = "Self-built";
  readonly capabilities: RuntimeCapabilities = {
    forkThread: true,
    interruptTurn: true,
    setModel: true,
    setPermissionMode: true,
    registerTool: true,
    cancelTool: true,
    editMessage: true,
    sandbox: true,
  };

  private abortedTurns = new Set<string>();
  private modelId = "local-loop";
  private permissionMode: PermissionMode = "default";
  private tools = new Map<string, ToolDefinition>();
  private handlers = new Map<string, (args: unknown) => Promise<unknown>>();
  private cancelledTools = new Set<string>();
  private pendingApprovals = new Map<
    string,
    {
      toolName: string;
      operation?: SecurityOperation;
      elevationProfile?: SandboxProfile;
      resolve: (approved: boolean) => void;
    }
  >();
  private undoStack: Array<{
    cwd: string;
    filePath: string;
    previousContent: string | null;
  }> = [];
  private toolStormBreaker = new ToolStormBreaker();
  private securityHost: SecurityHost = createRuntimeSecurityHost("self-built");

  async initialize(): Promise<void> {
    this.registerBuiltinTools();
  }

  async destroy(): Promise<void> {
    this.abortedTurns.clear();
    this.cancelledTools.clear();
    this.resolvePendingApprovals(false);
    this.securityHost.clearGrants();
  }

  async listThreads(): Promise<Thread[]> {
    return Array.from(threads.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  }

  async createThread(title?: string): Promise<Thread> {
    const thread: Thread = {
      id: genId(),
      title: title ?? "新对话",
      messages: [],
      createdAt: now(),
      updatedAt: now(),
    };
    threads.set(thread.id, thread);
    return thread;
  }

  async deleteThread(threadId: string): Promise<void> {
    threads.delete(threadId);
  }

  async clearThread(threadId: string): Promise<void> {
    const thread = ensureThread(threadId);
    thread.messages = [];
    thread.updatedAt = now();
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
    const thread: Thread = {
      id: genId(),
      title: `Forked: ${source.title}`,
      messages,
      createdAt: now(),
      updatedAt: now(),
    };
    threads.set(thread.id, thread);
    return thread;
  }

  async truncateThread(
    threadId: string,
    opts: { fromMessageId: string; includeMessage?: boolean },
  ): Promise<Thread> {
    const thread = ensureThread(threadId);
    const index = thread.messages.findIndex(
      (message) => message.id === opts.fromMessageId,
    );
    if (index < 0) throw new Error(`Message not found: ${opts.fromMessageId}`);
    const end = opts.includeMessage ? index + 1 : index;
    thread.messages = thread.messages.slice(0, end);
    thread.updatedAt = now();
    return thread;
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
    this.abortedTurns.delete(turnId);
    this.toolStormBreaker.resetTurn(turnId);
    const displayContent = opts.displayContent ?? opts.content;
    pushMessage(opts.threadId, {
      id: opts.messageId ?? genId(),
      role: "user",
      content: displayContent,
      timestamp: now(),
    });

    const stream = async function* (
      this: SelfBuiltRuntime,
    ): AsyncIterable<RuntimeEvent> {
      yield { kind: "turn-start", payload: { turnId, timestamp: now() } };
      yield {
        kind: "runtime-status",
        payload: {
          turnId,
          label: "Self-built loop",
          detail: `model=${this.modelId}; permission=${this.permissionMode}; cwd=${opts.cwd ?? process.cwd()}`,
          status: "running",
        },
      };

      const plan = this.planTurn(opts.content);
      yield {
        kind: "thinking-chunk",
        payload: {
          turnId,
          content: formatPlan(plan),
        },
      };

      const loopResult = yield* this.executePlan(turnId, plan, opts);
      if (loopResult.done) {
        if (loopResult.assistantText) {
          for (const chunk of splitChunks(loopResult.assistantText, 24)) {
            if (this.abortedTurns.has(turnId)) {
              yield {
                kind: "turn-complete",
                payload: { turnId, result: "aborted" },
              };
              return;
            }
            yield { kind: "text-chunk", payload: { turnId, content: chunk } };
            await new Promise((resolve) => setTimeout(resolve, 8));
          }
          pushMessage(opts.threadId, {
            id: genId(),
            role: "assistant",
            content: loopResult.assistantText,
            timestamp: now(),
          });
        }
        yield {
          kind: "token-usage",
          payload: {
            turnId,
            usage: estimateTokenUsage(opts.content, loopResult.assistantText),
          },
        };
        yield {
          kind: "turn-complete",
          payload: {
            turnId,
            result: loopResult.result,
            error: loopResult.error,
          },
        };
        return;
      }

      if (this.shouldRequestApproval(opts.content)) {
        const toolName = "self-built.sensitive-write";
        const input = {
          action: "simulate-sensitive-write",
          prompt: opts.content,
        };
        const storm = this.checkToolStorm(turnId, toolName, input);
        if (storm.action === "deny") {
          const message = storm.message ?? "Repeated tool call blocked.";
          yield {
            kind: "error",
            payload: { code: "TOOL_STORM_BLOCKED", message, recoverable: true },
          };
          yield {
            kind: "turn-complete",
            payload: { turnId, result: "error", error: message },
          };
          return;
        }
        const decision = this.evaluateSecurity({
          toolName,
          input,
          cwd: opts.cwd ?? process.cwd(),
          threadId: opts.threadId,
          turnId,
        });
        const authorization = yield* this.authorizeDecision(
          turnId,
          toolName,
          decision,
          {
            toolStorm: storm.action === "warn" ? storm.message : undefined,
            action: "simulate-sensitive-write",
          },
          opts.content,
        );
        if (this.abortedTurns.has(turnId)) {
          yield {
            kind: "turn-complete",
            payload: { turnId, result: "aborted" },
          };
          return;
        }
        if (!authorization.allowed) {
          const message = authorization.reason;
          yield {
            kind: "error",
            payload: {
              code: "TOOL_APPROVAL_DENIED",
              message,
              recoverable: true,
            },
          };
          yield {
            kind: "turn-complete",
            payload: { turnId, result: "error", error: message },
          };
          return;
        }
        const toolId = `tool-${turnId}`;
        this.cancelledTools.delete(toolId);
        yield {
          kind: "tool-start",
          payload: { turnId, toolId, toolName, input },
        };
        for (let step = 1; step <= 5; step += 1) {
          if (
            this.cancelledTools.has(toolId) ||
            this.abortedTurns.has(turnId)
          ) {
            this.cancelledTools.delete(toolId);
            yield {
              kind: "tool-complete",
              payload: {
                turnId,
                toolId,
                output: "Tool execution cancelled.",
                isError: true,
              },
            };
            yield {
              kind: "turn-complete",
              payload: { turnId, result: "aborted" },
            };
            return;
          }
          yield {
            kind: "tool-progress",
            payload: {
              turnId,
              toolId,
              toolName,
              input,
              partialInput: `step ${step}/5`,
              isReady: step === 5,
            },
          };
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        yield {
          kind: "tool-complete",
          payload: {
            turnId,
            toolId,
            output: "Sensitive tool execution approved.",
            isError: false,
          },
        };
      }

      const response = this.composeResponse(opts.content, opts.cwd, plan);
      let emitted = "";
      for (const chunk of splitChunks(response, 24)) {
        if (this.abortedTurns.has(turnId)) {
          yield {
            kind: "turn-complete",
            payload: { turnId, result: "aborted" },
          };
          return;
        }
        emitted += chunk;
        yield { kind: "text-chunk", payload: { turnId, content: chunk } };
        await new Promise((resolve) => setTimeout(resolve, 8));
      }

      pushMessage(opts.threadId, {
        id: genId(),
        role: "assistant",
        content: emitted,
        timestamp: now(),
      });
      yield {
        kind: "token-usage",
        payload: {
          turnId,
          usage: estimateTokenUsage(opts.content, emitted),
        },
      };
      yield { kind: "turn-complete", payload: { turnId, result: "success" } };
    }.bind(this);

    return stream();
  }

  async interruptTurn(turnId: string): Promise<void> {
    this.abortedTurns.add(turnId);
  }

  async cancelTool(toolCallId: string): Promise<void> {
    this.cancelledTools.add(toolCallId);
  }

  async setModel(modelId: string): Promise<void> {
    this.modelId = modelId || "local-loop";
  }

  async getAvailableModels(): Promise<ModelOption[]> {
    return [{ id: "local-loop", label: "Local Loop", enabled: true }];
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.permissionMode = mode;
  }

  registerTool(
    tool: ToolDefinition,
    handler: (args: unknown) => Promise<unknown>,
  ): void {
    this.tools.set(tool.name, tool);
    this.handlers.set(tool.name, handler);
  }

  async listTools(): Promise<ToolDefinition[]> {
    const byName = new Map<string, ToolDefinition>();
    for (const tool of configuredMcpTools()) byName.set(tool.name, tool);
    for (const tool of this.tools.values()) byName.set(tool.name, tool);
    return Array.from(byName.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  respondApproval(
    requestId: string,
    approved: boolean,
    scope: "once" | "session",
    _reason?: string,
  ): void {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return;
    this.pendingApprovals.delete(requestId);
    if (approved && scope === "session" && pending.operation) {
      this.securityHost.createGrant({
        operation: pending.operation,
        scope: "session",
        sourceRequestId: requestId,
        elevationProfile: pending.elevationProfile,
      });
    }
    pending.resolve(approved);
  }

  private registerBuiltinTools(): void {
    if (this.tools.has("terminal.exec")) return;
    this.registerTool(
      {
        name: "memory.echo",
        description:
          "Echoes input through the self-built runtime tool registry.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string" },
          },
        },
      },
      async (args) => args,
    );
    // Terminal tools (metadata for listTools; execution is inline in executePlan)
    this.registerTool(
      {
        name: "terminal.exec",
        description:
          "Start an interactive PTY session and run a command. Returns sessionId and initial output.",
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string" },
            cwd: { type: "string" },
          },
          required: ["command"],
        },
      },
      async (args) => args,
    );
    this.registerTool(
      {
        name: "terminal.write",
        description: "Write data to an active PTY session's stdin.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            data: { type: "string" },
          },
          required: ["sessionId", "data"],
        },
      },
      async (args) => args,
    );
    this.registerTool(
      {
        name: "terminal.read",
        description: "Read incremental output from an active PTY session.",
        inputSchema: {
          type: "object",
          properties: { sessionId: { type: "string" } },
          required: ["sessionId"],
        },
      },
      async (args) => args,
    );
    // Browser tools
    this.registerTool(
      {
        name: "browser.navigate",
        description: "Navigate to a URL in the browser.",
        inputSchema: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"],
        },
      },
      async (args) => args,
    );
    this.registerTool(
      {
        name: "browser.screenshot",
        description: "Take a screenshot of the current browser page.",
        inputSchema: {
          type: "object",
          properties: {
            pageId: { type: "string" },
          },
        },
      },
      async (args) => args,
    );
    this.registerTool(
      {
        name: "browser.click",
        description:
          "Click an interactive element by its index from get_state.",
        inputSchema: {
          type: "object",
          properties: {
            index: { type: "number" },
            pageId: { type: "string" },
          },
          required: ["index"],
        },
      },
      async (args) => args,
    );
    this.registerTool(
      {
        name: "browser.fill",
        description: "Fill text into an element by its index from get_state.",
        inputSchema: {
          type: "object",
          properties: {
            index: { type: "number" },
            value: { type: "string" },
            pageId: { type: "string" },
          },
          required: ["index", "value"],
        },
      },
      async (args) => args,
    );
    this.registerTool(
      {
        name: "browser.get_state",
        description:
          "Get the accessibility tree of the current page as indexed text.",
        inputSchema: {
          type: "object",
          properties: {
            pageId: { type: "string" },
          },
        },
      },
      async (args) => args,
    );
    this.registerTool(
      {
        name: "browser.scroll",
        description: "Scroll the page in a direction (up, down, left, right).",
        inputSchema: {
          type: "object",
          properties: {
            direction: { type: "string" },
            pages: { type: "number" },
            pageId: { type: "string" },
          },
          required: ["direction"],
        },
      },
      async (args) => args,
    );
    this.registerTool(
      {
        name: "browser.poll_events",
        description: "Poll for browser events since a sequence cursor.",
        inputSchema: {
          type: "object",
          properties: {
            afterSequence: { type: "number" },
            limit: { type: "number" },
            pageId: { type: "string" },
          },
        },
      },
      async (args) => args,
    );
  }

  private planTurn(content: string): SelfBuiltPlan {
    const trimmed = content.trim();
    if (/^\/list(?:\s+|$)/i.test(trimmed)) {
      return {
        intent: "list",
        targetPath: trimmed.replace(/^\/list\s*/i, "").trim() || ".",
      };
    }
    if (/^\/read(?:\s+|$)/i.test(trimmed)) {
      return {
        intent: "read",
        targetPath: trimmed.replace(/^\/read\s*/i, "").trim() || ".",
      };
    }
    if (/^\/patch(?:\s+|$)/i.test(trimmed)) {
      const body = trimmed.replace(/^\/patch\s*/i, "");
      const newline = body.indexOf("\n");
      const targetPath = (newline >= 0 ? body.slice(0, newline) : body).trim();
      const content = newline >= 0 ? body.slice(newline + 1) : "";
      return { intent: "patch", targetPath, content };
    }
    if (/^\/undo\b/i.test(trimmed)) {
      return { intent: "undo" };
    }
    if (/^\/term(?:\s+|$)/i.test(trimmed)) {
      const command = trimmed.replace(/^\/term\s*/i, "").trim();
      return { intent: "terminal", command };
    }
    if (/^\/browse(?:\s+|$)/i.test(trimmed)) {
      const url = trimmed.replace(/^\/browse\s*/i, "").trim();
      return { intent: "browser", url };
    }
    return { intent: "respond" };
  }

  private async *executePlan(
    turnId: string,
    plan: SelfBuiltPlan,
    opts: {
      threadId: string;
      turnId?: string;
      content: string;
      cwd?: string;
      attachments?: unknown[];
      messageId?: string;
    },
  ): AsyncGenerator<RuntimeEvent, SelfBuiltLoopResult> {
    if (plan.intent === "respond")
      return { done: false, result: "success", assistantText: "" };
    const cwd = opts.cwd ?? process.cwd();
    try {
      if (plan.intent === "list") {
        const toolId = `tool-${turnId}-list`;
        const toolName = "self-built.fs.list";
        const input = { path: plan.targetPath };
        const decision = this.evaluateSecurity({
          toolName,
          input,
          cwd,
          threadId: opts.threadId,
          turnId,
        });
        const authorization = yield* this.authorizeDecision(
          turnId,
          toolName,
          decision,
          { action: "list", path: plan.targetPath },
          opts.content,
        );
        if (!authorization.allowed) {
          const message = authorization.reason;
          yield {
            kind: "error",
            payload: {
              code: "TOOL_PERMISSION_DENIED",
              message,
              recoverable: true,
            },
          };
          return {
            done: true,
            result: "error",
            error: message,
            assistantText: message,
          };
        }
        const authorizedPath = requireBrokeredFilePermit(
          decision.operation,
          authorization.permit,
          "read",
        );
        const assistantText = yield* this.runToolAsText(
          turnId,
          toolId,
          toolName,
          input,
          () => this.listWorkspaceDir(cwd, authorizedPath),
        );
        return { done: true, result: "success", assistantText };
      }
      if (plan.intent === "read") {
        const toolId = `tool-${turnId}-read`;
        const toolName = "self-built.fs.read";
        const input = { path: plan.targetPath };
        const decision = this.evaluateSecurity({
          toolName,
          input,
          cwd,
          threadId: opts.threadId,
          turnId,
        });
        const authorization = yield* this.authorizeDecision(
          turnId,
          toolName,
          decision,
          { action: "read", path: plan.targetPath },
          opts.content,
        );
        if (!authorization.allowed) {
          const message = authorization.reason;
          yield {
            kind: "error",
            payload: {
              code: "TOOL_PERMISSION_DENIED",
              message,
              recoverable: true,
            },
          };
          return {
            done: true,
            result: "error",
            error: message,
            assistantText: message,
          };
        }
        const authorizedPath = requireBrokeredFilePermit(
          decision.operation,
          authorization.permit,
          "read",
        );
        const assistantText = yield* this.runToolAsText(
          turnId,
          toolId,
          toolName,
          input,
          () => this.readWorkspaceFile(cwd, authorizedPath),
        );
        return { done: true, result: "success", assistantText };
      }
      if (plan.intent === "patch") {
        if (!plan.targetPath)
          throw new Error("Usage: /patch <relative-file-path>\\n<content>");
        const toolName = "self-built.fs.patch";
        const patchInput = {
          path: plan.targetPath,
          bytes: Buffer.byteLength(plan.content, "utf-8"),
        };
        const storm = this.checkToolStorm(turnId, toolName, patchInput);
        if (storm.action === "deny") {
          const message = storm.message ?? "Repeated tool call blocked.";
          yield {
            kind: "error",
            payload: { code: "TOOL_STORM_BLOCKED", message, recoverable: true },
          };
          return {
            done: true,
            result: "error",
            error: message,
            assistantText: message,
          };
        }
        const decision = this.evaluateSecurity({
          toolName,
          input: patchInput,
          cwd,
          threadId: opts.threadId,
          turnId,
        });
        const authorization = yield* this.authorizeDecision(
          turnId,
          toolName,
          decision,
          {
            toolStorm: storm.action === "warn" ? storm.message : undefined,
            action: "patch",
            path: plan.targetPath,
            bytes: Buffer.byteLength(plan.content, "utf-8"),
          },
          opts.content,
        );
        if (!authorization.allowed) {
          const message = authorization.reason;
          yield {
            kind: "error",
            payload: {
              code: "PATCH_PERMISSION_DENIED",
              message,
              recoverable: true,
            },
          };
          return {
            done: true,
            result: "error",
            error: message,
            assistantText: message,
          };
        }
        const authorizedPath = requireBrokeredFilePermit(
          decision.operation,
          authorization.permit,
          "write",
        );
        const toolId = `tool-${turnId}-patch`;
        const input = {
          path: plan.targetPath,
          bytes: Buffer.byteLength(plan.content, "utf-8"),
        };
        const assistantText = yield* this.runToolAsText(
          turnId,
          toolId,
          toolName,
          input,
          () => this.patchWorkspaceFile(cwd, authorizedPath, plan.content),
        );
        return { done: true, result: "success", assistantText };
      }
      if (plan.intent === "undo") {
        const toolId = `tool-${turnId}-undo`;
        const toolName = "self-built.fs.undo";
        const targetPath = this.latestUndoPath(cwd);
        const input = { path: targetPath };
        const decision = this.evaluateSecurity({
          toolName,
          input,
          cwd,
          threadId: opts.threadId,
          turnId,
        });
        const authorization = yield* this.authorizeDecision(
          turnId,
          toolName,
          decision,
          { action: "undo", path: targetPath },
          opts.content,
        );
        if (!authorization.allowed) {
          const message = authorization.reason;
          yield {
            kind: "error",
            payload: {
              code: "UNDO_PERMISSION_DENIED",
              message,
              recoverable: true,
            },
          };
          return {
            done: true,
            result: "error",
            error: message,
            assistantText: message,
          };
        }
        const authorizedPath = requireBrokeredFilePermit(
          decision.operation,
          authorization.permit,
          "write",
        );
        const assistantText = yield* this.runToolAsText(
          turnId,
          toolId,
          toolName,
          input,
          () => this.undoLastPatch(cwd, authorizedPath),
        );
        return { done: true, result: "success", assistantText };
      }
      if (plan.intent === "terminal") {
        const toolId = `tool-${turnId}-terminal`;
        const toolName = "terminal.exec";
        const input = { command: plan.command };
        const decision = this.evaluateSecurity({
          toolName,
          input,
          cwd,
          threadId: opts.threadId,
          turnId,
        });
        const authorization = yield* this.authorizeDecision(
          turnId,
          toolName,
          decision,
          { action: "terminal", command: plan.command },
          opts.content,
        );
        if (!authorization.allowed) {
          const message = authorization.reason;
          yield {
            kind: "error",
            payload: {
              code: "TOOL_PERMISSION_DENIED",
              message,
              recoverable: true,
            },
          };
          return {
            done: true,
            result: "error",
            error: message,
            assistantText: message,
          };
        }
        const assistantText = yield* this.runToolAsText(
          turnId,
          toolId,
          toolName,
          input,
          async () => {
            const sessionId = terminalService.spawn(cwd, {
              threadId: opts.threadId,
            });
            terminalService.write(sessionId, plan.command + "\n");
            const result = await terminalService.readUntilStable(sessionId);
            return JSON.stringify({
              sessionId,
              output: result.data,
              stable: result.stable,
              exitCode: result.exitCode,
            });
          },
        );
        return { done: true, result: "success", assistantText };
      }
      if (plan.intent === "browser") {
        const toolId = `tool-${turnId}-browser`;
        const toolName = "browser.navigate";
        const input = { url: plan.url };
        const decision = this.evaluateSecurity({
          toolName,
          input,
          cwd,
          threadId: opts.threadId,
          turnId,
        });
        const authorization = yield* this.authorizeDecision(
          turnId,
          toolName,
          decision,
          { action: "browser", url: plan.url },
          opts.content,
        );
        if (!authorization.allowed) {
          const message = authorization.reason;
          yield {
            kind: "error",
            payload: {
              code: "TOOL_PERMISSION_DENIED",
              message,
              recoverable: true,
            },
          };
          return {
            done: true,
            result: "error",
            error: message,
            assistantText: message,
          };
        }
        const assistantText = yield* this.runToolAsText(
          turnId,
          toolId,
          toolName,
          input,
          async () => {
            let pageId = cdpBrowserService.getActivePageId(opts.threadId);
            if (!pageId) {
              pageId = await cdpBrowserService.newPage(plan.url, opts.threadId);
            } else {
              await cdpBrowserService.navigate(pageId, plan.url);
            }
            cdpBrowserService.setActivePageId(opts.threadId, pageId);
            return JSON.stringify({ pageId, url: plan.url });
          },
        );
        return { done: true, result: "success", assistantText };
      }
    } catch (error) {
      return {
        done: true,
        result: "error",
        error: error instanceof Error ? error.message : String(error),
        assistantText: `Self-built loop failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    return { done: false, result: "success", assistantText: "" };
  }

  private composeResponse(
    content: string,
    cwd?: string,
    plan?: SelfBuiltPlan,
  ): string {
    const toolNames = Array.from(this.tools.keys()).join(", ") || "none";
    return [
      "Self-built runtime is active.",
      "",
      `Workspace: ${cwd ?? process.cwd()}`,
      `Model: ${this.modelId}`,
      `Tools: ${toolNames}`,
      `Plan: ${plan?.intent ?? "respond"} → execute → verify`,
      "",
      "Received task:",
      content.trim() || "(empty)",
      "",
      "Self-built commands available: /list <dir>, /read <file>, /patch <file>\\n<content>, /undo, /term <command>, /browse <url>",
    ].join("\n");
  }

  private async *runToolAsText(
    turnId: string,
    toolId: string,
    toolName: string,
    input: unknown,
    execute: () => string | Promise<string>,
  ): AsyncGenerator<RuntimeEvent, string> {
    const storm = this.checkToolStorm(turnId, toolName, input);
    if (storm.action === "deny") {
      const message = storm.message ?? "Repeated tool call blocked.";
      yield {
        kind: "error",
        payload: { code: "TOOL_STORM_BLOCKED", message, recoverable: true },
      };
      yield {
        kind: "tool-complete",
        payload: { turnId, toolId, output: message, isError: true },
      };
      return message;
    }
    this.cancelledTools.delete(toolId);
    yield { kind: "tool-start", payload: { turnId, toolId, toolName, input } };
    yield {
      kind: "tool-progress",
      payload: {
        turnId,
        toolId,
        toolName,
        input,
        partialInput: "plan",
        isReady: false,
      },
    };
    if (this.cancelledTools.has(toolId) || this.abortedTurns.has(turnId)) {
      this.cancelledTools.delete(toolId);
      yield {
        kind: "tool-complete",
        payload: {
          turnId,
          toolId,
          output: "Tool execution cancelled.",
          isError: true,
        },
      };
      return "Tool execution cancelled.";
    }
    const output = await execute();
    yield {
      kind: "tool-progress",
      payload: {
        turnId,
        toolId,
        toolName,
        input,
        partialInput: "verify",
        isReady: true,
      },
    };
    yield {
      kind: "tool-complete",
      payload: { turnId, toolId, output, isError: false },
    };
    return [
      "Self-built runtime is active.",
      "",
      "Plan → Execute → Verify completed.",
      "",
      output,
    ].join("\n");
  }

  private listWorkspaceDir(cwd: string, absPath: string): string {
    const entries = readdirSync(absPath, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith(".git"))
      .slice(0, 100)
      .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
      .join("\n");
    return `Listed ${relative(cwd, absPath) || "."}:\n${entries || "(empty)"}`;
  }

  private readWorkspaceFile(cwd: string, absPath: string): string {
    const stat = statSync(absPath);
    if (!stat.isFile()) throw new Error("Path is not a file");
    if (stat.size > MAX_READ_BYTES)
      throw new Error("File is too large to read");
    return `Read ${relative(cwd, absPath)}:\n\n${readFileSync(absPath, "utf-8")}`;
  }

  private patchWorkspaceFile(
    cwd: string,
    absPath: string,
    content: string,
  ): string {
    const workspace = resolveSandboxPath(cwd, ".");
    const previousContent = existsSync(absPath)
      ? readFileSync(absPath, "utf-8")
      : null;
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content, "utf-8");
    this.undoStack.push({
      cwd: workspace,
      filePath: absPath,
      previousContent,
    });
    return `Patched ${relative(cwd, absPath)} (${Buffer.byteLength(content, "utf-8")} bytes).`;
  }

  private undoLastPatch(cwd: string, authorizedPath: string): string {
    const root = resolveSandboxPath(cwd, ".");
    let entryIndex = -1;
    for (let index = this.undoStack.length - 1; index >= 0; index -= 1) {
      if (
        this.undoStack[index].cwd === root &&
        sameNativePath(this.undoStack[index].filePath, authorizedPath)
      ) {
        entryIndex = index;
        break;
      }
    }
    if (entryIndex < 0)
      throw new Error("No self-built patch to undo for this workspace");
    const [entry] = this.undoStack.splice(entryIndex, 1);
    if (entry.previousContent === null) {
      if (existsSync(entry.filePath)) unlinkSync(entry.filePath);
      return `Undid patch for ${relative(root, entry.filePath)} by removing newly created file.`;
    }
    writeFileSync(entry.filePath, entry.previousContent, "utf-8");
    return `Restored ${relative(root, entry.filePath)} from undo snapshot.`;
  }

  private latestUndoPath(cwd: string): string {
    const root = resolveSandboxPath(cwd, ".");
    for (let index = this.undoStack.length - 1; index >= 0; index -= 1) {
      if (this.undoStack[index].cwd === root) {
        return relative(root, this.undoStack[index].filePath);
      }
    }
    throw new Error("No self-built patch to undo for this workspace");
  }

  private checkToolStorm(
    turnId: string,
    toolName: string,
    input: unknown,
  ): ToolStormDecision {
    return this.toolStormBreaker.check(turnId, toolName, input);
  }

  private evaluateSecurity(input: {
    toolName: string;
    input: unknown;
    cwd: string;
    threadId?: string;
    turnId?: string;
  }): SecurityDecision {
    const settings = getAgentSettings();
    return this.securityHost.evaluate({
      threadId: input.threadId,
      turnId: input.turnId,
      toolName: input.toolName,
      input: input.input,
      workspaceRoot: input.cwd,
      permissionMode: this.permissionMode,
      settings,
    });
  }

  private approvalTimeoutMs(): number {
    return (
      getAgentSettings().permissionApprovalTimeoutMs ?? APPROVAL_TIMEOUT_MS
    );
  }

  private shouldRequestApproval(content: string): boolean {
    return /\bapproval\b|\/approval\b|敏感工具|审批/.test(content);
  }

  private createApprovalRequest(
    requestId: string,
    toolName: string,
    operation?: SecurityOperation,
    elevationProfile?: SandboxProfile,
  ): { decision: Promise<boolean> } {
    const decision = new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(requestId);
        resolve(false);
      }, APPROVAL_TIMEOUT_MS);

      this.pendingApprovals.set(requestId, {
        toolName,
        operation,
        elevationProfile,
        resolve: (approved) => {
          clearTimeout(timeout);
          resolve(approved);
        },
      });
    });
    return { decision };
  }

  private async *authorizeDecision(
    turnId: string,
    toolName: string,
    decision: SecurityDecision,
    details: Record<string, unknown>,
    trustedUserRequest?: string,
  ): AsyncGenerator<
    RuntimeEvent,
    { allowed: boolean; reason: string; permit?: SecurityPermit }
  > {
    if (decision.action === "deny") {
      return { allowed: false, reason: decision.reason };
    }
    if (decision.action === "allow") {
      return {
        allowed: true,
        reason: decision.reason,
        permit: decision.permit,
      };
    }
    const settings = getAgentSettings();
    let reviewerReason: string | undefined;
    if (settings.securityMode === "auto-review") {
      yield {
        kind: "runtime-status",
        payload: {
          turnId,
          label: "安全审查",
          detail: "正在隔离审查会话中评估该操作",
          status: "running",
        },
      };
      const review = await runGuardianReview(decision, settings, {
        trustedUserRequest,
      });
      reviewerReason = guardianReviewDetail(review);
      yield {
        kind: "runtime-status",
        payload: {
          turnId,
          label: "安全审查",
          detail: reviewerReason,
          status: review.action === "deny" ? "error" : "completed",
        },
      };
      if (review.action === "deny") {
        return { allowed: false, reason: `自动审查拒绝：${review.reason}` };
      }
      if (review.action === "allow") {
        return {
          allowed: true,
          reason: `自动审查批准：${review.reason}`,
          permit: this.securityHost.issueApprovedPermit(
            decision.operation,
            settings,
            decision.elevationProfile,
          ),
        };
      }
    }
    const requestId = `approval-${turnId}`;
    const approval = this.createApprovalRequest(
      requestId,
      toolName,
      decision.operation,
      decision.elevationProfile,
    );
    yield {
      kind: "approval-request",
      payload: {
        requestId,
        toolName,
        reason: JSON.stringify(
          {
            decision: decision.reason,
            automaticReview: reviewerReason,
            matchedRule: decision.matchedRule,
            ...details,
          },
          null,
          2,
        ),
        timeout: this.approvalTimeoutMs(),
        allowSession: decision.allowSession,
      },
    };
    if (!(await approval.decision)) {
      return { allowed: false, reason: "Tool execution denied by user." };
    }
    return {
      allowed: true,
      reason: "Approved by user.",
      permit: this.securityHost.issueApprovedPermit(
        decision.operation,
        settings,
        decision.elevationProfile,
      ),
    };
  }

  private resolvePendingApprovals(approved: boolean): void {
    for (const [requestId, pending] of this.pendingApprovals) {
      this.pendingApprovals.delete(requestId);
      pending.resolve(approved);
    }
  }
}

function splitChunks(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

function estimateTokenUsage(input: string, output: string) {
  const inputTokens = estimateTokens(input);
  const outputTokens = estimateTokens(output);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    modelContextWindowTokens: 128_000,
    raw: { estimated: true },
  };
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

type SelfBuiltPlan =
  | { intent: "respond" }
  | { intent: "list"; targetPath: string }
  | { intent: "read"; targetPath: string }
  | { intent: "patch"; targetPath: string; content: string }
  | { intent: "undo" }
  | { intent: "terminal"; command: string }
  | { intent: "browser"; url: string };

interface SelfBuiltLoopResult {
  done: boolean;
  result: "success" | "error" | "aborted";
  assistantText: string;
  error?: string;
}

function formatPlan(plan: SelfBuiltPlan): string {
  const target = "targetPath" in plan ? ` ${plan.targetPath || "."}` : "";
  return [
    "Plan:",
    `1. Understand intent: ${plan.intent}${target}`,
    "2. Execute with workspace sandbox checks",
    "3. Verify and report result",
  ].join("\n");
}

function resolveSandboxPath(cwd: string, inputPath: string): string {
  const result = validatePathBoundary(inputPath || ".", resolve(cwd));
  if (!result.allowed || !result.resolvedPath) {
    throw new Error(result.reason ?? "Path is outside the current workspace");
  }
  return result.resolvedPath;
}

function requireBrokeredFilePermit(
  operation: SecurityOperation,
  permit: SecurityPermit | undefined,
  access: "read" | "write",
): string {
  const authorizedPath = operation.resolvedPath;
  if (!permit || !authorizedPath || permit.operationId !== operation.id) {
    throw new Error(
      "Brokered filesystem operation is missing its one-time permit.",
    );
  }
  if (
    permit.sandboxOwnership.kind !== "managed" ||
    permit.sandboxOwnership.backend !== "brokered-fs"
  ) {
    throw new Error(
      "Brokered filesystem operation has an invalid sandbox owner.",
    );
  }
  if (
    !permit.fs[access].some((candidate) =>
      sameNativePath(candidate, authorizedPath),
    )
  ) {
    throw new Error(
      `Brokered filesystem permit does not allow ${access} access.`,
    );
  }
  return authorizedPath;
}

function sameNativePath(first: string, second: string): boolean {
  const left = resolve(first);
  const right = resolve(second);
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}
