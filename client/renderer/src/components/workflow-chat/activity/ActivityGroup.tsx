import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  FileText,
  FolderTree,
  Globe2,
  Image as ImageIcon,
  Search,
  ShieldQuestion,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import type { WorkflowTurnItem } from "../../../../../shared/adapters/workflow-messages-to-read-thread";
import { WorkflowActivityRowContent, WorkflowInlineDots } from "./ActivityRow";
import {
  workflowActivityGroupViewState,
  type WorkflowActivityGroup as WorkflowActivityGroupModel,
} from "../";
import {
  codexActivityGroupDisplayLabel,
  codexActivityIsBrowserTool,
  CODEX_ACTIVITY_SUMMARY_DEFER_MS,
} from "./codex-activity-contract";

type AgentMessageItem = Extract<WorkflowTurnItem, { type: "agentMessage" }>;
type ProcessItem = Exclude<
  WorkflowTurnItem,
  { type: "agentMessage" | "userMessage" }
>;
type AgentBodyItem = AgentMessageItem | ProcessItem;
type CommandItemModel = Extract<WorkflowTurnItem, { type: "commandExecution" }>;

export type WorkflowActivityGroupEntry =
  | { type: "item"; item: AgentBodyItem }
  | { type: "commandGroup"; id: string; items: CommandItemModel[] };

interface Props {
  group: WorkflowActivityGroupModel;
  defaultDetailExpanded?: boolean;
  expanded: boolean;
  active?: boolean;
  thinking?: boolean;
  toEntries: (items: AgentBodyItem[]) => WorkflowActivityGroupEntry[];
  renderCommandGroup: (id: string, items: CommandItemModel[]) => ReactNode;
  renderItem: (item: AgentBodyItem) => ReactNode;
}

export function WorkflowActivityGroup({
  group,
  defaultDetailExpanded = true,
  expanded,
  active = false,
  thinking = false,
  toEntries,
  renderCommandGroup,
  renderItem,
}: Props) {
  const [summaryExpanded, setSummaryExpanded] = useState(defaultDetailExpanded);
  const viewState = workflowActivityGroupViewState(expanded, summaryExpanded);

  useEffect(() => {
    setSummaryExpanded(defaultDetailExpanded);
  }, [defaultDetailExpanded, group.id]);

  if (!viewState.showDetail) {
    return (
      <ActivitySummaryRow
        group={group}
        expanded={viewState.summaryExpanded}
        active={active}
        thinking={thinking}
        onToggle={() => setSummaryExpanded(true)}
      />
    );
  }

  const entries = toEntries(group.items);

  return (
    <div
      className={`workflow-activity-group ${viewState.showSummary ? "is-summary" : "is-detail"}`}
      data-kind="activity-group"
    >
      {viewState.showSummary ? (
        <ActivitySummaryRow
          group={group}
          expanded={viewState.summaryExpanded}
          active={active}
          thinking={thinking}
          onToggle={() => setSummaryExpanded(false)}
        />
      ) : null}
      <div className="workflow-activity-group-detail">
        {entries.map((entry) => {
          if (entry.type === "commandGroup")
            return renderCommandGroup(entry.id, entry.items);
          return renderItem(entry.item);
        })}
      </div>
    </div>
  );
}

function ActivitySummaryRow({
  group,
  expanded,
  active,
  thinking,
  onToggle,
}: {
  group: WorkflowActivityGroupModel;
  expanded: boolean;
  active: boolean;
  thinking: boolean;
  onToggle: () => void;
}) {
  const label = thinking
    ? "正在思考"
    : codexActivityGroupDisplayLabel(group.summary, group.items, active);
  const displayLabel = useDeferredActivityLabel(label, active || thinking);
  const browserSource = group.items.some(codexActivityIsBrowserTool);
  if (!displayLabel) return null;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      data-kind="activity-row"
      data-activity-kind="summary"
      data-activity-state={
        thinking ? "thinking" : active ? "active" : "summary"
      }
      data-activity-source={browserSource ? "browser" : undefined}
      className="workflow-activity-row-button workflow-activity-summary-row"
    >
      <span className="workflow-activity-row-icon">
        <ActivitySummaryIcon group={group} />
      </span>
      <WorkflowActivityRowContent
        label={
          <>
            <span
              className={
                thinking ? "workflow-activity-thinking-label" : undefined
              }
            >
              {displayLabel}
            </span>
            {active ? <WorkflowInlineDots /> : null}
          </>
        }
        meta={
          <InlineDiffStats
            added={group.summary.addedLineCount}
            removed={group.summary.removedLineCount}
          />
        }
        interactive
      />
    </button>
  );
}

function useDeferredActivityLabel(label: string, active: boolean): string {
  const [displayLabel, setDisplayLabel] = useState(label);
  const changedAtRef = useRef(Date.now());

  useEffect(() => {
    if (!active) {
      setDisplayLabel(label);
      changedAtRef.current = Date.now();
      return undefined;
    }
    const elapsed = Date.now() - changedAtRef.current;
    const remaining = Math.max(0, CODEX_ACTIVITY_SUMMARY_DEFER_MS - elapsed);
    const timer = window.setTimeout(() => {
      setDisplayLabel(label);
      changedAtRef.current = Date.now();
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [active, label]);

  return displayLabel;
}

function ActivitySummaryIcon({ group }: { group: WorkflowActivityGroupModel }) {
  const fileCount =
    group.summary.fileCreateCount +
    group.summary.fileEditCount +
    group.summary.fileDeleteCount;
  const explorationCount =
    group.summary.exploredFileCount + group.summary.listCount;
  const permissionCount =
    group.summary.waitingPermissionRequestCount +
    group.summary.approvedPermissionRequestCount +
    group.summary.deniedPermissionRequestCount;
  const onlyFolderCreation =
    group.summary.runningFolderCreateCount > 0 &&
    group.summary.commandCount === group.summary.runningFolderCreateCount;
  if (group.items.some(codexActivityIsBrowserTool)) return <Globe2 />;
  if (
    group.summary.imageCount > 0 &&
    group.summary.commandCount === 0 &&
    fileCount === 0
  )
    return <ImageIcon />;
  if (onlyFolderCreation) return <FolderTree />;
  if (
    (fileCount > 0 || explorationCount > 0) &&
    group.summary.commandCount === 0 &&
    group.summary.searchCount === 0
  )
    return <FileText />;
  if (
    (group.summary.searchCount > 0 || group.summary.webSearchCount > 0) &&
    group.summary.commandCount === 0 &&
    fileCount === 0
  )
    return <Search />;
  if (
    permissionCount > 0 &&
    group.summary.commandCount === 0 &&
    fileCount === 0 &&
    explorationCount === 0
  )
    return <ShieldQuestion />;
  if (group.summary.commandCount > 0) return <SquareTerminal />;
  return <Wrench />;
}

function InlineDiffStats({
  added,
  removed,
}: {
  added: number;
  removed: number;
}) {
  if (!added && !removed) return null;
  return (
    <span className="workflow-activity-diff-stats">
      {added ? <span className="is-addition">+{added}</span> : null}
      {removed ? <span className="is-deletion">-{removed}</span> : null}
    </span>
  );
}
