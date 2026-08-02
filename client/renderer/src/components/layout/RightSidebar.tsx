import { useEffect, useMemo, useState } from "react";
import { Check, FileText, Maximize2, Minimize2 } from "lucide-react";
import { FileExplorer } from "@/components/layout/RightSidebarPanels";
import {
  OPEN_AUXILIARY_PANEL_EVENT,
  type AuxiliaryPanelTab,
} from "@/components/workbench/events";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

type RightSidebarTab = AuxiliaryPanelTab;

export function RightSidebar({
  primary = false,
  onTogglePrimary,
}: {
  primary?: boolean;
  onTogglePrimary?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<RightSidebarTab>("files");
  const sessions = useUnifiedChatStore((state) => state.sessions);
  const activeSessionId = useUnifiedChatStore((state) => state.activeSessionId);
  const workspace = useWorkspaceStore((state) => state.current);
  const activeSession = sessions.find(
    (session) => session.id === activeSessionId,
  );
  const changeGroups = useMemo(() => {
    const groups =
      activeSession?.messages.flatMap((message) =>
        message.items
          .filter((item) => item.type === "file_change")
          .flatMap((item) => item.changes ?? []),
      ) ?? [];
    const files = new Map<string, string>();
    for (const change of groups) files.set(change.path, change.kind);
    return [...files].map(([path, kind]) => ({ path, kind }));
  }, [activeSession]);
  const planItems = useMemo(
    () =>
      activeSession?.messages
        .flatMap((message) => message.items)
        .filter((item) => item.type === "todo_list")
        .at(-1)?.items ?? [],
    [activeSession],
  );

  useEffect(() => {
    const openPanel = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: RightSidebarTab }>).detail;
      if (detail?.tab) setActiveTab(detail.tab);
    };
    window.addEventListener(OPEN_AUXILIARY_PANEL_EVENT, openPanel);
    return () =>
      window.removeEventListener(OPEN_AUXILIARY_PANEL_EVENT, openPanel);
  }, []);

  return (
    <aside className="inspector">
      <div className="inspector-tabs">
        <button
          className={activeTab === "files" ? "active" : ""}
          onClick={() => setActiveTab("files")}
        >
          文件
        </button>
        <button
          className={activeTab === "changes" ? "active" : ""}
          onClick={() => setActiveTab("changes")}
        >
          变更
          {changeGroups.length > 0 ? (
            <small>{changeGroups.length}</small>
          ) : null}
        </button>
        <button
          className={activeTab === "plan" ? "active" : ""}
          onClick={() => setActiveTab("plan")}
        >
          计划
        </button>
        <span className="inspector-tab-spacer" />
        {onTogglePrimary ? (
          <button
            type="button"
            className="inspector-shell-action auxiliary-primary-action"
            onClick={onTogglePrimary}
            aria-label={primary ? "收回辅助区至右栏" : "展开辅助区至主视图区"}
            title={primary ? "收回辅助区至右栏" : "展开辅助区至主视图区"}
          >
            {primary ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        ) : null}
      </div>
      {activeTab === "files" ? (
        <FileExplorer workspacePath={workspace?.path} />
      ) : activeTab === "changes" ? (
        <ChangesPanel changes={changeGroups} />
      ) : (
        <PlanPanel items={planItems} />
      )}
    </aside>
  );
}

function ChangesPanel({
  changes,
}: {
  changes: Array<{ path: string; kind: string }>;
}) {
  return (
    <div className="auxiliary-list scrollbar-thin">
      {changes.length > 0 ? (
        changes.map((change) => (
          <button
            type="button"
            className="auxiliary-file-row"
            key={change.path}
          >
            <FileText size={14} />
            <span>{change.path}</span>
            <small>
              {change.kind === "create"
                ? "A"
                : change.kind === "delete"
                  ? "D"
                  : "M"}
            </small>
          </button>
        ))
      ) : (
        <p className="auxiliary-empty">当前任务还没有文件变更。</p>
      )}
    </div>
  );
}

function PlanPanel({
  items,
}: {
  items: Array<{ text: string; completed: boolean }>;
}) {
  return (
    <ol className="auxiliary-plan scrollbar-thin">
      {items.length > 0 ? (
        items.map((item, index) => (
          <li
            key={`${index}-${item.text}`}
            className={item.completed ? "is-complete" : ""}
          >
            <span>{item.completed ? <Check size={13} /> : index + 1}</span>
            <div>
              <strong>{item.text}</strong>
              <small>{item.completed ? "已完成" : "等待执行"}</small>
            </div>
          </li>
        ))
      ) : (
        <p className="auxiliary-empty">当前任务还没有计划。</p>
      )}
    </ol>
  );
}
