import type { WorkflowReadThreadResponse } from "./workflow-read-thread-contract";
import type {
  AppVersionInfo,
  RendererReadyInfo,
  RendererReadyReceipt,
  UpdatePreferences,
  UpdateState,
} from "./hot-update";
export type {
  AppVersionInfo,
  RendererReadyInfo,
  RendererReadyReceipt,
  UpdatePreferences,
  UpdateState,
} from "./hot-update";

/** Stable code for failures that would otherwise persist an API key without OS-backed encryption. */
export const SECRET_ENCRYPTION_UNAVAILABLE_CODE =
  "SECRET_ENCRYPTION_UNAVAILABLE";

/** Recognizes the error after Electron has serialized it across IPC. */
export function isSecretEncryptionUnavailableError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return message.includes(SECRET_ENCRYPTION_UNAVAILABLE_CODE);
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: number;
}

export interface WorkspaceGitContext {
  isRepository: boolean;
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  changedFiles: number;
  insertions: number;
  deletions: number;
}

export interface WorkspaceSettings {
  currentWorkspaceId?: string;
  workspaces: WorkspaceInfo[];
}

export interface ChatSessionRecord {
  id: string;
  title: string;
  workspacePath?: string;
  workspaceName?: string;
  parentSessionId?: string;
  forkedFromMessageId?: string;
  createdAt: number;
  updatedAt: number;
  isPinned?: boolean;
  messages: ChatMessageRecord[];
  kernelSessionId?: string;
  runtimeThreadIds?: Partial<Record<RuntimeKind, string>>;
  sdkSessionId?: string;
}

export interface SessionSearchResult {
  sessionId: string;
  turnId: string;
  ordinal: number;
  title: string;
  workspacePath?: string;
  excerpt: string;
  updatedAt: number;
}

export type OutboxMessageState =
  "queued" | "applying" | "dispatched" | "canceled";

export interface OutboxMessageRecord {
  sessionId: string;
  messageId: string;
  turnId?: string;
  displayContent: string;
  userContent: import("./workflow-read-thread-contract").WorkflowUserMessageContent[];
  sdkContent: string;
  state: OutboxMessageState;
  position: number;
  attemptCount: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface OutboxSnapshot {
  sessionId: string;
  revision: number;
  /** No active accepting turn exists; the head must be resumed as a new turn. */
  paused: boolean;
  items: OutboxMessageRecord[];
}

export interface PendingStateSnapshot {
  outboxes: OutboxSnapshot[];
  approvals: PermissionDialogRequest[];
}

export type SteerActionReceiptStatus =
  | "applied"
  | "applying"
  | "queued"
  | "canceled"
  | "reordered"
  | "already_dispatched"
  | "boundary_closed"
  | "not_found"
  | "failed";

export interface SteerActionReceipt {
  action: "apply" | "cancel" | "reorder";
  status: SteerActionReceiptStatus;
  sessionId: string;
  messageId?: string;
  turnId?: string;
  order?: string[];
  interrupt?: "succeeded" | "failed" | "unsupported";
  error?: string;
}

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessageRecord {
  id: string;
  role: ChatRole;
  content: string;
  userContent?: import("./workflow-read-thread-contract").WorkflowUserMessageContent[];
  blocks: MessageBlock[];
  createdAt: number;
  items: import("./workflow-read-thread-contract").WorkflowTurnItem[];
  startedAt?: number;
  completedAt?: number;
  modelId?: string;
  modelName?: string;
  timeline?: TimelineItem[];
  usage?: TokenUsage;
  isError?: boolean;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  totalTokens?: number;
  limitTokens?: number;
  modelContextWindowTokens?: number;
  maxOutputTokens?: number;
  raw?: unknown;
}

export interface ChatImageAttachment {
  id: string;
  name?: string;
  mimeType: string;
  dataUrl: string;
  size?: number;
}

export type MessageBlock =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "image"; image: ChatImageAttachment }
  | { id: string; type: "thinking"; text: string }
  | { id: string; type: "tool_call"; tool: ToolCallBlock }
  | { id: string; type: "tool_result"; result: ToolResultBlock }
  | { id: string; type: "error"; message: string };

export interface ToolCallBlock {
  id: string;
  name: string;
  input?: unknown;
  status?: "pending" | "running" | "completed" | "error" | "aborted";
}

export interface ToolResultBlock {
  id: string;
  toolName?: string;
  output: unknown;
  isError?: boolean;
}

export interface TimelineItem {
  id: string;
  type:
    | "thinking"
    | "tool_start"
    | "tool_delta"
    | "tool_result"
    | "status"
    | "memory_recall"
    | "error";
  label: string;
  detail?: string;
  createdAt: number;
  isError?: boolean;
  status?: "pending" | "running" | "completed" | "error" | "aborted";
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
}

export interface ChatSendRequest {
  sessionId: string;
  text: string;
  attachments?: unknown[];
  workMode?: AgentWorkMode;
  permissionMode?: AgentPermissionMode;
  deliveryMode?: "normal" | "steer";
  forceSend?: boolean;
  clientMessageId?: string;
}

export type ChatSendReceiptStatus =
  "started" | "queued" | "fallback" | "failed";

/**
 * Durable acknowledgement for renderer -> main message delivery. A resolved
 * receipt describes what the main process actually did; callers never need to
 * infer delivery from an exception string.
 */
export interface ChatSendReceipt {
  status: ChatSendReceiptStatus;
  sessionId: string;
  messageId: string;
  turnId?: string;
  reason?:
    | "turn_boundary"
    | "no_active_turn"
    | "no_window"
    | "missing_workspace"
    | "rejected";
  error?: string;
}

