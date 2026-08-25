import {
  Bot,
  CircleAlert,
  FolderLock,
  Shield,
  ShieldOff,
  Wifi,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  ExecutionTaskRecord,
  PendingSteerPreview,
} from "@/stores/unified-chat-store";
import type {
  Provider,
  SlashCommandItem,
  UserMessageContent,
} from "../../../types";
import type { AgentSandboxMode, SkillInfo } from "@shared/types";
import type { SandboxGatePhase } from "./SandboxInstallBanner";
import type { ContextUsageRecord, TokenUsage } from "@shared/types";

export type ComposerAccessLevel = "default" | "review" | "full";

export const COMPOSER_TEXTAREA_MIN_HEIGHT = 56;
export const COMPOSER_TEXTAREA_WITH_ATTACHMENTS_MIN_HEIGHT = 59;
export const COMPOSER_TEXTAREA_MAX_HEIGHT = 150;

export const accessOptions: Array<{
  level: ComposerAccessLevel;
  label: string;
  icon: typeof Shield;
}> = [
  { level: "default", label: "默认权限", icon: Shield },
  { level: "review", label: "自动审查", icon: Bot },
  { level: "full", label: "免审批", icon: CircleAlert },
];

export const sandboxOptions: Array<{
  mode: AgentSandboxMode;
  label: string;
  icon: typeof Shield;
}> = [
  { mode: "read-only", label: "只读沙箱", icon: Shield },
  { mode: "workspace-write", label: "工作区沙箱", icon: FolderLock },
  { mode: "workspace-write-network", label: "工作区 + 网络", icon: Wifi },
  { mode: "danger-full-access", label: "关闭沙箱", icon: ShieldOff },
];

export interface WorkflowComposerShellProps {
  /** Changes whenever the active conversation changes; clears transient attachments. */
  conversationKey?: string;
  input: string;
  isGenerating: boolean;
  accessLevel?: ComposerAccessLevel;
  sandboxMode?: AgentSandboxMode;
  selectedProvider: Provider | null;
  onInputChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: (attachments?: UserMessageContent[]) => void;
  onStop: () => void;
  onAccessLevelChange?: (level: ComposerAccessLevel) => void;
  onSandboxModeChange?: (mode: AgentSandboxMode) => void;
  permissionPanel?: ReactNode;
  modelControl?: ReactNode;
  placeholder?: string;
  slashCommands?: SlashCommandItem[];
  skills?: SkillInfo[];
  workspacePath?: string;
  contextUsage?: ContextUsageRecord;
  usage?: TokenUsage;
  taskProgress?: ExecutionTaskRecord[];
  fileChangeSummary?: {
    filesChanged: number;
    insertions?: number;
    deletions?: number;
  };
  onFileChangeSummaryClick?: () => void;
  pendingSteers?: PendingSteerPreview[];
  steerQueuePaused?: boolean;
  onResumeSteerQueue?: () => void;
  onApplyPendingSteer?: (messageId: string) => void;
  onCancelPendingSteer?: (messageId: string) => void;
  onEditPendingSteer?: (messageId: string, text: string) => void;
  onReorderPendingSteer?: (orderedIds: string[]) => void;
}

export type SandboxGateState = {
  phase: SandboxGatePhase;
  message?: string;
} | null;
