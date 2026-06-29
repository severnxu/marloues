export interface MessageItem {
  id: string
  type: 'agent_message' | 'reasoning' | 'command_execution' | 'file_change' | 'mcp_tool_call' | 'web_search' | 'todo_list' | 'permission_request' | 'error'
  rawType?: string
  phase?: 'started' | 'updated' | 'completed'
  text?: string
  command?: string
  shell?: string
  aggregated_output?: string
  exit_code?: number
  status?: string
  startedAt?: number
  updatedAt?: number
  completedAt?: number
  server?: string
  tool?: string
  args?: unknown
  arguments?: unknown
  result?: unknown
  changes?: { path: string; kind: string }[]
  patch?: string
  error?: { message: string }
  query?: string
  toolName?: string
  reason?: string
  timeoutMs?: number
  message?: string
  items?: { text: string; completed: boolean }[]
  rawItem?: unknown
}

export interface WorkflowRawEvent {
  method: string
  params: unknown
  receivedAt: number
}

export type UserMessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }
  | { type: 'localImage'; path: string }
  | { type: 'skill'; name: string; path?: string }
  | { type: 'mention'; name: string; path?: string }

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  userContent?: UserMessageContent[]
  timestamp: number
  status?: 'thinking' | 'running' | 'completed' | 'failed'
  startedAt?: number
  updatedAt?: number
  completedAt?: number
  items: MessageItem[]
  rawEvents?: WorkflowRawEvent[]
}

export interface Session {
  id: string
  title: string
  updatedAt: number
  pinned?: boolean
  archived?: boolean
  workflowThreadId?: string
  cwd?: string
  model?: string
  tokenUsage?: {
    input: number
    output: number
    cached: number
  }
  turnCount?: number
  messages: Message[]
}

export interface Skill {
  id: string
  name: string
  trigger: string
  description: string
  icon: string
  iconClass: string
  author: string
  version: string
  permissions: string
  enabled: boolean
}

export interface Toast {
  id: string
  message: string
  type: 'success' | 'error'
}

export interface Provider {
  id: string
  name: string
  apiKey: string
  baseUrl: string
  model?: string
  enabled: boolean
}

export interface Settings {
  language: string
  autoSave: boolean
  maxSessions: number
  theme: 'light' | 'dark' | 'auto'
  accentColor: string
  fontSize: number
  compactMode: boolean
  workingDirectory: string
  sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access'
  approvalPolicy: 'untrusted' | 'on-request' | 'never'
  webSearch: boolean
}

export interface ContextMenuState {
  x: number
  y: number
  type: 'session' | 'message'
  targetId?: string
}

export type Page = 'chat' | 'extensions' | 'settings' | 'lab'
export type ExtTab = 'skills' | 'mcps' | 'plugins'
export type SkillTab = 'installed' | 'market' | 'import'
export type SettingsTab = 'general' | 'appearance' | 'providers' | 'shortcuts' | 'about'