// ==================== Scheduled tasks ====================

export interface ScheduleTimeSpec {
  hour: number;
  minute: number;
}

export type ScheduledTaskScheduleConfig =
  | {
      mode: "cycle";
      cycleType: "daily";
      time: ScheduleTimeSpec;
    }
  | {
      mode: "cycle";
      cycleType: "weekly";
      weekdays: number[];
      time: ScheduleTimeSpec;
    }
  | {
      mode: "cycle";
      cycleType: "monthly";
      months: number[];
      dayOfMonth: number | "last";
      time: ScheduleTimeSpec;
    }
  | {
      mode: "interval";
      every: number;
      unit: "hours" | "days" | "weeks";
      /** 间隔任务的固定起算点，编辑任务时保持不变。 */
      anchorAt: number;
    }
  | {
      mode: "once";
      runAt: number;
    };

export interface ScheduledTaskEffectiveRange {
  /** 本地日期，格式 YYYY-MM-DD。 */
  start: string;
  /** 本地日期，格式 YYYY-MM-DD。 */
  end: string;
}

export type ScheduleNotificationChannel = "app" | "wecom" | "feishu";

/**
 * 设计稿中的完整交互配置。cron/runAt 继续保留作旧版本兼容字段，
 * 新任务的展示、编辑回显与下一次执行时间以该元数据为准。
 */
export interface ScheduledTaskMetadata {
  tags: string[];
  schedule: ScheduledTaskScheduleConfig;
  effectiveRange?: ScheduledTaskEffectiveRange;
  notificationChannels: ScheduleNotificationChannel[];
}

/** 定时任务定义（scheduled_tasks 表） */
export interface ScheduledTaskRecord {
  id: string;
  name: string;
  instruction: string;
  workspacePath: string;
  kind: "once" | "cron";
  /** kind='once'：触发时间戳(ms)，执行后任务自动完成 */
  runAt?: number;
  /** kind='cron'：5 段 cron 表达式（预设频率也归一化为 cron） */
  cronExpr?: string;
  enabled: boolean;
  /** 调度器缓存的下次触发时间 */
  nextRunAt?: number;
  lastRunAt?: number;
  lastRunStatus?: string;
  /** 连续失败次数，达 5 自动暂停 */
  failCount?: number;
  metadata?: ScheduledTaskMetadata;
  createdAt: number;
  updatedAt: number;
}

/** 创建/更新定时任务的输入 */
export interface ScheduledTaskInput {
  name: string;
  instruction: string;
  workspacePath: string;
  kind: "once" | "cron";
  runAt?: number;
  cronExpr?: string;
  metadata?: ScheduledTaskMetadata;
}

export type ScheduledTaskRunStatus =
  "running" | "success" | "failed" | "missed" | "no_window";

/** 定时任务执行记录（scheduled_task_runs 表） */
export interface ScheduledTaskRunRecord {
  id: string;
  taskId: string;
  sessionId?: string;
  status: ScheduledTaskRunStatus;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  /** ChatSendReceipt 序列化，便于排查投递结果 */
  receiptJson?: string;
  createdAt: number;
}

/** 主进程 → 渲染层的定时任务变更推送 */
export interface ScheduleChangedPayload {
  kind: "upsert" | "remove" | "run";
  /** run 事件也可能携带受影响任务的最新 record，渲染层可就地替换 */
  record?: ScheduledTaskRecord;
  run?: ScheduledTaskRunRecord;
}

export interface ChatResendRequest {
  sessionId: string;
  fromMessageId: string;
  text: string;
}

export interface ChatForkRequest {
  sessionId: string;
  upToMessageId?: string;
  lastTurnId?: string;
  title?: string;
}

export interface ChatRewindRequest {
  sessionId: string;
  userMessageId: string;
  dryRun?: boolean;
  confirmedFiles?: string[];
}

export interface ChatRewindResult {
  canRewind?: boolean;
  error?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
  raw?: unknown;
}

export interface ContextActionRequest {
  id: string;
  sessionId: string;
  reason: "compaction_limit" | "context_too_large" | "model_capability";
  title: string;
  detail?: string;
  largerModel?: {
    providerId: string;
    modelId: string;
    contextWindowTokens: number;
  };
  actions: Array<
    | "switch_to_larger_model"
    | "create_small_model_branch"
    | "new_session"
    | "continue_anyway"
  >;
}

export type AgentWorkMode = "execute" | "plan";
export type AgentSecurityMode = "request" | "auto-review" | "full-access";
export type AgentPermissionMode =
  "default" | "acceptEdits" | "bypassPermissions";
export type AgentSdkPermissionMode = AgentPermissionMode | "plan";
export type AgentSandboxMode =
  | "read-only"
  | "workspace-write"
  | "workspace-write-network"
  | "danger-full-access";
export type RuntimeKind = "sdk" | "binary" | "self-built";

export interface RuntimeDescriptor {
  id: RuntimeKind;
  name: string;
  description: string;
  status: "available" | "unavailable";
  statusReason?: string;
  capabilities: {
    forkThread: boolean;
    interruptTurn: boolean;
    setModel: boolean;
    setPermissionMode: boolean;
    registerTool: boolean;
    cancelTool: boolean;
    editMessage: boolean;
    sandbox: boolean;
  };
}

export interface RuntimeState {
  activeRuntimeId: RuntimeKind;
  activeRuntimeName: string;
  runtimes: RuntimeDescriptor[];
}

