import { useState, type ReactNode } from "react";
import { GitFork, Trash2 } from "lucide-react";
import {
  ConversationCheckIcon,
  ConversationCopyIcon,
} from "../conversation-icons";
import { formatConversationTime } from "@shared/conversation-time";

/**
 * 回合 footer：复制/分支/删除操作 + 时间戳。
 * 从 AssistantTurn 提取（Phase 4），copied 状态内聚于此。
 */
interface Props {
  finalText: string;
  isRunning?: boolean;
  messageId: string;
  createdAt?: number;
  showFooterMetadata?: boolean;
  onCopy?: (text: string) => void | Promise<void>;
  onFork?: () => void | Promise<void>;
  onDelete?: (id: string) => void;
}

export function WorkflowTurnFooterView({
  finalText,
  isRunning = false,
  messageId,
  createdAt,
  showFooterMetadata = true,
  onCopy,
  onFork,
  onDelete,
}: Props) {
  const [copied, setCopied] = useState(false);
  const footerTimestamp =
    showFooterMetadata &&
    typeof createdAt === "number" &&
    Number.isFinite(createdAt)
      ? createdAt
      : undefined;

  if (isRunning || !finalText) return null;

  const handleCopy = async () => {
    if (!onCopy || !finalText) return;
    try {
      await onCopy(finalText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="message-footer">
      <div className="assistant-actions">
        {finalText && onCopy ? (
          <IconAction
            title={copied ? "已复制" : "复制回复"}
            label={copied ? "已复制" : "复制"}
            onClick={() => void handleCopy()}
            icon={copied ? <ConversationCheckIcon /> : <ConversationCopyIcon />}
          />
        ) : null}
        {finalText && onFork ? (
          <IconAction
            title="创建对话分支"
            label="分支"
            onClick={() => void onFork()}
            icon={<GitFork className="h-3.5 w-3.5" />}
          />
        ) : null}
        {finalText && onDelete ? (
          <IconAction
            title="删除"
            label="删除"
            onClick={() => onDelete(messageId)}
            danger
            icon={<Trash2 className="h-3.5 w-3.5" />}
          />
        ) : null}
      </div>
      {footerTimestamp !== undefined ? (
        <time dateTime={new Date(footerTimestamp).toISOString()}>
          {formatAssistantMessageTime(footerTimestamp)}
        </time>
      ) : null}
    </div>
  );
}

export function formatAssistantMessageTime(timestamp: number): string {
  return formatConversationTime(timestamp);
}

function IconAction({
  title,
  label,
  icon,
  danger,
  onClick,
}: {
  title: string;
  label: string;
  icon: ReactNode;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`assistant-action ${danger ? "is-danger" : ""}`}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
