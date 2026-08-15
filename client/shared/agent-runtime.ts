/**
 * AgentRuntime SPI shared by SDK, binary, and local runtime implementations.
 */

import type {
  AgentSettings,
  ContextUsageRecord,
  MemoryRecallRecord,
  ModelOption,
  TokenUsage,
} from "./types";
import type {
  WorkflowReadThreadInput,
  WorkflowSubscribeThreadInput,
  WorkflowThreadPatch,
} from "./workflow-thread-data-source";
import type { WorkflowReadThreadResponse } from "./workflow-read-thread-contract";

// Runtime event stream exposed to the UI layer.
export type RuntimeEvent =
  | { kind: "turn-start"; payload: { turnId: string; timestamp: number } }
  | { kind: "text-chunk"; payload: { turnId: string; content: string } }
  | { kind: "thinking-chunk"; payload: { turnId: string; content: string } }
  | {
      kind: "tool-start";
      payload: {
        turnId: string;
        toolId: string;
        toolName: string;
        input: unknown;
      };
    }
  | {
      kind: "tool-progress";
      payload: {
        turnId: string;
        toolId: string;
        toolName: string;
        partialInput?: string;
        input?: unknown;
        isReady?: boolean;
      };
    }
  | {
      kind: "tool-complete";
      payload: {
        turnId: string;
        toolId: string;
        output: unknown;
        isError: boolean;
      };
    }
  | {
      kind: "turn-complete";
      payload: {
        turnId: string;
        result: "success" | "error" | "aborted";
        content?: string;
        error?: string;
        sdkSessionId?: string;
      };
    }
  | {
      kind: "approval-request";
      payload: {
        requestId: string;
        toolName: string;
        reason: string;
        timeout: number;
        allowSession?: boolean;
      };
    }
  | {
      kind: "context-usage";
      payload: {
        turnId: string;
        phase?: "turn_start" | "turn_end";
        percentage: number;
        limit: number;
        usage?: ContextUsageRecord;
      };
    }
  | {
      kind: "context-warning";
      payload: {
        turnId: string;
        level: "low" | "medium" | "high" | "critical";
        message: string;
        percentage?: number;
      };
    }
  | { kind: "token-usage"; payload: { turnId: string; usage: TokenUsage } }
  | {
      kind: "runtime-status";
      payload: {
        turnId: string;
        id?: string;
        label: string;
        detail?: string;
        status?: "pending" | "running" | "completed" | "error";
      };
    }
  | {
      kind: "session-info";
      payload: {
        turnId: string;
        skills: string[];
        slashCommands: string[];
        agents: string[];
      };
    }
  | {
      kind: "mcp-status";
      payload: { turnId: string; servers: unknown[]; tools?: string[] };
    }
  | {
      kind: "memory-recall";
      payload: {
        turnId: string;
        mode: "select" | "synthesize";
        memories: MemoryRecallRecord[];
      };
    }
  | {
      kind: "prompt-suggestion";
      payload: { turnId: string; suggestion: string };
    }
  | {
      kind: "error";
      payload: { code: string; message: string; recoverable: boolean };
    };

export type RuntimeEventStream = AsyncIterable<RuntimeEvent>;

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export interface Thread {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

export type PermissionMode = "default" | "acceptEdits" | "bypass";

export interface RuntimeCapabilities {
  forkThread: boolean;
  interruptTurn: boolean;
  setModel: boolean;
  setPermissionMode: boolean;
  registerTool: boolean;
  cancelTool: boolean;
  editMessage: boolean;
  sandbox: boolean;
}

export interface AgentRuntime {
  readonly name: string;
  readonly capabilities: RuntimeCapabilities;

  initialize(): Promise<void>;
  destroy(): Promise<void>;

  listThreads(): Promise<Thread[]>;
  createThread(title?: string): Promise<Thread>;
  deleteThread(threadId: string): Promise<void>;
  forkThread?(threadId: string, upToMessageId?: string): Promise<Thread>;

  sendMessage(opts: {
    threadId: string;
    turnId?: string;
    content: string;
    displayContent?: string;
    cwd?: string;
    attachments?: unknown[];
    messageId?: string;
    runtimeThreadId?: string;
    settingsSnapshot?: AgentSettings;
  }): Promise<RuntimeEventStream>;

  interruptTurn?(turnId: string): Promise<void>;

  setModel?(modelId: string): Promise<void>;
  getAvailableModels?(): Promise<ModelOption[]>;
  setPermissionMode?(mode: PermissionMode): Promise<void>;

  registerTool?(
    tool: ToolDefinition,
    handler: (args: unknown) => Promise<unknown>,
  ): void;
  listTools(): Promise<ToolDefinition[]>;
  cancelTool?(toolCallId: string): Promise<void>;
  truncateThread?(
    threadId: string,
    opts: { fromMessageId: string; includeMessage?: boolean },
  ): Promise<Thread>;

  readThread?(
    input: WorkflowReadThreadInput,
  ): Promise<WorkflowReadThreadResponse>;
  subscribeThread?(
    input: WorkflowSubscribeThreadInput,
  ): AsyncIterable<WorkflowReadThreadResponse | WorkflowThreadPatch>;

  respondApproval(
    requestId: string,
    approved: boolean,
    scope: "once" | "session",
    reason?: string,
  ): void;
}