export interface ToolPermissionPolicy {
  rules?: Array<{
    pattern: string;
    action: "deny" | "ask" | "allow";
    description?: string;
  }>;
  allowedTools?: string[];
  disallowedTools?: string[];
  sensitiveToolAllowlist: string[];
  requireConfirmationForSensitiveTools: boolean;
}

export interface AgentSecurityRules {
  autoAllowPaths: string[];
  protectedPaths: string[];
  commandAllowlist: string[];
  commandAsklist: string[];
  networkAccess: "ask" | "allow" | "deny";
  allowedDomains: string[];
  deniedDomains: string[];
}

export interface EnterprisePolicy {
  allowLocalEndpointProfiles?: boolean;
  allowLocalMcpServers?: boolean;
  allowLocalToolProfiles?: boolean;
  allowLocalSkillDisable?: boolean;
  /* PRD 4.2.C: intranet security policy. */
  networkPolicy?: NetworkPolicy;
  redactionRules?: RedactionRule[];
  auditEnabled?: boolean;
  auditExportPath?: string;
}

/* PRD 4.2.C: network policy allowlist. */
export interface NetworkPolicy {
  enabled: boolean;
  allowedDomains: string[];
  blockPublicNetwork: boolean;
}

/* PRD 4.2.C: sensitive data redaction rules. */
export interface RedactionRule {
  id: string;
  name: string;
  pattern: string;
  replacement: string;
  enabled: boolean;
}

export interface AgentSettings {
  providers: ModelProviderConfig[];
  defaultModel: ModelSelection;
  activeRuntimeId?: RuntimeKind;
  runtimeConfigDir?: string;
  maxTurns: number;
  workMode: AgentWorkMode;
  securityMode: AgentSecurityMode;
  securityRules: AgentSecurityRules;
  permissionMode: AgentPermissionMode;
  permissionApprovalTimeoutMs: number;
  desktopNotificationsEnabled: boolean;
  friendlyTone?: boolean;
  customInstructions?: string;
  preventSleep?: boolean;
  outputStyle?: "default" | "coding" | "explanatory";
  memoryMode?: AgentMemoryMode;
  contextManagement?: ContextManagementSettings;
  toolPermissionPolicy?: ToolPermissionPolicy;
  autoMemoryEnabled: boolean;
  autoMemoryDirectory?: string;
  autoDreamEnabled?: boolean;
  thinkingEnabled: boolean;
  maxThinkingTokens: number;
  activeToolProfileId: string;
  toolProfiles: ToolProfile[];
  mcpServers: McpServerConfig[];
  imBotBindings: ImBotBindingsConfig;
  skillDirectories?: string[];
  disabledSkills: string[];
  enterprisePolicy?: EnterprisePolicy;
  enterpriseControlledSettings?: string[];
  sandboxEnabled?: boolean;
  sandboxMode?: AgentSandboxMode;
}

export type AgentMemoryMode = "workspace" | "session" | "off";
export interface ContextManagementSettings {
  warningThresholdPercent: number;
  compactThresholdPercent: number;
  restartThresholdPercent: number;
  autoCompactEnabled: boolean;
}
export type ModelEndpointProtocol =
  "openai-chat" | "openai-responses" | "anthropic";
export type ModelEndpointPurpose = "prod" | "test" | "dev";

export interface ModelSelection {
  providerId: string;
  modelId: string;
}

export interface ModelProviderEndpoint {
  id: string;
  name?: string;
  protocol: ModelEndpointProtocol;
  baseUrl: string;
  enabled: boolean;
  priority: number;
}

interface ModelProviderConfigBase {
  id: string;
  name: string;
  enabled: boolean;
  source?: "local" | "enterprise";
  locked?: boolean;
  apiKey?: string;
  apiKeyEnv?: string;
  purpose?: ModelEndpointPurpose;
  models: ModelOption[];
}

export interface BuiltinModelProviderConfig extends ModelProviderConfigBase {
  kind: "builtin";
  presetId: string;
}

export interface CustomModelProviderConfig extends ModelProviderConfigBase {
  kind: "custom";
  endpoints: ModelProviderEndpoint[];
}

export type ModelProviderConfig =
  BuiltinModelProviderConfig | CustomModelProviderConfig;

export interface EndpointTestResult {
  ok: boolean;
  status?: number;
  message: string;
  latencyMs?: number;
}

export interface EndpointModelsResult {
  ok: boolean;
  status?: number;
  message: string;
  latencyMs?: number;
  models: ModelOption[];
}

export interface AuditEventRecord {
  id: string;
  createdAt: number;
  workspacePath?: string;
  sessionId?: string;
  turnId?: string;
  endpointProfileId?: string;
  endpointProfileName?: string;
  toolSource?: string;
  toolName: string;
  inputSummary?: string;
  outputSummary?: string;
  status: string;
  isError?: boolean;
}

export interface ModelOption {
  id: string;
  label: string;
  enabled: boolean;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  supportsVision?: boolean;
  supportsThinking?: boolean;
}

export interface McpServerConfig {
  id: string;
  name: string;
  config: unknown;
  enabled: boolean;
  source?: "local" | "enterprise";
  locked?: boolean;
  lastStatus?: "untested" | "running" | "ok" | "error" | "disconnected";
  lastError?: string;
  tools?: string[];
  lastProbeTool?: string;
  lastProbeResult?: string;
}

export interface ImBotBindingsConfig {
  bots: ImBotInstance[];
  defaultWorkspacePath?: string;
  defaultToolProfileId?: string;
}

export type ImChannelKind = "wecom" | "feishu";

export type ImBotBindMode = "scan" | "manual";

