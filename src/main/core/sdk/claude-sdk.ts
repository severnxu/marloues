/**
 * Claude SDK loader — dynamic import wrapper.
 * 使用动态 import() 加载 @anthropic-ai/claude-agent-sdk，
 * 避免 Electron 预加载时 SDK 的 native 模块出现问题.
 *
 * 这是从 marloues 搬过来的跑通的代码.
 */

export interface ClaudeSdkModule {
  query: (params: { prompt: string | AsyncIterable<unknown>; options?: Record<string, unknown> }) => ClaudeQuery;
  forkSession?: (sessionId: string, options?: Record<string, unknown>) => Promise<{ sessionId: string }>;
  getSessionMessages?: (sessionId: string, options?: Record<string, unknown>) => Promise<unknown[]>;
  deleteSession?: (sessionId: string, options?: Record<string, unknown>) => Promise<void>;
  listSessions?: (options?: Record<string, unknown>) => Promise<Array<{ session_id: string }>>;
  renameSession?: (sessionId: string, title: string, options?: Record<string, unknown>) => Promise<void>;
}

export interface ClaudeQuery extends AsyncIterable<unknown> {
  interrupt?: () => Promise<void>;
  close?: () => void;
  getContextUsage?: () => Promise<unknown>;
  setPermissionMode?: (mode: string) => Promise<void>;
  setModel?: (model?: string) => Promise<void>;
  setMaxThinkingTokens?: (maxThinkingTokens: number | null) => Promise<void>;
  applyFlagSettings?: (settings: Record<string, unknown>) => Promise<void>;
  initializationResult?: () => Promise<unknown>;
  supportedCommands?: () => Promise<unknown[]>;
  supportedModels?: () => Promise<unknown[]>;
  supportedAgents?: () => Promise<unknown[]>;
  mcpServerStatus?: () => Promise<unknown[]>;
  usage?: () => Promise<unknown>;
  readFile?: (path: string, options?: Record<string, unknown>) => Promise<unknown>;
  reloadPlugins?: () => Promise<unknown>;
  reloadSkills?: () => Promise<unknown>;
  accountInfo?: () => Promise<unknown>;
  rewindFiles?: (userMessageId: string, options?: { dryRun?: boolean }) => Promise<unknown>;
  seedReadState?: (path: string, mtime: number) => Promise<void>;
  reconnectMcpServer?: (serverName: string) => Promise<void>;
  toggleMcpServer?: (serverName: string, enabled: boolean) => Promise<void>;
  setMcpServers?: (servers: Record<string, unknown>) => Promise<unknown>;
  streamInput?: (stream: AsyncIterable<unknown>) => Promise<void>;
  stopTask?: (taskId: string) => Promise<void>;
  backgroundTasks?: (toolUseId?: string) => Promise<boolean>;
}

let sdkPromise: Promise<ClaudeSdkModule> | null = null;
let queryOverride: ((prompt: string | AsyncIterable<unknown>, options: Record<string, unknown>) => Promise<ClaudeQuery> | ClaudeQuery) | null = null;

async function loadSdk(): Promise<ClaudeSdkModule> {
  if (!sdkPromise) {
    sdkPromise = import("@anthropic-ai/claude-agent-sdk")
      .then((mod) => {
        // SDK 使用 named exports，query 是直接导出的函数
        return mod as unknown as ClaudeSdkModule;
      })
      .catch((error) => {
        sdkPromise = null; // 允许重试
        throw new Error(
          `Failed to load @anthropic-ai/claude-agent-sdk.\n` +
          `请先安装依赖：cd C:/workspace/marloues && npm install\n${String(error)}`,
        );
      });
  }
  return sdkPromise;
}

/**
 * 调用 Claude SDK 的 query() 函数.
 * prompt: 用户消息（string）或流式输入（AsyncIterable）
 * options: SDK Options 对象
 * 返回：ClaudeQuery（AsyncIterable<SDKMessage> + 控制方法）
 */
export async function queryClaude(
  prompt: string | AsyncIterable<unknown>,
  options: Record<string, unknown> = {},
): Promise<ClaudeQuery> {
  if (queryOverride) return queryOverride(prompt, options);
  const sdk = await loadSdk();
  return sdk.query({ prompt, options });
}

export function setClaudeQueryOverrideForTests(
  override: ((prompt: string | AsyncIterable<unknown>, options: Record<string, unknown>) => Promise<ClaudeQuery> | ClaudeQuery) | null,
): void {
  queryOverride = override;
}

/**
 * 获取 SDK 模块（用于调用 forkSession 等高级功能）
 */
export async function getClaudeSdk(): Promise<ClaudeSdkModule> {
  return loadSdk();
}

/**
 * Fork 一个 SDK session（用于分支对话）
 */
export async function forkClaudeSession(
  sessionId: string,
  options: Record<string, unknown> = {},
): Promise<{ sessionId: string }> {
  const sdk = await loadSdk();
  if (!sdk.forkSession) throw new Error("当前 SDK 版本不支持 forkSession。");
  return sdk.forkSession(sessionId, options);
}

/**
 * 获取 SDK session 的消息历史
 */
export async function getClaudeSessionMessages(
  sessionId: string,
  options: Record<string, unknown> = {},
): Promise<unknown[]> {
  const sdk = await loadSdk();
  if (!sdk.getSessionMessages) throw new Error("当前 SDK 版本不支持 getSessionMessages。");
  return sdk.getSessionMessages(sessionId, options);
}
