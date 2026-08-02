import { useEffect, useRef, type ReactNode } from "react";
import { SteerQueue } from "./SteerQueue";
import { TaskResultSummary } from "./TaskResultSummary";
import type { SteerItem, TaskResultSummaryData } from "./types";

export function InteractionDock({
  permissionPanel,
  resultSummary,
  steers,
  onGuideSteer,
  onEditSteer,
  onRemoveSteer,
  onReorderSteer,
  children,
}: {
  permissionPanel?: ReactNode;
  resultSummary?: TaskResultSummaryData | null;
  steers: SteerItem[];
  onGuideSteer: (id: string) => void;
  onEditSteer: (id: string) => void;
  onRemoveSteer: (id: string) => void;
  onReorderSteer: (fromId: string, toId: string) => void;
  children: ReactNode;
}) {
  const dockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dock = dockRef.current;
    const page = dock?.closest<HTMLElement>(".chat-page");
    if (!dock || !page) return;

    const updateSafeArea = () => {
      page.style.setProperty(
        "--interaction-dock-height",
        `${dock.getBoundingClientRect().height}px`,
      );
    };
    const observer = new ResizeObserver(updateSafeArea);
    observer.observe(dock);
    updateSafeArea();
    return () => {
      observer.disconnect();
      page.style.removeProperty("--interaction-dock-height");
    };
  }, []);

  return (
    <div className="interaction-dock" ref={dockRef}>
      {permissionPanel ? (
        <div className="permission-interaction-stack">{permissionPanel}</div>
      ) : (
        <div className="input-interaction-stack">
          {resultSummary ? <TaskResultSummary summary={resultSummary} /> : null}
          <SteerQueue
            items={steers}
            onGuide={onGuideSteer}
            onEdit={onEditSteer}
            onRemove={onRemoveSteer}
            onReorder={onReorderSteer}
          />
          {children}
        </div>
      )}
    </div>
  );
}
