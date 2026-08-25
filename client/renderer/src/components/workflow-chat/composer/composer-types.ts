import { Bot, CircleAlert, Shield } from "lucide-react";
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
import type { SkillInfo } from "@shared/types";
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
  { level: "full", label: "完全访问", icon: CircleAlert },
];

export interface WorkflowComposerShellProps {
  /** Changes whenever the active conversation changes; clears transient attachments. */
  conversationKey?: string;
  input: string;
  isGenerating: boolean;
  selectedProvider: Provider | null;
  onInputChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: (attachments?: UserMessageContent[]) => void;
  onStop: () => void;
  onAccessLevelChange?: (level: ComposerAccessLevel) => void;
  permissionPanel?: ReactNode;
  emptyHeader?: ReactNode;
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
