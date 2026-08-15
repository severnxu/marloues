import { useEffect, useRef } from "react";
import type { TaskContextMode } from "./use-task-context-layout";
import type { TaskPresentationModel } from "./task-presentation-model";
import {
  BackgroundProcessesSection,
  SourcesSection,
  TaskProgressSection,
  WorkspaceContextSection,
} from "./TaskContextSections";

export function TaskContextPanel({
  model,
  mode,
  gitLoading,
  onRefresh,
  onCloseFloating,
  onOpenChanges,
}: {
  model: TaskPresentationModel;
  mode: TaskContextMode;
  gitLoading: boolean;
  onRefresh: () => void;
  onCloseFloating: () => void;
  onOpenChanges?: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (mode !== "floating") return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseFloating();
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        panelRef.current?.contains(target) ||
        target?.closest("[data-thread-summary-toggle]")
      ) {
        return;
      }
      onCloseFloating();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [mode, onCloseFloating]);

  if (!model.hasData || mode === "hidden") return null;
  const workspace = model.workspace;

  return (
    <aside
      ref={panelRef}
      className={`thread-summary-panel is-${mode}`}
      data-kind="thread-summary-panel"
      data-mode={mode}
      aria-label="会话固定摘要"
      role="complementary"
    >
      <div className="thread-summary-panel-scroll scrollbar-thin">
        <WorkspaceContextSection
          sessionId={model.sessionId}
          model={model}
          gitLoading={gitLoading}
          onRefresh={onRefresh}
          onOpenChanges={
            model.changes?.reviewTarget ? onOpenChanges : undefined
          }
          onOpenWorkspace={() => {
            if (workspace?.id)
              void window.marloues.workspace.openInExplorer(workspace.id);
          }}
        />
        <TaskProgressSection sessionId={model.sessionId} tasks={model.tasks} />
        <BackgroundProcessesSection
          sessionId={model.sessionId}
          processes={model.processes}
        />
        <SourcesSection sessionId={model.sessionId} sources={model.sources} />
      </div>
    </aside>
  );
}
