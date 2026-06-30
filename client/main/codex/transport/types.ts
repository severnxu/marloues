// JSON-RPC types for Codex app-server protocol

export const ClientMethods = {
  Initialize: 'initialize',
  ThreadStart: 'thread/start',
  ThreadResume: 'thread/resume',
  ThreadFork: 'thread/fork',
  TurnStart: 'turn/start',
  TurnInterrupt: 'turn/interrupt',
  ApprovalRespond: 'approval/respond',
} as const

export const ServerNotifications = {
  Initialized: 'initialized',
  TurnStart: 'turn/start',
  TurnInterrupt: 'turn/interrupt',
  ApprovalRequest: 'approval/request',
} as const

export interface ApprovalRequestParams {
  id: string
  tool: string
  toolInput: Record<string, unknown>
  threadId: string
  turnId?: string
  cwd?: string
}

export interface ApprovalResponseParams {
  id: string
  decision: 'approve' | 'deny'
  reason?: string
}

export interface ThreadForkParams {
  sourceThreadId: string
  cwd?: string
}

export interface InitializeParams {
  protocolVersion: string
  capabilities: { streaming?: boolean; tools?: boolean }
  clientInfo: { name: string; version: string }
}

export interface InitializeResult {
  protocolVersion: string
  capabilities: {
    streaming?: boolean
    tools?: boolean
    parallelToolCalls?: boolean
  }
  serverInfo: { name: string; version: string }
}

export interface ThreadStartResult {
  thread: { id: string }
}

export interface TurnEvent {
  type: string
  content?: string
  tool?: string
  arguments?: Record<string, unknown>
  result?: unknown
  message?: string
}
