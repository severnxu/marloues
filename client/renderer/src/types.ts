import type { WorkflowTurnItem } from "@shared/workflow-read-thread-contract";

export interface WorkflowRawEvent {
  method: string;
  params: unknown;
  receivedAt: number;
}

export type UserMessageContent =
  import("@shared/workflow-read-thread-contract").WorkflowUserMessageContent;

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  userContent?: UserMessageContent[];
  timestamp: number;
  status?: "thinking" | "running" | "completed" | "failed";
  startedAt?: number;
  updatedAt?: number;
  completedAt?: number;
  modelId?: string;
  modelName?: string;
  usage?: import("@shared/types").TokenUsage;
  items: WorkflowTurnItem[];
  rawEvents?: WorkflowRawEvent[];
}

export interface Session {
  id: string;
  title: string;
  updatedAt: number;
  pinned?: boolean;
  archived?: boolean;
  workflowThreadId?: string;
  cwd?: string;
  model?: string;
  tokenUsage?: {
    input: number;
    output: number;
    cached: number;
  };
  turnCount?: number;
  messages: Message[];
}

export interface Skill {
  id: string;
  name: string;
  trigger: string;
  description: string;
  icon: string;
  iconClass: string;
  author: string;
  version: string;
  permissions: string;
  enabled: boolean;
}

export interface Toast {
  id: string;
  message: string;
  type: "success" | "error";
}

export interface SlashCommandItem {
  id: string;
  command: string;
  label: string;
  description?: string;
  argumentHint?: string;
  category: "builtin" | "skill";
}

export interface Provider {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  model?: string;
  enabled: boolean;
}

export interface Settings {
  language: string;
  autoSave: boolean;
  maxSessions: number;
  theme: "light" | "dark" | "auto";
  accentColor: string;
  fontSize: number;
  compactMode: boolean;
  workingDirectory: string;
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy: "untrusted" | "on-request" | "never";
  webSearch: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  type: "session" | "message";
  targetId?: string;
}

export type Page = "chat" | "extensions" | "settings" | "lab";
export type ExtTab = "skills" | "mcps" | "plugins";
export type SkillTab = "installed" | "market" | "import";
export type SettingsTab =
  "general" | "appearance" | "providers" | "shortcuts" | "about";
