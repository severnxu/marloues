import { useState } from "react";
import {
  Check,
  FileText,
  FolderTree,
  Search,
  SquareTerminal,
} from "lucide-react";
import {
  WorkflowActivityRow,
  WorkflowActivityStatusBadge,
  WorkflowInlineDots,
} from "./ActivityRow";
import { WorkflowCommandDetail } from "./CommandDetailCard";
import {
  commandPresentation,
  type CommandDisplayKind,
  type CommandItemModel,
} from "./command-presentation";

interface Props {
  item: CommandItemModel;
}

export function WorkflowCommandExecutionRow({ item }: Props) {
  const [open, setOpen] = useState(false);
  const presentation = commandPresentation(item);

  return (
    <WorkflowActivityRow
      activityKind="commandExecution"
      icon={
        <CommandIcon
          kind={presentation.kind}
          completed={presentation.statusKind === "success"}
        />
      }
      label={
        <>
          {presentation.label}
          {presentation.running ? <WorkflowInlineDots /> : null}
          {presentation.running || presentation.failed ? (
            <WorkflowActivityStatusBadge failed={presentation.failed} />
          ) : null}
        </>
      }
      meta={presentation.meta}
      hasDetail={presentation.hasDetail}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      detail={<WorkflowCommandDetail presentation={presentation} />}
    />
  );
}

function CommandIcon({
  kind,
  completed,
}: {
  kind: CommandDisplayKind;
  completed: boolean;
}) {
  if (completed) return <Check />;
  if (kind === "read") return <FileText />;
  if (kind === "list") return <FolderTree />;
  if (kind === "search") return <Search />;
  return <SquareTerminal />;
}
