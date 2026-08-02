import type { WorkflowReadThreadResponse } from "./workflow-read-thread-contract";
export interface WorkspaceInfo {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: number;
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

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessageRecord {
  id: string;
  role: ChatRole;
  content: string;
  userContent?: import("./workflow-read-thread-contract").WorkflowUserMessageContent[];
  blocks: MessageBlock[];
  createdAt: number;
  items: import("./workflow-types").MessageItem[];
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
  permissionMode?: AgentPermissionMode;
  forceSend?: boolean;
  clientMessageId?: string;
}

export interface ChatResendRequest {
  sessionId: string;
  fromMessageId: string;
  text: string;
}

export interface ChatForkRequest {
  sessionId: string;
  upToMessageId?: string;
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
export type AgentPermissionMode =
  "default" | "acceptEdits" | "bypassPermissions";
export type AgentSdkPermissionMode = AgentPermissionMode | "plan";
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
  permissionMode: AgentPermissionMode;
  permissionApprovalTimeoutMs: number;
  desktopNotificationsEnabled: boolean;
  friendlyTone?: boolean;
  customInstructions?: string;
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
  skillDirectories?: string[];
  disabledSkills: string[];
  enterprisePolicy?: EnterprisePolicy;
  enterpriseControlledSettings?: string[];
}

export type AgentMemoryMode = "workspace" | "session" | "off";
export interface ContextManagementSettings {
  warningThresholdPercent: number;
  compactThresholdPercent: number;
  restartThresholdPercent: number;
  autoCompactEnabled: boolean;
}
export type ModelProviderType = "openai-compatible";
export type ModelEndpointPurpose = "prod" | "test" | "dev";

export interface ModelSelection {
  providerId: string;
  modelId: string;
}

export interface ModelProviderConfig {
  id: string;
  name: string;
  type: ModelProviderType;
  enabled: boolean;
  source?: "local" | "enterprise";
  locked?: boolean;
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  purpose?: ModelEndpointPurpose;
  models: ModelOption[];
}

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

export interface SkillMarketplaceListRequest {
  query?: string;
  limit?: number;
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
  raw?: unknown;
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
}

export type PermissionDialogScope = "once" | "session";

export interface AuthSession {
  id?: string | number;
  username: string;
  email?: string;
  displayName?: string;
  provider?: string;
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
    exportDiagnostics(): Promise<string | null>;
  };
  window: {
    minimize(): void;
    maximize(): void;
    close(): void;
    isMaximized(): Promise<boolean>;
    onMaximizedChanged(callback: (maximized: boolean) => void): () => void;
  };
  workspace: {
    select(): Promise<WorkspaceInfo | null>;
    switch(workspaceId: string): Promise<WorkspaceInfo | null>;
    rename(workspaceId: string, name: string): Promise<WorkspaceInfo | null>;
    remove(workspaceId: string): Promise<WorkspaceInfo | null>;
    getCurrent(): Promise<WorkspaceInfo | null>;
    getSettings(): Promise<WorkspaceSettings>;
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
    ): Promise<EndpointTestResult>;
    testEndpointModel(
      profile: ModelProviderConfig,
      modelId: string,
    ): Promise<EndpointTestResult>;
    listEndpointModels(
      profile: ModelProviderConfig,
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
  skill: {
    list(): Promise<SkillInfo[]>;
    importFolder(): Promise<SkillInfo | null>;
    toggle(skillId: string, enabled: boolean): Promise<SkillInfo[]>;
    remove(skillId: string): Promise<SkillInfo[]>;
    getDetail(skillId: string): Promise<SkillDetail>;
    marketplaceList(
      request?: SkillMarketplaceListRequest,
    ): Promise<SkillMarketplaceListResponse>;
    marketplaceDetail(slug: string): Promise<SkillMarketplaceDetail>;
    marketplaceInstall(slug: string): Promise<SkillInfo[]>;
  };
  chat: {
    listSessions(): Promise<ChatSessionRecord[]>;
    listAllSessions(): Promise<ChatSessionRecord[]>;
    createSession(): Promise<ChatSessionRecord>;
    deleteSession(sessionId: string): Promise<void>;
    updateSessionTitle(sessionId: string, title: string): Promise<void>;
    toggleSessionPinned(sessionId: string): Promise<void>;
    forkSession(request: ChatForkRequest): Promise<ChatSessionRecord>;
    rewindFiles(request: ChatRewindRequest): Promise<ChatRewindResult>;
    exportSession(sessionId: string): Promise<string | null>;
    send(request: ChatSendRequest): Promise<string>;
    resendFromMessage(
      request: ChatResendRequest,
    ): Promise<ChatSessionRecord & { requestId: string }>;
    abort(requestId: string): Promise<void>;
    cancelTool(toolCallId: string): Promise<void>;
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
}

export const IPC = {
  AUTH_GET_STATUS: "auth:get-status",
  AUTH_OPEN_LOGIN: "auth:open-login",
  AUTH_OPEN_REGISTER: "auth:open-register",
  AUTH_LOGOUT: "auth:logout",
  AUTH_STATUS_CHANGED: "auth:status-changed",
  APP_GET_VERSION: "app:get-version",
  APP_EXPORT_DIAGNOSTICS: "app:export-diagnostics",
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_MAXIMIZE: "window:maximize",
  WINDOW_CLOSE: "window:close",
  WINDOW_IS_MAXIMIZED: "window:is-maximized",
  WINDOW_MAXIMIZED_CHANGED: "window:maximized-changed",
  WORKSPACE_SELECT: "workspace:select",
  WORKSPACE_SWITCH: "workspace:switch",
  WORKSPACE_RENAME: "workspace:rename",
  WORKSPACE_REMOVE: "workspace:remove",
  WORKSPACE_GET_CURRENT: "workspace:get-current",
  WORKSPACE_GET_SETTINGS: "workspace:get-settings",
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
  SKILL_LIST: "skill:list",
  SKILL_IMPORT_FOLDER: "skill:import-folder",
  SKILL_TOGGLE: "skill:toggle",
  SKILL_REMOVE: "skill:remove",
  SKILL_GET_DETAIL: "skill:get-detail",
  SKILL_MARKETPLACE_LIST: "skill:marketplace-list",
  SKILL_MARKETPLACE_DETAIL: "skill:marketplace-detail",
  SKILL_MARKETPLACE_INSTALL: "skill:marketplace-install",
  CHAT_LIST_SESSIONS: "chat:list-sessions",
  CHAT_LIST_ALL_SESSIONS: "chat:list-all-sessions",
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
  CHAT_READ_THREAD: "chat:read-thread",
  CHAT_READ_THREAD_UPDATE: "chat:read-thread-update",
  CHAT_EVENT: "chat:event",
  CHAT_ITEM_EVENT: "chat:item-event",
  CHAT_PERMISSION_REQUEST: "chat:permission-request",
  CHAT_PERMISSION_RESPONSE: "chat:permission-response",
} as const;
