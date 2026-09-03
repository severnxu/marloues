import { EventEmitter } from "events";
import { createHash, randomUUID } from "crypto";
import { mkdirSync, realpathSync } from "node:fs";
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
import { startGateway } from "../gateway";
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
import { resolveRuntimeProviderRoutes } from "../core/config/provider-routing";
import {
  codexWorkspaceFilesystemConfig,
  codexSandboxProfileFromSettings,
  type SandboxProfile,
} from "../core/security/sandbox-broker";
import type { AgentSettings, ModelProviderConfig } from "@shared/types";
import {
  codexExtraSkillRoots,
  codexMcpServersConfig,
  codexSkillConfig,
  resolveEffectiveExtensionPlan,
} from "../services/extension-plan-service";

function svcLog(...args: unknown[]): void {
  log("[svc]", ...args);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function buildCodexConfigArgs(
  model: string,
  apiBaseUrl: string,
  sandboxProfile: SandboxProfile,
): string[] {
  const config = [
    `model=${tomlString(model)}`,
    `model_provider=${tomlString("codex-web-gateway")}`,
    `model_providers.codex-web-gateway.name=${tomlString("codex-web-gateway")}`,
    `model_providers.codex-web-gateway.base_url=${tomlString(apiBaseUrl)}`,
    `model_providers.codex-web-gateway.env_key=${tomlString("OPENAI_API_KEY")}`,
    `model_providers.codex-web-gateway.wire_api=${tomlString("responses")}`,
    "features.request_permissions_tool=true",
  ];

  if (process.platform === "win32" && sandboxProfile !== "danger-full-access") {
    config.push('windows.sandbox="unelevated"');
  }

  if (
    sandboxProfile === "workspace-write" ||
    sandboxProfile === "workspace-write-network"
  ) {
    const workspaceProfile = codexWorkspaceProfileName(sandboxProfile);
    config.push(
      `default_permissions=${tomlString(workspaceProfile)}`,
      `permissions.${workspaceProfile}.filesystem=${codexWorkspaceFilesystemConfig()}`,
    );
  }

  if (sandboxProfile === "workspace-write-network") {
    config.push("permissions.marloues-workspace-network.network.enabled=true");
  }

  return config.flatMap((entry) => ["-c", entry]);
}

function codexAppServerPermissions(
  profile: SandboxProfile,
):
  | ":read-only"
  | ":danger-full-access"
  | "marloues-workspace"
  | "marloues-workspace-network" {
  if (profile === "read-only") return ":read-only";
  if (profile === "danger-full-access") return ":danger-full-access";
  return codexWorkspaceProfileName(profile);
}

function codexWorkspaceProfileName(
  profile: "workspace-write" | "workspace-write-network",
): "marloues-workspace" | "marloues-workspace-network" {
  return profile === "workspace-write-network"
    ? "marloues-workspace-network"
    : "marloues-workspace";
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
    allowSession: boolean;
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
  workingDir?: string;
  securityFingerprint?: string;
  settingsSnapshot?: AgentSettings;
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
    options?: { cwd?: string; settings?: AgentSettings },
  ): Promise<string> {
    svcLog("[svc] createSession called:", sessionId);
    // 配置统一：cwd/权限/沙箱从 AgentSettings 派生（替代旧 SimpleStore）。
    const agentSettings = options?.settings ?? getAgentSettings();
    const routePlan = resolveRuntimeProviderRoutes(agentSettings, {
      runtimeId: "binary",
    });
    if (!routePlan.routes.length) {
      svcLog("[svc] No compatible provider route configured");
      throw new Error("当前供应商没有可用于 Binary 运行时的模型端点");
    }
    const directRoute = routePlan.directRoute;
    const connection = directRoute
      ? {
          apiKey: directRoute.apiKey,
          apiBaseUrl: codexApiBaseUrl(directRoute.baseUrl),
          transportBaseUrl: directRoute.baseUrl,
          routeId: directRoute.endpointId,
          fingerprint: directRouteFingerprint(directRoute),
        }
      : await startGateway().then((gateway) => ({
          apiKey: gateway.token,
          apiBaseUrl: `${gateway.baseUrl}/v1`,
          transportBaseUrl: gateway.baseUrl,
          routeId: `gateway:${routePlan.routes
            .map((route) => route.endpointId)
            .join(",")}`,
          fingerprint: `gateway:${routePlan.routes
            .map((route) => route.endpointId)
            .join(",")}`,
        }));
    const workingDir = canonicalWorkingDirectory(options?.cwd || process.cwd());
    const extensionPlan = resolveEffectiveExtensionPlan(
      agentSettings,
      workingDir,
      "binary",
    );
    const model = routePlan.routes[0].model;
    const permissionMode = agentSettings.permissionMode;
    const sandboxEnabled = agentSettings.sandboxEnabled;
    const sandboxProfile = codexSandboxProfileFromSettings({
      sandboxEnabled,
      sandboxMode: agentSettings.sandboxMode,
    });
    const securityFingerprint = sessionSecurityFingerprint(
      permissionMode,
      sandboxProfile,
      routePlan.routes[0].providerId,
      model,
      connection.fingerprint,
      extensionPlan.fingerprint,
    );
    svcLog(
      "[svc] Working dir:",
      workingDir,
      "Binary:",
      this.binaryPath,
      "Route:",
      connection.routeId,
    );
    svcLog(
      "[svc] Model:",
      model,
      "Sandbox:",
      sandboxProfile,
      "Approval:",
      permissionMode,
    );

    // Create transport for Codex CLI
    const codexHome = join(getRuntimeConfigDir(), "codex");
    mkdirSync(codexHome, { recursive: true });
    const transport = createCodexTransport({
      binaryPath: this.binaryPath,
      cwd: workingDir,
      env: {
        ...process.env,
        OPENAI_API_KEY: connection.apiKey,
        OPENAI_BASE_URL: connection.apiBaseUrl,
        OPENAI_MODEL: model,
        // 运行时状态统一：codex 的 config.toml / 会话 JSONL / auth 落入
        // runtime-config/codex，而不是默认的 ~/.codex。
        CODEX_HOME: codexHome,
        CODEX_API_BASE_URL: connection.transportBaseUrl,
        CODEX_DISABLE_TELEMETRY: "1",
      },
      pathDirs: this.binaryPathDirs,
      args: [
        "app-server",
        ...buildCodexConfigArgs(model, connection.apiBaseUrl, sandboxProfile),
      ],
      onStderr: (chunk) => {
        svcLog("[codex-stderr]", chunk.trim());
      },
    });

    const rpc = new JsonRpcClient(transport);
    const codexSession = new CodexAppServerSession(sessionId, rpc, transport, {
      cwd: workingDir,
      approvalPolicy:
        permissionMode === "bypassPermissions"
          ? "never"
          : permissionMode === "acceptEdits"
            ? "untrusted"
            : "on-request",
      permissions: codexAppServerPermissions(sandboxProfile),
      config: {
        mcp_servers: codexMcpServersConfig(extensionPlan.mcpServers),
        skills: codexSkillConfig(extensionPlan),
      },
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
              allowSession: event.allowSession,
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
      await codexSession.setSkillExtraRoots(
        codexExtraSkillRoots(extensionPlan),
      );
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
            `[svc] Process exited, attempting reconnect ${attempts + 1}/${
              this.maxReconnectAttempts
            }`,
          );
          this.eventEmitter.emit("status", sessionId, "reconnecting");
          // Auto-reconnect after delay
          setTimeout(
            async () => {
              try {
                await this.closeSession(sessionId);
                await this.createSession(sessionId, {
                  cwd: workingDir,
                  settings: agentSettings,
                });
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
      workingDir,
      securityFingerprint,
      settingsSnapshot: agentSettings,
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

  async sendMessage(
    sessionId: string,
    content: string,
    options?: { cwd?: string; settings?: AgentSettings },
  ): Promise<void> {
    let session = this.sessions.get(sessionId);
    const workingDir = canonicalWorkingDirectory(options?.cwd || process.cwd());
    const currentSettings = options?.settings ?? getAgentSettings();
    const extensionPlan = resolveEffectiveExtensionPlan(
      currentSettings,
      workingDir,
      "binary",
    );
    const currentSandboxProfile = codexSandboxProfileFromSettings({
      sandboxEnabled: currentSettings.sandboxEnabled,
      sandboxMode: currentSettings.sandboxMode,
    });
    const currentSecurityFingerprint = sessionSecurityFingerprint(
      currentSettings.permissionMode,
      currentSandboxProfile,
      ...binaryRouteFingerprint(currentSettings),
      extensionPlan.fingerprint,
    );
    if (
      session &&
      (session.workingDir !== workingDir ||
        session.securityFingerprint !== currentSecurityFingerprint)
    ) {
      await this.closeSession(sessionId);
      session = undefined;
    }
    if (!session) {
      await this.createSession(sessionId, {
        cwd: workingDir,
        settings: currentSettings,
      });
      session = this.sessions.get(sessionId)!;
    }

    const apiKey = resolveModelProvider(currentSettings).apiKey;
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
    scope: "once" | "session" = "once",
    reason?: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.codexSession) {
      throw new Error("Session not found or not initialized");
    }
    await session.codexSession.respondToApproval(
      approvalId,
      decision,
      scope,
      reason,
    );
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

  onEvent(
    callback: (sessionId: string, event: ThreadEvent) => void,
  ): () => void {
    this.eventEmitter.on("event", callback);
    return () => this.eventEmitter.off("event", callback);
  }

  onError(callback: (sessionId: string, error: string) => void): () => void {
    this.eventEmitter.on("error", callback);
    return () => this.eventEmitter.off("error", callback);
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
    const route = resolveRuntimeProviderRoutes(getAgentSettings(), {
      sourceProtocol: "openai-chat",
    }).routes[0];
    if (!route)
      throw new Error("No OpenAI-compatible provider route configured");
    const { apiKey, baseUrl, model } = route;

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

function canonicalWorkingDirectory(cwd: string): string {
  try {
    return realpathSync.native(cwd);
  } catch {
    return cwd;
  }
}

function sessionSecurityFingerprint(
  permissionMode: AgentSettings["permissionMode"],
  sandboxProfile: SandboxProfile,
  providerId: string,
  model: string,
  routeId: string,
  extensionFingerprint = "",
): string {
  return `${permissionMode}:${sandboxProfile}:${providerId}:${model}:${routeId}:${extensionFingerprint}`;
}

function binaryRouteFingerprint(
  settings: AgentSettings,
): [providerId: string, model: string, routeId: string] {
  const plan = resolveRuntimeProviderRoutes(settings, { runtimeId: "binary" });
  const route = plan.routes[0];
  const routeFingerprint = plan.directRoute
    ? directRouteFingerprint(plan.directRoute)
    : `gateway:${plan.routes.map((item) => item.endpointId).join(",")}`;
  return [
    route?.providerId ?? "unconfigured",
    route?.model ?? "unconfigured",
    routeFingerprint,
  ];
}

function directRouteFingerprint(
  route: ReturnType<typeof resolveRuntimeProviderRoutes>["routes"][number],
): string {
  const credentialHash = createHash("sha256")
    .update(route.apiKey)
    .digest("hex")
    .slice(0, 16);
  return `${route.endpointId}:${route.baseUrl}:${credentialHash}`;
}

function codexApiBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

export const codexService = new CodexService();
