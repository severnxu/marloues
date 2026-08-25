// JSON-RPC types for Codex app-server protocol

export const ClientMethods = {
  Initialize: "initialize",
  ThreadStart: "thread/start",
  ThreadResume: "thread/resume",
  ThreadFork: "thread/fork",
  TurnStart: "turn/start",
  TurnInterrupt: "turn/interrupt",
} as const;

export const ServerNotifications = {
  Initialized: "initialized",
  TurnStart: "turn/start",
  TurnInterrupt: "turn/interrupt",
  ApprovalRequest: "approval/request",
} as const;

export interface ApprovalRequestParams {
  id: string;
  tool: string;
  toolInput: Record<string, unknown>;
  threadId: string;
  turnId?: string;
  cwd?: string;
}

export interface ApprovalResponseParams {
  id: string;
  decision: "approve" | "deny";
  reason?: string;
}

export interface ThreadForkParams {
  sourceThreadId: string;
  cwd?: string;
}

export interface InitializeParams {
  capabilities: {
    experimentalApi: boolean;
    requestAttestation: boolean;
  };
  clientInfo: { name: string; title: string; version: string };
}

export interface InitializeResult {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
}

export interface ThreadStartResult {
  thread: { id: string };
}

export interface TurnEvent {
  type: string;
  content?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  message?: string;
}
