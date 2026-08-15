import { RUNTIME_NAME } from "@/lib/product-brand";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";

export function RuntimeStatus({ className = "" }: { className?: string }) {
  const activeSessionId = useUnifiedChatStore((state) => state.activeSessionId);
  const isStreaming = useUnifiedChatStore((state) =>
    activeSessionId
      ? Boolean(state.streamingSessionIds[activeSessionId])
      : false,
  );
  const threadStatus = useUnifiedChatStore((state) =>
    activeSessionId
      ? state.readThreads[activeSessionId]?.thread.status.type
      : undefined,
  );
  const active = isStreaming || threadStatus === "active";
  const statusLabel = active ? "正在工作" : "已就绪";

  return (
    <span
      className={`chat-runtime-status ${active ? "is-active" : ""} ${className}`.trim()}
      aria-label={`${RUNTIME_NAME} ${statusLabel}`}
    >
      <i aria-hidden="true" />
      <span>{`${RUNTIME_NAME} · ${statusLabel}`}</span>
    </span>
  );
}
