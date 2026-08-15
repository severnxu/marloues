import { useState } from "react";
import {
  DailyProjectTree,
  type DailyProjectTreeProps,
} from "./DailyProjectTree";
import { resolveSessionCollectionActivity } from "./sidebar-activity";
import { type WorkAreaId } from "./sidebar-work-areas";
import { WorkspaceArea } from "./WorkAreaPrimitives";

export interface WorkAreaZoneProps extends DailyProjectTreeProps {
  onAddWorkspace: () => void;
}

export function WorkAreaZone(props: WorkAreaZoneProps) {
  const [expanded, setExpanded] = useState<Set<WorkAreaId>>(
    () => new Set(["daily"]),
  );

  const dailyActivity = resolveSessionCollectionActivity(
    Array.from(props.sessionsByWorkspace.values()).flatMap((sessions) =>
      sessions.map((session) => session.id),
    ),
    props.unreadCompletedSessionIds,
    props.runningSessionIds,
  );

  const toggleArea = (area: WorkAreaId) => {
    setExpanded((current) => toggleSetValue(current, area));
  };

  return (
    <div
      className="work-area-zone scrollbar-thin"
      aria-label="工作区与会话列表"
    >
      <div className="work-area-list">
        <WorkspaceArea
          areaId="daily"
          label="日常区"
          expanded={expanded.has("daily")}
          activity={dailyActivity}
          onToggle={() => toggleArea("daily")}
          onAdd={props.onAddWorkspace}
        >
          <DailyProjectTree {...props} />
        </WorkspaceArea>
      </div>
    </div>
  );
}

function toggleSetValue<T>(current: Set<T>, value: T): Set<T> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