export type ImBotStatus =
  "binding" | "connected" | "paused" | "needsRebind" | "error";

export type ImBotCapability =
  | "inboundTasks"
  | "taskNotifications"
  | "scheduledNotifications"
  | "permissionApprovals";

export interface ImBotInstance {
  id: string;
  channel: ImChannelKind;
  name: string;
  enabled: boolean;
  bindMode: ImBotBindMode;
  status: ImBotStatus;
  capabilities: ImBotCapability[];
  workspacePath?: string;
  toolProfileId?: string;
  tenantId?: string;
  tenantName?: string;
  botExternalId?: string;
  manualSecret?: string;
  chatId?: string;
  chatName?: string;
  createdAt?: number;
  updatedAt?: number;
  lastEventAt?: number;
  lastError?: string;
}

export interface SkillInfo {
  id: string;
  name: string;
  scope: "user" | "project" | "enterprise" | "marketplace";
  path: string;
  enabled: boolean;
  description?: string;
  permissions?: string[];
  mutable?: boolean;
  removable?: boolean;
  trusted?: boolean;
  integrityStatus?: "unchecked" | "verified" | "failed";
  version?: string;
}

export interface SkillDetail extends SkillInfo {
  content: string;
}

export interface SkillMarketplaceItem {
  slug: string;
  name: string;
  cnName?: string;
  description?: string;
  ownerHandle?: string;
  version?: string;
  downloads?: number;
  stars?: number;
  updatedAt?: number;
  installed: boolean;
  sourceUrl: string;
}

export interface SkillMarketplaceDetail extends SkillMarketplaceItem {
  content: string;
  changelog?: string;
  license?: string | null;
  securityStatus?: "clean" | "warning" | "suspicious" | "unknown";
  securitySummary?: string;
}

export interface SkillImportPreview {
  path: string;
  name: string;
  version?: string;
  entry: "SKILL.md";
}

export interface SkillMarketplaceListRequest {
  query?: string;
  cnName?: string;
  creator?: string;
  tagId?: string;
  limit?: number;
  pageNo?: number;
  pageSize?: number;
  cursor?: string;
}

export interface SkillMarketplaceListResponse {
  items: SkillMarketplaceItem[];
  nextCursor?: string;
  total?: number;
  hasMore: boolean;
}

export interface ToolProfile {
  id: string;
  name: string;
  description: string;
  source?: "local" | "enterprise";
  locked?: boolean;
  permissionMode: AgentSdkPermissionMode;
  allowedTools: string[];
  disallowedTools: string[];
}

export type AgentEvent =
  | { type: "turn_start"; sessionId: string; turnId: string }
  | {
      type: "turn_done";
      sessionId: string;
      turnId: string;
      reason: "success" | "error" | "aborted";
    }
  | { type: "text_delta"; sessionId: string; turnId: string; delta: string }
  | { type: "thinking_delta"; sessionId: string; turnId: string; delta: string }
  | {
      type: "tool_start";
      sessionId: string;
      turnId: string;
      id: string;
      name: string;
      input?: unknown;
    }
  | {
      type: "tool_delta";
      sessionId: string;
      turnId: string;
      id: string;
      name: string;
      partialInput: string;
      input?: unknown;
      isReady?: boolean;
    }
  | {
      type: "tool_result";
      sessionId: string;
      turnId: string;
      id: string;
      output: unknown;
      isError?: boolean;
    }
  | {
      type: "session_info";
      sessionId: string;
      turnId: string;
      skills: string[];
      slashCommands: string[];
      agents: string[];
    }
  | {
      type: "mcp_status";
      sessionId: string;
      turnId: string;
      servers: unknown[];
      tools?: string[];
    }
  | {
      type: "memory_recall";
      sessionId: string;
      turnId: string;
      mode: "select" | "synthesize";
      memories: MemoryRecallRecord[];
    }
  | {
      type: "context_usage";
      sessionId: string;
      turnId: string;
      phase: "turn_start" | "turn_end";
      usage: ContextUsageRecord;
    }
  | {
      type: "context_policy";
      sessionId: string;
      turnId: string;
      level: "warning" | "compact" | "restart";
      message: string;
      percentage?: number;
    }
  | {
      type: "context_compaction";
      sessionId: string;
      turnId?: string;
      phase: "started" | "completed" | "blocked";
      reason: "preflight" | "mid_turn" | "turn_end" | "model_switch" | "manual";
      message?: string;
      actionRequest?: ContextActionRequest;
    }
  | {
      type: "runtime_status";
      sessionId: string;
      turnId: string;
      label: string;
      detail?: string;
      status?: "pending" | "running" | "completed" | "error";
    }
  | {
      type: "task_event";
      sessionId: string;
      turnId: string;
      id: string;
      label: string;
      detail?: string;
      status?: "pending" | "running" | "completed" | "error";
    }
  | {
      type: "prompt_suggestion";
      sessionId: string;
      turnId: string;
      suggestion: string;
    }
  | { type: "usage"; sessionId: string; turnId: string; usage: TokenUsage }
  | {
      type: "result";
      sessionId: string;
      turnId: string;
      content: string;
      sdkSessionId?: string;
    }
  | { type: "error"; sessionId: string; turnId: string; error: string };

export interface ContextUsageRecord {
  totalTokens?: number;
  maxTokens?: number;
  percentage?: number;
  model?: string;
  categories?: Array<{
    name: string;
    tokens: number;
    isDeferred?: boolean;
  }>;
  memoryFiles?: Array<{
    path: string;
    type: string;
    tokens: number;
  }>;
  mcpTools?: Array<{
    name: string;
    serverName: string;
    tokens: number;
    isLoaded?: boolean;
  }>;
  apiUsage?: ApiUsageCounters;
  raw?: unknown;
}

