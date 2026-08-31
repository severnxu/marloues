import { Hand, ShieldAlert, ShieldCheck } from "lucide-react";
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
import type { WorkflowUserMessageContent } from "@shared/workflow-read-thread-contract";

// Two 14px lines at 1.55 line-height plus the textarea's vertical padding.
// Keeping two rows inside the minimum prevents the composer shell from
// jumping when the user enters the first newline.
export const COMPOSER_TEXTAREA_MIN_HEIGHT = 64;
export const COMPOSER_TEXTAREA_WITH_ATTACHMENTS_MIN_HEIGHT = 60;
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
    icon: ShieldAlert,
  },
];

export interface WorkflowComposerShellProps {
  /** Changes whenever the active conversation changes; clears transient attachments. */
  conversationKey?: string;
  input: string;
  /** Browser annotations to add as structured composer attachments. */
  incomingBrowserComment?: {
    eventId: string;
    pageId: string;
    payloads: Extract<WorkflowUserMessageContent, { type: "browserComment" }>[];
  };
  /** Browser annotation bar request to submit through the primary composer path. */
  browserCommentSubmit?: {
    eventId: string;
    pageId: string;
    payloads: Extract<WorkflowUserMessageContent, { type: "browserComment" }>[];
  };
  /** A browser-side annotation removal to mirror in the composer. */
  browserCommentRemoval?: {
    eventId: string;
    pageId: string;
    commentId: number;
  };
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
