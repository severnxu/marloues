import { Hand, ShieldCheck, TriangleAlert } from "lucide-react";
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
import type { AgentSecurityMode, SkillInfo } from "@shared/types";
import type { ContextUsageRecord, TokenUsage } from "@shared/types";

export const COMPOSER_TEXTAREA_MIN_HEIGHT = 56;
export const COMPOSER_TEXTAREA_WITH_ATTACHMENTS_MIN_HEIGHT = 59;
export const COMPOSER_TEXTAREA_MAX_HEIGHT = 150;

export const securityModeOptions: Array<{
  mode: AgentSecurityMode;
  label: string;
  description: string;
  icon: typeof Hand;
}> = [
  {
    mode: "request",
    label: "请求批准",
    description: "编辑外部文件和使用互联网时始终询问",
    icon: Hand,
  },
  {
    mode: "auto-review",
    label: "帮我批准",
    description: "仅对检测到的风险操作请求批准",
    icon: ShieldCheck,
  },
  {
    mode: "full-access",
    label: "完全访问",
    description: "可不受限制地访问互联网和本机文件",
    icon: TriangleAlert,
  },
];

export interface WorkflowComposerShellProps {
  /** Changes whenever the active conversation changes; clears transient attachments. */
  conversationKey?: string;
  input: string;
  isGenerating: boolean;
  securityMode?: AgentSecurityMode;
  selectedProvider: Provider | null;
  onInputChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: (attachments?: UserMessageContent[]) => void;
  onStop: () => void;
  onSecurityModeChange?: (mode: AgentSecurityMode) => void;
  onOpenSecuritySettings?: () => void;
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