export interface ApiUsageCounters {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface MemoryRecallRecord {
  path: string;
  scope: "personal" | "team";
  content?: string;
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

export interface FileStat {
  size: number;
  modifiedAt: number;
}

export type MemoryFileKind = "project" | "local" | "auto";

export interface MemoryFileRecord {
  id: string;
  path: string;
  label: string;
  kind: MemoryFileKind;
  scope: string;
  exists: boolean;
  size?: number;
  modifiedAt?: number;
}

export interface PermissionDialogRequest {
  id: string;
  sessionId?: string;
  turnId?: string;
  toolName: string;
  cwd?: string;
  reason: string;
  inputSummary: string;
  timeout?: number;
  expiresAt?: number;
  /** 由 SDK suggestions 与 Marloues 的安全策略共同计算，不由 renderer 推断。 */
  options?: {
    allowOnce: boolean;
    allowSession: boolean;
    denyWithReason: boolean;
  };
}

export type PermissionDialogScope = "once" | "session";

export interface AuthSession {
  id?: string | number;
  username: string;
  email?: string;
  displayName?: string;
  provider?: string; // "local" | "sso"
  userId?: string;
  env?: string;
  detail?: Record<string, unknown>;
  expiresAt: number;
}

export interface AuthStatus {
  isAuthenticated: boolean;
  hasAccount: boolean;
  session?: AuthSession;
}

export interface AuthLoginResult extends AuthStatus {
  message?: string;
}

export interface MarlouesAPI {
  auth: {
    getStatus(): Promise<AuthStatus>;
    openLogin(): Promise<AuthLoginResult>;
    openRegister(): Promise<AuthLoginResult>;
    logout(): Promise<void>;
    onStatusChanged(callback: (status: AuthStatus) => void): () => void;
  };
  app: {
    platform: NodeJS.Platform;
    getVersion(): Promise<string>;
    getVersionInfo(): Promise<AppVersionInfo>;
    markRendererReady(info: RendererReadyInfo): Promise<RendererReadyReceipt>;
    exportDiagnostics(): Promise<string | null>;
  };
  update: {
    getState(): Promise<UpdateState>;
    getPreferences(): Promise<UpdatePreferences>;
    savePreferences(preferences: UpdatePreferences): Promise<UpdatePreferences>;
    check(): Promise<UpdateState>;
    download(): Promise<UpdateState>;
    installNow(): Promise<void>;
    onState(callback: (state: UpdateState) => void): () => void;
  };
  window: {
    minimize(): void;
    maximize(): void;
    setMaximized(maximized: boolean): Promise<boolean>;
    close(): void;
    isMaximized(): Promise<boolean>;
    setTheme(
      mode: string,
      background: string,
      nativeTheme: "system" | "dark" | "light",
    ): void;
    onMaximizedChanged(callback: (maximized: boolean) => void): () => void;
    onMaximizedChange(callback: (maximized: boolean) => void): () => void;
  };
  workspace: {
    select(): Promise<WorkspaceInfo | null>;
    switch(workspaceId: string): Promise<WorkspaceInfo | null>;
    rename(workspaceId: string, name: string): Promise<WorkspaceInfo | null>;
    remove(workspaceId: string): Promise<WorkspaceInfo | null>;
    getCurrent(): Promise<WorkspaceInfo | null>;
    getSettings(): Promise<WorkspaceSettings>;
    getGitContext(
      workspaceId: string,
      workspacePath?: string,
    ): Promise<WorkspaceGitContext | null>;
    openInExplorer(workspaceId: string): Promise<void>;
  };
  fs: {
    listDir(dirPath: string): Promise<DirEntry[]>;
    readFile(filePath: string): Promise<string>;
    stat(filePath: string): Promise<FileStat>;
  };
  memory: {
    list(): Promise<MemoryFileRecord[]>;
    read(fileId: string): Promise<string>;
    write(fileId: string, content: string): Promise<MemoryFileRecord>;
  };
  config: {
    getAgentSettings(): Promise<AgentSettings>;
    saveAgentSettings(settings: AgentSettings): Promise<void>;
    testEndpointProfile(
      profile: ModelProviderConfig,
      endpointId?: string,
    ): Promise<EndpointTestResult>;
    testEndpointModel(
      profile: ModelProviderConfig,
      modelId: string,
      endpointId?: string,
    ): Promise<EndpointTestResult>;
    listEndpointModels(
      profile: ModelProviderConfig,
      endpointId?: string,
    ): Promise<EndpointModelsResult>;
  };
  runtime: {
    getState(): Promise<RuntimeState>;
    switch(runtimeId: RuntimeKind): Promise<RuntimeState>;
    listModels(): Promise<ModelOption[]>;
    setModel(providerId: string, modelId: string): Promise<RuntimeState>;
  };
  mcp: {
    listServers(): Promise<McpServerConfig[]>;
    saveServers(servers: McpServerConfig[]): Promise<McpServerConfig[]>;
    testServer(server: McpServerConfig): Promise<McpServerConfig>;
    refreshStatus(): Promise<McpServerConfig[]>;
    listTools(): Promise<string[]>;
  };
  audit: {
    list(limit?: number): Promise<AuditEventRecord[]>;
  };
  im: {
    getConfig(): Promise<import("./im/im-types").ImChannelSecretsConfig>;
    saveConfig(
      channels: import("./im/im-types").ImChannelSecretsConfig,
    ): Promise<{ ok: true }>;
    testChannel(
      channel: import("./im/im-types").ImChannelId,
    ): Promise<import("./im/im-ipc").ImChannelTestResult>;
    listSessions(): Promise<import("./im/im-ipc").ImListSessionsResponse>;
    onStatus(
      callback: (status: import("./im/im-types").ImChannelStatus) => void,
    ): () => void;
    onSessionsChanged(callback: () => void): () => void;
    generateWecomQr(): Promise<import("./im/im-ipc").WecomQrGenerateResponse>;
    pollWecomQr(
      scode: string,
    ): Promise<import("./im/im-ipc").WecomQrPollResponse>;
    registerFeishuApp(): Promise<import("./im/im-ipc").FeishuQrRegisterResult>;
    cancelFeishuRegister(): Promise<void>;
    onFeishuQrCode(
      callback: (payload: import("./im/im-ipc").FeishuQrCodePush) => void,
    ): () => void;
    onFeishuQrStatus(
      callback: (payload: import("./im/im-ipc").FeishuQrStatusPush) => void,
    ): () => void;
  };
  schedule: {
    list(): Promise<ScheduledTaskRecord[]>;
    create(input: ScheduledTaskInput): Promise<ScheduledTaskRecord>;
    update(
      taskId: string,
      input: Partial<ScheduledTaskInput>,
    ): Promise<ScheduledTaskRecord>;
    remove(taskId: string): Promise<void>;
    toggle(taskId: string): Promise<ScheduledTaskRecord>;
    runNow(taskId: string): Promise<ScheduledTaskRunRecord | null>;
    listRuns(taskId: string, limit?: number): Promise<ScheduledTaskRunRecord[]>;
    onChanged(callback: (payload: ScheduleChangedPayload) => void): () => void;
  };
  skill: {
    list(): Promise<SkillInfo[]>;
    selectImportFolder(): Promise<SkillImportPreview | null>;
    importFolder(path?: string): Promise<SkillInfo | null>;
    toggle(skillId: string, enabled: boolean): Promise<SkillInfo[]>;
    remove(skillId: string): Promise<SkillInfo[]>;
    getDetail(skillId: string): Promise<SkillDetail>;
    marketplaceList(
      request?: SkillMarketplaceListRequest,
    ): Promise<SkillMarketplaceListResponse>;
    marketplaceDetail(
      slug: string,
      version?: string,
    ): Promise<SkillMarketplaceDetail>;
    marketplaceInstall(slug: string, version?: string): Promise<SkillInfo[]>;
  };
  chat: {
    listSessions(): Promise<ChatSessionRecord[]>;
    listAllSessions(): Promise<ChatSessionRecord[]>;
    searchSessions(
      query: string,
      limit?: number,
    ): Promise<SessionSearchResult[]>;
    createSession(): Promise<ChatSessionRecord>;
    deleteSession(sessionId: string): Promise<void>;
    updateSessionTitle(sessionId: string, title: string): Promise<void>;
    toggleSessionPinned(sessionId: string): Promise<void>;
    forkSession(request: ChatForkRequest): Promise<ChatSessionRecord>;
    rewindFiles(request: ChatRewindRequest): Promise<ChatRewindResult>;
    exportSession(sessionId: string): Promise<string | null>;
    send(request: ChatSendRequest): Promise<ChatSendReceipt>;
    resendFromMessage(
      request: ChatResendRequest,
    ): Promise<ChatSessionRecord & { requestId: string }>;
    abort(requestId: string): Promise<void>;
    cancelTool(toolCallId: string): Promise<void>;
    compact(sessionId: string): Promise<void>;
    getPendingState(sessionId?: string): Promise<PendingStateSnapshot>;
    resumeOutbox(
      sessionId: string,
      messageId?: string,
    ): Promise<ChatSendReceipt>;
    cancelSteer(
      sessionId: string,
      messageId: string,
    ): Promise<SteerActionReceipt>;
    applySteerNow(
      sessionId: string,
      messageId: string,
    ): Promise<SteerActionReceipt>;
    reorderSteers(
      sessionId: string,
      messageIds: string[],
    ): Promise<SteerActionReceipt>;
    onPendingState(
      callback: (snapshot: PendingStateSnapshot) => void,
    ): () => void;
    readThread(sessionId: string): Promise<WorkflowReadThreadResponse | null>;
    onReadThread(
      callback: (snapshot: WorkflowReadThreadResponse | null) => void,
    ): () => void;
    onEvent(
      callback: (event: import("./ui-protocol").UIEvent) => void,
    ): () => void;
    onItemEvent(callback: (event: unknown) => void): () => void;
    onPermissionRequest(
      callback: (request: PermissionDialogRequest) => void,
    ): () => void;
    respondToPermission(
      requestId: string,
      approved: boolean,
      scope?: PermissionDialogScope,
      reason?: string,
    ): void;
  };
  terminal: {
    spawn(cwd: string): Promise<string>;
    write(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, cols: number, rows: number): Promise<void>;
    onData(callback: (sessionId: string, data: string) => void): () => void;
    onExit(callback: (sessionId: string, exitCode: number) => void): () => void;
    list(): Promise<
      Array<{
        sessionId: string;
        threadId?: string;
        pid: number;
        process: string;
        cwd: string;
        createdAt: number;
        lastOutputAt: number;
        rendererAttached: boolean;
      }>
    >;
    history(sessionId: string): Promise<string>;
    kill(sessionId: string): Promise<void>;
  };
  browser: {
    viewNavigate(pageId: string, url: string): Promise<void>;
    goBack(pageId: string): Promise<void>;
    goForward(pageId: string): Promise<void>;
    reload(pageId: string): Promise<void>;
    navigationState(pageId: string): Promise<{
      canGoBack: boolean;
      canGoForward: boolean;
      isLoading: boolean;
    }>;
    newPage(url: string, threadId?: string): Promise<string>;
    closePage(pageId: string): Promise<void>;
    listPages(threadId?: string): Promise<
      Array<{
        pageId: string;
        threadId?: string;
        url: string;
        title: string;
        createdAt: number;
        lastActivityAt: number;
      }>
    >;
    screenshot(): Promise<string>;
    registerWebview(pageId: string, webContentsId: number): Promise<void>;
    onUrlChanged(
      callback: (threadId: string, pageId: string, url: string) => void,
    ): () => void;
    onPageRevealRequested(
      callback: (
        threadId: string,
        pageId: string,
        url: string,
        title: string,
      ) => void,
    ): () => void;
    onTitleChanged(
      callback: (pageId: string, title: string) => void,
    ): () => void;
    onLoadFailed(
      callback: (
        pageId: string,
        error: { url: string; errorCode: number; errorDescription: string },
      ) => void,
    ): () => void;
    onNavigationStateChanged(
      callback: (
        pageId: string,
        state: {
          canGoBack: boolean;
          canGoForward: boolean;
          isLoading: boolean;
        },
      ) => void,
    ): () => void;
    onNavigationBlocked(
      callback: (pageId: string, url: string, host: string) => void,
    ): () => void;
    onBrowserEvent(
      callback: (pageId: string, type: string, data: unknown) => void,
    ): () => void;
    setCommentMode(
      pageId: string,
      enabled: boolean,
      options?: {
        selectionMode?: string;
        theme?: string;
        palette?: string;
        placeholder?: string;
        clearComments?: boolean;
      },
    ): Promise<{
      success: boolean;
      pageId: string;
      annotationEnabled: boolean;
    }>;
    getCommentEvents(
      pageId: string,
      afterEventId: number,
    ): Promise<{
      commentEvents: Array<{
        eventId: number;
        type: string;
        pageId: string;
        commentId?: number;
        pageUrl?: string;
        payload?: unknown;
        ts: number;
      }>;
      maxCommentEventId: number;
      annotationEnabled: boolean;
    }>;
    ackCommentEvents(
      pageId: string,
      throughEventId: number,
    ): Promise<{ success: boolean }>;
    clearComments(pageId: string): Promise<{ success: boolean }>;
    removeComment(
      pageId: string,
      commentId: number,
    ): Promise<{ success: boolean }>;
    onCommentEvent(
      callback: (pageId: string, event: unknown) => void,
    ): () => void;
  };
}

export const IPC = {
  AUTH_GET_STATUS: "auth:get-status",
  AUTH_OPEN_LOGIN: "auth:open-login",
  AUTH_OPEN_REGISTER: "auth:open-register",
  AUTH_LOGOUT: "auth:logout",
  AUTH_STATUS_CHANGED: "auth:status-changed",
  APP_GET_VERSION: "app:get-version",
  APP_GET_VERSION_INFO: "app:get-version-info",
  APP_RENDERER_READY: "app:renderer-ready",
  APP_EXPORT_DIAGNOSTICS: "app:export-diagnostics",
  UPDATE_GET_STATE: "update:get-state",
  UPDATE_GET_PREFERENCES: "update:get-preferences",
  UPDATE_SAVE_PREFERENCES: "update:save-preferences",
  UPDATE_CHECK: "update:check",
  UPDATE_DOWNLOAD: "update:download",
  UPDATE_INSTALL_NOW: "update:install-now",
  UPDATE_STATE: "update:state",
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_MAXIMIZE: "window:maximize",
  WINDOW_SET_MAXIMIZED: "window:set-maximized",
  WINDOW_CLOSE: "window:close",
  WINDOW_IS_MAXIMIZED: "window:is-maximized",
  WINDOW_MAXIMIZED_CHANGED: "window:maximized-changed",
  WINDOW_SET_THEME: "window:set-theme",
  WORKSPACE_SELECT: "workspace:select",
  WORKSPACE_SWITCH: "workspace:switch",
  WORKSPACE_RENAME: "workspace:rename",
  WORKSPACE_REMOVE: "workspace:remove",
  WORKSPACE_GET_CURRENT: "workspace:get-current",
  WORKSPACE_GET_SETTINGS: "workspace:get-settings",
  WORKSPACE_GET_GIT_CONTEXT: "workspace:get-git-context",
  WORKSPACE_OPEN_IN_EXPLORER: "workspace:open-in-explorer",
  FS_LIST_DIR: "fs:list-dir",
  FS_READ_FILE: "fs:read-file",
  FS_STAT: "fs:stat",
  MEMORY_LIST: "memory:list",
  MEMORY_READ: "memory:read",
  MEMORY_WRITE: "memory:write",
  CONFIG_GET_AGENT_SETTINGS: "config:get-agent-settings",
  CONFIG_SAVE_AGENT_SETTINGS: "config:save-agent-settings",
  CONFIG_TEST_ENDPOINT_PROFILE: "config:test-endpoint-profile",
  CONFIG_TEST_ENDPOINT_MODEL: "config:test-endpoint-model",
  CONFIG_LIST_ENDPOINT_MODELS: "config:list-endpoint-models",
  RUNTIME_GET_STATE: "runtime:get-state",
  RUNTIME_SWITCH: "runtime:switch",
  RUNTIME_LIST_MODELS: "runtime:list-models",
  RUNTIME_SET_MODEL: "runtime:set-model",
  MCP_LIST_SERVERS: "mcp:list-servers",
  MCP_SAVE_SERVERS: "mcp:save-servers",
  MCP_TEST_SERVER: "mcp:test-server",
  MCP_REFRESH_STATUS: "mcp:refresh-status",
  MCP_LIST_TOOLS: "mcp:list-tools",
  AUDIT_LIST: "audit:list",
  SCHEDULE_LIST: "schedule:list",
  SCHEDULE_CREATE: "schedule:create",
  SCHEDULE_UPDATE: "schedule:update",
  SCHEDULE_REMOVE: "schedule:remove",
  SCHEDULE_TOGGLE: "schedule:toggle",
  SCHEDULE_RUN_NOW: "schedule:run-now",
  SCHEDULE_LIST_RUNS: "schedule:list-runs",
  SCHEDULE_CHANGED: "schedule:changed",
  SKILL_LIST: "skill:list",
  SKILL_SELECT_IMPORT_FOLDER: "skill:select-import-folder",
  SKILL_IMPORT_FOLDER: "skill:import-folder",
  SKILL_TOGGLE: "skill:toggle",
  SKILL_REMOVE: "skill:remove",
  SKILL_GET_DETAIL: "skill:get-detail",
  SKILL_MARKETPLACE_LIST: "skill:marketplace-list",
  SKILL_MARKETPLACE_DETAIL: "skill:marketplace-detail",
  SKILL_MARKETPLACE_INSTALL: "skill:marketplace-install",
  CHAT_LIST_SESSIONS: "chat:list-sessions",
  CHAT_LIST_ALL_SESSIONS: "chat:list-all-sessions",
  CHAT_SEARCH_SESSIONS: "chat:search-sessions",
  CHAT_CREATE_SESSION: "chat:create-session",
  CHAT_DELETE_SESSION: "chat:delete-session",
  CHAT_UPDATE_SESSION_TITLE: "chat:update-session-title",
  CHAT_TOGGLE_SESSION_PINNED: "chat:toggle-session-pinned",
  CHAT_FORK_SESSION: "chat:fork-session",
  CHAT_REWIND_FILES: "chat:rewind-files",
  CHAT_EXPORT_SESSION: "chat:export-session",
  CHAT_SEND: "chat:send",
  CHAT_RESEND_FROM_MESSAGE: "chat:resend-from-message",
  CHAT_ABORT: "chat:abort",
  CHAT_CANCEL_TOOL: "chat:cancel-tool",
  CHAT_GET_PENDING_STATE: "chat:get-pending-state",
  CHAT_RESUME_OUTBOX: "chat:resume-outbox",
  CHAT_CANCEL_STEER: "chat:cancel-steer",
  CHAT_APPLY_STEER_NOW: "chat:apply-steer-now",
  CHAT_REORDER_STEERS: "chat:reorder-steers",
  CHAT_PENDING_STATE_UPDATE: "chat:pending-state-update",
  CHAT_READ_THREAD: "chat:read-thread",
  CHAT_READ_THREAD_UPDATE: "chat:read-thread-update",
  CHAT_COMPACT: "chat:compact",
  CHAT_EVENT: "chat:event",
  CHAT_ITEM_EVENT: "chat:item-event",
  CHAT_PERMISSION_REQUEST: "chat:permission-request",
  CHAT_PERMISSION_RESPONSE: "chat:permission-response",
  TERMINAL_SPAWN: "terminal:spawn",
  TERMINAL_DATA: "terminal:data",
  TERMINAL_WRITE: "terminal:write",
  TERMINAL_RESIZE: "terminal:resize",
  TERMINAL_KILL: "terminal:kill",
  TERMINAL_LIST: "terminal:list",
  TERMINAL_HISTORY: "terminal:history",
  TERMINAL_EXIT: "terminal:exit",
  BROWSER_VIEW_NAVIGATE: "browser:view-navigate",
  BROWSER_GO_BACK: "browser:go-back",
  BROWSER_GO_FORWARD: "browser:go-forward",
  BROWSER_RELOAD: "browser:reload",
  BROWSER_NAVIGATION_STATE: "browser:navigation-state",
  BROWSER_NAVIGATION_STATE_CHANGED: "browser:navigation-state-changed",
  BROWSER_NEW_PAGE: "browser:new-page",
  BROWSER_CLOSE_PAGE: "browser:close-page",
  BROWSER_REGISTER_WEBVIEW: "browser:register-webview",
  BROWSER_LIST_PAGES: "browser:list-pages",
  BROWSER_SCREENSHOT: "browser:screenshot",
  BROWSER_URL_CHANGED: "browser:url-changed",
  BROWSER_PAGE_REVEAL_REQUESTED: "browser:page-reveal-requested",
  BROWSER_TITLE_CHANGED: "browser:title-changed",
  BROWSER_LOAD_FAILED: "browser:load-failed",
  BROWSER_NAVIGATION_BLOCKED: "browser:navigation-blocked",
  BROWSER_EVENT: "browser:event",
  BROWSER_SET_COMMENT_MODE: "browser:set-comment-mode",
  BROWSER_GET_COMMENT_EVENTS: "browser:get-comment-events",
  BROWSER_ACK_COMMENT_EVENTS: "browser:ack-comment-events",
  BROWSER_CLEAR_COMMENTS: "browser:clear-comments",
  BROWSER_REMOVE_COMMENT: "browser:remove-comment",
  BROWSER_COMMENT_EVENT: "browser:comment-event",
} as const;
