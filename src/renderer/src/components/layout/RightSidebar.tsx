import { useMemo, useState } from "react";
import { Activity, Brain, ListTree } from "lucide-react";
import { FileExplorer, MemoryPanel, TaskPanel, collectSessionTimeline } from "@/components/layout/RightSidebarPanels";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

type RightSidebarTab = "files" | "task" | "memory";

export function RightSidebar() {
  const [activeTab, setActiveTab] = useState<RightSidebarTab>("files");
  const sessions = useUnifiedChatStore((state) => state.sessions);
  const activeSessionId = useUnifiedChatStore((state) => state.activeSessionId);
  const liveTurns = useUnifiedChatStore((state) => state.liveTurns);
  const workspace = useWorkspaceStore((state) => state.current);
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const liveTurn = activeSessionId ? liveTurns[activeSessionId] : undefined;
  const liveTurnIsActive = liveTurn?.status === "pending" || liveTurn?.status === "running";
  const timeline = liveTurn?.timeline ?? activeSession?.messages.at(-1)?.timeline ?? [];
  const sessionTimeline = useMemo(
    () => collectSessionTimeline(activeSession, liveTurn?.timeline),
    [activeSession, liveTurn?.timeline],
  );
  const messageCount = activeSession?.messages.length ?? 0;

  return (
    <aside className="inspector">
      <div className="inspector-tabs">
        <button className={activeTab === "files" ? "active" : ""} onClick={() => setActiveTab("files")}>
          <ListTree size={14} />
          文件
        </button>
        <button className={activeTab === "task" ? "active" : ""} onClick={() => setActiveTab("task")}>
          <Activity size={14} />
          任务
          {messageCount > 0 ? <small>{messageCount}</small> : null}
        </button>
        <button className={activeTab === "memory" ? "active" : ""} onClick={() => setActiveTab("memory")}>
          <Brain size={14} />
          记忆
        </button>
      </div>
      {activeTab === "files" ? (
        <FileExplorer workspacePath={workspace?.path} />
      ) : activeTab === "task" ? (
        <TaskPanel
          workspacePath={workspace?.path}
          timeline={timeline}
          messageCount={messageCount + (liveTurn ? 1 : 0)}
          isStreaming={liveTurnIsActive}
        />
      ) : (
        <MemoryPanel workspacePath={workspace?.path} timeline={sessionTimeline} />
      )}
    </aside>
  );
}
