import { WorkflowActivityGroup } from "./ActivityGroup";
import type { WorkflowActivityGroupEntry } from "./ActivityGroup";
import { WorkflowAssistantAnswer } from "../";
import { WorkflowCommandExecutionRow } from "./CommandExecutionRow";
import { WorkflowTurnItemRenderer } from "./TurnItemRenderer";
import type { WorkflowTurnItem } from "../../../../../shared/adapters/workflow-messages-to-read-thread";
import type { WorkflowActivityGroup as WorkflowActivityGroupModel } from "../";
import type { ProcessItem } from "../turns/turn-layout";

type AgentMessageItem = Extract<WorkflowTurnItem, { type: "agentMessage" }>;
type AgentBodyItem = AgentMessageItem | ProcessItem;
type CommandItemModel = Extract<WorkflowTurnItem, { type: "commandExecution" }>;

type Props =
  | {
      kind: "activityItem";
      item: ProcessItem;
      reasoningDefaultOpen?: boolean;
    }
  | {
      kind: "activityGroup";
      group: WorkflowActivityGroupModel;
      defaultDetailExpanded?: boolean;
      expanded: boolean;
      active?: boolean;
      thinking?: boolean;
      reasoningDefaultOpen?: boolean;
    };

export function WorkflowActivityRenderer(props: Props) {
  if (props.kind === "activityItem") {
    return (
      <WorkflowTurnItemRenderer
        item={props.item}
        reasoningDefaultOpen={props.reasoningDefaultOpen}
      />
    );
  }

  return (
    <ActivityGroupBridge
      group={props.group}
      defaultDetailExpanded={props.defaultDetailExpanded}
      expanded={props.expanded}
      active={props.active}
      thinking={props.thinking}
      reasoningDefaultOpen={props.reasoningDefaultOpen}
    />
  );
}

function ActivityGroupBridge({
  group,
  defaultDetailExpanded,
  expanded,
  active,
  thinking,
  reasoningDefaultOpen,
}: {
  group: WorkflowActivityGroupModel;
  defaultDetailExpanded?: boolean;
  expanded: boolean;
  active?: boolean;
  thinking?: boolean;
  reasoningDefaultOpen?: boolean;
}) {
  return (
    <WorkflowActivityGroup
      group={group}
      defaultDetailExpanded={defaultDetailExpanded}
      expanded={expanded}
      active={active}
      thinking={thinking}
      toEntries={groupAgentBodyItems}
      renderCommandGroup={(id, items) => (
        <div key={id} className="workflow-command-group">
          {items.map((item) => (
            <WorkflowCommandExecutionRow key={item.id} item={item} />
          ))}
        </div>
      )}
      renderItem={(item) => {
        if (item.type === "agentMessage")
          return (
            <WorkflowAssistantAnswer
              key={item.id}
              text={item.text}
              hasLeadingContent={false}
            />
          );
        return (
          <WorkflowTurnItemRenderer
            key={item.id}
            item={settledGroupItem(group, item)}
            reasoningDefaultOpen={reasoningDefaultOpen}
          />
        );
      }}
    />
  );
}

function settledGroupItem(
  group: WorkflowActivityGroupModel,
  item: ProcessItem,
): ProcessItem {
  if (
    item.type === "permissionRequest" &&
    group.summary.waitingPermissionRequestCount === 0 &&
    group.summary.deniedPermissionRequestCount > 0 &&
    isRunningStatus(item.status)
  ) {
    return { ...item, status: "denied" };
  }
  if (
    group.summary.runningCount === 0 &&
    group.summary.deniedPermissionRequestCount > 0 &&
    "status" in item &&
    isRunningStatus(item.status)
  ) {
    return { ...item, status: "failed" } as ProcessItem;
  }
  return item;
}

function isRunningStatus(status: unknown): boolean {
  const value = String(status).toLowerCase();
  return (
    value === "running" ||
    value === "pending" ||
    value === "in_progress" ||
    value === "inprogress"
  );
}

function groupAgentBodyItems(
  items: AgentBodyItem[],
): WorkflowActivityGroupEntry[] {
  const entries: WorkflowActivityGroupEntry[] = [];
  let commandGroup: CommandItemModel[] = [];

  const flushCommands = () => {
    if (!commandGroup.length) return;
    if (commandGroup.length === 1)
      entries.push({ type: "item", item: commandGroup[0] });
    else
      entries.push({
        type: "commandGroup",
        id: commandGroup.map((item) => item.id).join("-"),
        items: commandGroup,
      });
    commandGroup = [];
  };

  for (const item of items) {
    if (item.type === "commandExecution") {
      commandGroup.push(item);
      continue;
    }

    flushCommands();
    entries.push({ type: "item", item });
  }

  flushCommands();
  return entries;
}
