import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { join } from "node:path";
import { store } from "../store";
import { CodexAppServerSession } from "./session";
import {
  createCodexTransport,
  resolveBundledCodexBinary,
} from "./transport/connection";
import { JsonRpcClient } from "./transport/jsonrpc-client";
import {
  decodeRequest,
  encodeRequest,
  parseResponse,
  type IrResponse,
} from "../gateway/protocol";
import { getGatewayPort, startGateway } from "../gateway";
import { log } from "../logger";
import { logWarn } from "../core/logging/app-logger";
import { eventLog, type EventLogEntry } from "./event-log";
import type { NormalizedThreadItem } from "./normalize";
import {
  getAgentSettings,
  saveAgentSettings,
} from "../services/config-service";
import { getRuntimeConfigDir } from "../app-paths";
import { resolveModelProvider } from "../core/config/model-provider";
import type { ModelProviderConfig } from "@shared/types";

function svcLog(...args: unknown[]): void {
  log("[svc]", ...args);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function buildCodexConfigArgs(model: string, gatewayPort: number): string[] {
  const gatewayBase = `http://127.0.0.1:${gatewayPort}`;
  const config = [
    `model=${tomlString(model)}`,
    `model_provider=${tomlString("codex-web-gateway")}`,
    `model_providers.codex-web-gateway.name=${tomlString("codex-web-gateway")}`,
    `model_providers.codex-web-gateway.base_url=${tomlString(`${gatewayBase}/v1`)}`,
    `model_providers.codex-web-gateway.env_key=${tomlString("OPENAI_API_KEY")}`,
    `model_providers.codex-web-gateway.wire_api=${tomlString("responses")}`,
  ];

  return config.flatMap((entry) => ["-c", entry]);
}

export interface ThreadEvent {
  type:
    | "thread.started"
    | "thread.resumed"
    | "thread.forked"
    | "turn.started"
    | "turn.completed"
    | "turn.failed"
    | "raw_event"
    | "item.started"
    | "item.updated"
    | "item.completed"
    | "context_compacted"
    | "approval_requested"
    | "turn_step_failed"
    | "error";
  thread_id?: string;
  source_thread_id?: string;
  item?: ThreadItem;
  rawEvent?: { method: string; params: unknown; receivedAt: number };
  usage?: Usage;
  error?: ThreadError;
  message?: string;
  approval?: {
    id: string;
    tool: string;
    toolInput: Record<string, unknown>;
    threadId: string;
    cwd?: string;
  };
  contextCompacted?: { originalTokens: number; compactedTokens: number };
  stepIndex?: number;
  stepType?: string;
}

export type ThreadItem = NormalizedThreadItem;

export interface Usage {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
}

export interface ThreadError {
  message: string;
  recoverable?: boolean;
}

export interface Session {
  id: string;
  status: "idle" | "running" | "error";
  createdAt: number;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  codexSession?: CodexAppServerSession;
  rpcClient?: JsonRpcClient;
  retryCount?: number;
  lastFailedTurn?: { stepIndex: number; stepType: string; error: string };
}

const RECOVERABLE_PATTERNS = [
  "timeout",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "network",
  "fetch failed",
  "socket hang up",
  "rate limit",
  "429",
  "503",
  "502",
];

const NON_RECOVERABLE_PATTERNS = [
  "unauthorized",
  "authentication",
  "invalid_api_key",
  "401",
  "403",
  "permission",
  "forbidden",
];

function classifyError(error: string): {
  recoverable: boolean;
  message: string;
} {
  const lower = error.toLowerCase();
  const isNonRecoverable = NON_RECOVERABLE_PATTERNS.some((p) =>
    lower.includes(p),
  );
  if (isNonRecoverable) {
    return { recoverable: false, message: error };
  }
  const isRecoverable = RECOVERABLE_PATTERNS.some((p) => lower.includes(p));
  return { recoverable: isRecoverable, message: error };
}

const MAX_RETRIES = 2;

function eventThreadId(event: {
  type: string;
  threadId?: string;
  event?: { params: unknown };
}): string {
  if (event.threadId) return event.threadId;
  const params = event.event?.params;
  if (params && typeof params === "object") {
    const record = params as Record<string, unknown>;
    if (typeof record.threadId === "string") return record.threadId;
    if (typeof record.thread_id === "string") return record.thread_id;
  }
  return "";
}

export class CodexService {
  private sessions: Map<string, Session> = new Map();
  private eventEmitter = new EventEmitter();
  private currentProvider: ModelProviderConfig | null = null;
  private currentApiKey: string | undefined = undefined;
  private currentModel: string | undefined = undefined;
  private abortControllers: Map<string, AbortController> = new Map();
  private binaryPath: string = "codex";
  private binaryPathDirs: string[] = [];
  private reconnectAttempts: Map<string, number> = new Map();
  private readonly maxReconnectAttempts = 3;

  constructor() {
    this.refreshProvider();
    const bundledCodex = resolveBundledCodexBinary();
    this.binaryPath = bundledCodex?.binaryPath || "codex";
    this.binaryPathDirs = bundledCodex?.pathDirs || [];
  }

  refreshProvider(): void {
    // 配置统一：binary 内核从 AgentSettings（settings.json）解析 provider，
    // 与 sdk/self-built 共用同一配置源，不再读旧 SimpleStore。
    const settings = getAgentSettings();
    const resolved = resolveModelProvider(settings);
    this.currentProvider = resolved.provider;
    this.currentApiKey = resolved.apiKey;
    this.currentModel = resolved.model;
  }

  setApiKey(apiKey: string): void {
    if (this.currentProvider) {
      // 更新统一配置的 provider apiKey（settings.json），与 UI 设置同步。
      const settings = getAgentSettings();
      const providers = settings.providers.map((p) =>
        p.id === this.currentProvider?.id ? { ...p, apiKey } : p,
      );
      saveAgentSettings({ ...settings, providers });
      this.currentApiKey = apiKey;
    }
  }

  setWorkingDirectory(_dir: string): void {
    // Working directory is set per-session
  }

  async createSession(
    sessionId: string,
    options?: { cwd?: string },
  ): Promise<string> {
    svcLog("[svc] createSession called:", sessionId);
    const provider = this.currentProvider;
    const apiKey = this.currentApiKey ?? provider?.apiKey;
    if (!apiKey) {
      svcLog("[svc] No API key configured");
      throw new Error("API key not configured");
    }

    // 配置统一：cwd/权限/沙箱从 AgentSettings 派生（替代旧 SimpleStore）。
    const agentSettings = getAgentSettings();
    const workingDir = options?.cwd || process.cwd();
    const model = this.currentModel || provider?.models?.[0]?.id || "default";
    const baseUrl = provider?.baseUrl;
    const permissionMode = agentSettings.permissionMode;
    const sandboxEnabled = agentSettings.sandboxEnabled ?? false;
    let gatewayPort = getGatewayPort();
    if (!gatewayPort) {
      const started = await startGateway();
      gatewayPort = started?.port ?? 0;
    }
    if (!gatewayPort) {
      throw new Error("Gateway not initialized");
    }
    svcLog(
      "[svc] Working dir:",
      workingDir,
      "Binary:",
      this.binaryPath,
      "Gateway port:",
      gatewayPort,
    );
    svcLog(
      "[svc] Model:",
      model,
      "Sandbox:",
      sandboxEnabled,
      "Approval:",
      permissionMode,
    );

    // Create transport for Codex CLI
    const codexHome = join(getRuntimeConfigDir(), "codex");
    const transport = createCodexTransport({
      binaryPath: this.binaryPath,
      cwd: workingDir,
      env: {
        ...process.env,
        // Pass provider credentials via env (belt-and-suspenders)
        OPENAI_API_KEY: apiKey,
        OPENAI_BASE_URL: baseUrl,
        OPENAI_MODEL: model,
        // 运行时状态统一：codex 的 config.toml / 会话 JSONL / auth 落入
        // runtime-config/codex，而不是默认的 ~/.codex。
        CODEX_HOME: codexHome,
        // Tell Codex CLI to use our gateway as the API server
        CODEX_API_BASE_URL: `http://127.0.0.1:${gatewayPort}`,
        CODEX_DISABLE_TELEMETRY: "1",
      },
      pathDirs: this.binaryPathDirs,
      args: ["app-server", ...buildCodexConfigArgs(model, gatewayPort)],
      onStderr: (chunk) => {
        svcLog("[codex-stderr]", chunk.trim());
      },
    });

    const rpc = new JsonRpcClient(transport);
    const codexSession = new CodexAppServerSession(sessionId, rpc, transport, {
      cwd: workingDir,
      approvalPolicy:
        permissionMode === "bypassPermissions"
          ? "bypass"
          : permissionMode === "acceptEdits"
            ? "acceptEdits"
            : "on-request",
      sandbox: sandboxEnabled ? "workspace-write" : "read-only",
    });

    // Set up event forwarding from Codex session
    codexSession.onEvent((event) => {
      // Log event to event log
      const logEntry: EventLogEntry = {
        timestamp: Date.now(),
        threadId: eventThreadId(event),
        sessionId,
        type: event.type,
        payload: event,
      };
      eventLog.append(logEntry);

      switch (event.type) {
        case "thread_started":
          this.eventEmitter.emit("event", sessionId, {
            type: "thread.started",
            thread_id: event.threadId,
          });
          break;
        case "thread_resumed":
          this.eventEmitter.emit("event", sessionId, {
            type: "thread.resumed",
            thread_id: event.threadId,
          });
          break;
        case "thread_forked":
          this.eventEmitter.emit("event", sessionId, {
            type: "thread.forked",
            thread_id: event.threadId,
            source_thread_id: event.sourceThreadId,
          });
          break;
        case "turn_started":
          this.eventEmitter.emit("event", sessionId, { type: "turn.started" });
          break;
        case "disconnected":
          this.eventEmitter.emit("status", sessionId, "disconnected");
          break;
        case "raw_event":
          this.eventEmitter.emit("event", sessionId, {
            type: "raw_event",
            rawEvent: event.event,
          });
          break;
        case "assistant_message":
          break;
        case "item_event":
          {
            const type =
              event.phase === "started"
                ? "item.started"
                : event.phase === "updated"
                  ? "item.updated"
                  : "item.completed";
            this.eventEmitter.emit("event", sessionId, {
              type,
              item: { ...event.item, phase: event.phase },
            });
          }
          break;
        case "tool_call":
          break;
        case "tool_result":
          break;
        case "turn_completed":
          this.eventEmitter.emit("event", sessionId, {
            type: "turn.completed",
          });
          break;
        case "turn_step_failed":
          this.eventEmitter.emit("event", sessionId, {
            type: "turn_step_failed",
            stepIndex: event.stepIndex,
            stepType: event.stepType,
            error: event.error,
          });
          break;
        case "context_compacted":
          this.eventEmitter.emit("event", sessionId, {
            type: "context_compacted",
            contextCompacted: {
              originalTokens: event.originalTokens,
              compactedTokens: event.compactedTokens,
            },
          });
          break;
        case "approval_requested":
          this.eventEmitter.emit("event", sessionId, {
            type: "approval_requested",
            approval: {
              id: event.id,
              tool: event.tool,
              toolInput: event.toolInput,
              threadId: event.threadId,
              cwd: event.cwd,
            },
          });
          break;
        case "error":
          this.eventEmitter.emit("event", sessionId, {
            type: "turn.failed",
            error: { message: event.message },
          });
          break;
      }
    });

    codexSession.onStatus((status) => {
      this.eventEmitter.emit("status", sessionId, status);
    });

    // Start the Codex session
    try {
      await codexSession.start();
    } catch (err) {
      svcLog("[svc] Failed to start session:", err);
      throw err;
    }

    // Set up auto-reconnect monitoring
    const checkReconnect = () => {
      if (!transport.isAlive()) {
        const attempts = this.reconnectAttempts.get(sessionId) || 0;
        if (attempts < this.maxReconnectAttempts) {
          this.reconnectAttempts.set(sessionId, attempts + 1);
          svcLog(
            `[svc] Process exited, attempting reconnect ${attempts + 1}/${this.maxReconnectAttempts}`,
          );
          this.eventEmitter.emit("status", sessionId, "reconnecting");
          // Auto-reconnect after delay
          setTimeout(
            async () => {
              try {
                await this.closeSession(sessionId);
                await this.createSession(sessionId);
                this.reconnectAttempts.set(sessionId, 0);
                svcLog("[svc] Reconnect successful");
              } catch (reconnectErr) {
                svcLog("[svc] Reconnect failed:", reconnectErr);
              }
            },
            2000 * (attempts + 1),
          );
        } else {
          svcLog("[svc] Max reconnect attempts reached");
          this.eventEmitter.emit(
            "error",
            sessionId,
            "Connection lost, max reconnect attempts reached",
          );
        }
      }
    };

    // Monitor process exit
    const exitCheckInterval = setInterval(() => {
      if (!transport.isAlive()) {
        clearInterval(exitCheckInterval);
        checkReconnect();
      }
    }, 5000);

    // Check if we should resume an existing thread
    const existingSession = store.getSession(sessionId);
    const legacyThreadId = existingSession
      ? (existingSession as typeof existingSession & Record<string, unknown>)[
          "co" + "dexThreadId"
        ]
      : undefined;
    const existingThreadId =
      existingSession?.runtimeThreadIds?.binary ??
      (typeof legacyThreadId === "string" ? legacyThreadId : undefined);
    if (existingThreadId) {
      svcLog("[svc] Resuming existing thread:", existingThreadId);
      try {
        await codexSession.resume(existingThreadId, workingDir);
      } catch (err) {
        svcLog("[svc] Failed to resume thread, will create new:", err);
      }
    }

    const newSession: Session = {
      id: sessionId,
      status: "idle",
      createdAt: Date.now(),
      messages: [],
      codexSession,
      rpcClient: rpc,
    };
    // Store interval for cleanup
    (newSession as any).exitCheckInterval = exitCheckInterval;
    this.sessions.set(sessionId, newSession);
    return sessionId;
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Clean up exit check interval
      if ((session as any).exitCheckInterval) {
        clearInterval((session as any).exitCheckInterval);
      }
      if (session.codexSession) {
        await session.codexSession.close();
      }
    }
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(sessionId);
    }
    this.reconnectAttempts.delete(sessionId);
    this.sessions.delete(sessionId);
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    let session = this.sessions.get(sessionId);
    if (!session) {
      await this.createSession(sessionId);
      session = this.sessions.get(sessionId)!;
    }

    const apiKey = this.currentApiKey ?? this.currentProvider?.apiKey;
    if (!apiKey) {
      this.eventEmitter.emit("error", sessionId, "API key not configured");
      return;
    }

    if (!session.codexSession) {
      this.eventEmitter.emit(
        "error",
        sessionId,
        "Codex session not initialized",
      );
      return;
    }

    session.status = "running";
    this.eventEmitter.emit("status", sessionId, "running");

    // Add user message to history
    session.messages.push({ role: "user", content });

    // Emit turn started
    this.eventEmitter.emit("event", sessionId, { type: "turn.started" });

    const controller = new AbortController();
    this.abortControllers.set(sessionId, controller);

    let attempt = session.retryCount || 0;
    try {
      while (true) {
        try {
          await session.codexSession.send(content);
          session.status = "idle";
          session.retryCount = 0;
          this.eventEmitter.emit("status", sessionId, "idle");
          return;
        } catch (err) {
          if ((err as Error).name === "AbortError") {
            session.status = "idle";
            this.eventEmitter.emit("status", sessionId, "cancelled");
            return;
          }

          const errorMessage =
            err instanceof Error ? err.message : "Unknown error";
          const { recoverable } = classifyError(errorMessage);
          if (!recoverable || attempt >= MAX_RETRIES) {
            session.status = "error";
            this.eventEmitter.emit("error", sessionId, errorMessage);
            this.eventEmitter.emit("event", sessionId, {
              type: "turn.failed",
              error: { message: errorMessage },
            });
            return;
          }

          attempt += 1;
          session.retryCount = attempt;
          svcLog(
            `[svc] Recoverable error, retry ${attempt}/${MAX_RETRIES}:`,
            errorMessage,
          );
          this.eventEmitter.emit("event", sessionId, {
            type: "error",
            error: {
              message: `Retrying (${attempt}/${MAX_RETRIES})...`,
              recoverable: true,
            },
          });
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      session.status = "error";
      this.eventEmitter.emit("error", sessionId, errorMessage);
      this.eventEmitter.emit("event", sessionId, {
        type: "turn.failed",
        error: { message: errorMessage },
      });
    } finally {
      this.abortControllers.delete(sessionId);
    }
  }

  async abortSession(sessionId: string): Promise<void> {
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
    }
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        await session.codexSession?.interrupt();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logWarn("codex.interruptFailed", { message });
      }
      session.status = "idle";
    }
    this.eventEmitter.emit("status", sessionId, "cancelled");
  }

  async respondToApproval(
    sessionId: string,
    approvalId: string,
    decision: "approve" | "deny",
    reason?: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.codexSession) {
      throw new Error("Session not found or not initialized");
    }
    await session.codexSession.respondToApproval(approvalId, decision, reason);
  }

  async resumeThread(
    sessionId: string,
    threadId: string,
    cwd?: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.codexSession) {
      throw new Error("Session not found or not initialized");
    }
    await session.codexSession.resume(threadId, cwd);
  }

  async forkThread(
    sessionId: string,
    sourceThreadId: string,
    cwd?: string,
  ): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session?.codexSession) {
      throw new Error("Session not found or not initialized");
    }
    return await session.codexSession.fork(sourceThreadId, cwd);
  }

  async retryFromStep(sessionId: string, _stepIndex: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.codexSession) {
      throw new Error("Session not found or not initialized");
    }
    // Get the last user message to retry
    const lastUserMessage = [...session.messages]
      .reverse()
      .find((m) => m.role === "user");
    if (!lastUserMessage) {
      throw new Error("No user message to retry");
    }
    // Clear the failed turn info
    session.lastFailedTurn = undefined;
    // Send the message again
    await this.sendMessage(sessionId, lastUserMessage.content);
  }

  onEvent(callback: (sessionId: string, event: ThreadEvent) => void): void {
    this.eventEmitter.on("event", callback);
  }

  onError(callback: (sessionId: string, error: string) => void): void {
    this.eventEmitter.on("error", callback);
  }

  onStatus(callback: (sessionId: string, status: string) => void): void {
    this.eventEmitter.on("status", callback);
  }

  removeAllListeners(): void {
    this.eventEmitter.removeAllListeners();
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  // Inline protocol conversion: OpenAI Responses API -> OpenAI Chat Completions
  async convertAndCallMiniMax(
    responsesRequest: unknown,
    signal: AbortSignal,
  ): Promise<IrResponse> {
    const requestId = randomUUID();
    const apiKey = this.currentApiKey ?? this.currentProvider?.apiKey;
    const baseUrl = this.currentProvider?.baseUrl;
    const model = this.currentModel || "default";

    // Decode OpenAI Responses API request to IR
    const irRequest = decodeRequest(
      "openai-responses",
      responsesRequest,
      requestId,
    );

    // Encode IR to OpenAI Chat Completions format
    const { body: chatBody, headers: chatHeaders } = encodeRequest(
      "openai-chat",
      irRequest,
    );
    (chatBody as { model: string }).model = model;

    // Call the configured provider
    const url = `${(baseUrl ?? "").replace(/\/$/, "")}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...chatHeaders,
      },
      body: JSON.stringify(chatBody),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Provider API error: ${response.status} - ${errorText}`);
    }

    const chatResponse = await response.json();

    // Parse and format response back to OpenAI Responses format
    const irResponse = parseResponse(
      "openai-chat",
      chatResponse,
      requestId,
      irRequest.model,
    );
    return irResponse;
  }
}

export const codexService = new CodexService();
