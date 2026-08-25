import { useEffect, useMemo, useState } from "react";
import type { ImChannelId } from "@shared/im/im-types";
import type { ChatSessionRecord } from "@shared/types";
import { useImStore } from "@/stores/im-store";
import { useScheduleStore } from "@/stores/schedule-store";
import {
  DailyProjectTree,
  PinnedSessionGroup,
  type DailyProjectTreeProps,
} from "./DailyProjectTree";
import {
  resolveSessionCollectionActivity,
  type SidebarActivityStatus,
} from "./sidebar-activity";
import {
  formatSidebarTimestamp,
  groupImSessions,
  groupScheduledTasks,
  type WorkAreaId,
} from "./sidebar-work-areas";
import {
  WorkAreaLeafRow,
  WorkAreaProjectRow,
  WorkspaceArea,
} from "./WorkAreaPrimitives";

export interface WorkAreaZoneProps extends DailyProjectTreeProps {
  onAddWorkspace: () => void;
}

const PROVIDERS: Array<{ channel: ImChannelId; label: string }> = [
  { channel: "feishu", label: "飞书区" },
  { channel: "wecom", label: "企微区" },
];

export function WorkAreaZone(props: WorkAreaZoneProps) {
  const [expandedAreas, setExpandedAreas] = useState<Set<WorkAreaId>>(
    () => new Set(["daily", "feishu", "wecom", "scheduled"]),
  );
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(
    () => new Set(),
  );
  const statuses = useImStore((state) => state.statuses);
  const imSessions = useImStore((state) => state.sessions);
  const loadImSessions = useImStore((state) => state.loadSessions);
  const subscribeIm = useImStore((state) => state.subscribe);
  const scheduledTasks = useScheduleStore((state) => state.tasks);
  const scheduledRuns = useScheduleStore((state) => state.runs);
  const loadScheduledTasks = useScheduleStore((state) => state.load);
  const loadAllScheduledRuns = useScheduleStore((state) => state.loadAllRuns);
  const subscribeScheduledTasks = useScheduleStore(
    (state) => state.subscribeChanged,
  );

  useEffect(() => {
    void loadImSessions();
    return subscribeIm();
  }, [loadImSessions, subscribeIm]);

  useEffect(() => {
    void loadScheduledTasks().catch(() => undefined);
    return subscribeScheduledTasks();
  }, [loadScheduledTasks, subscribeScheduledTasks]);

  const scheduledTaskKey = scheduledTasks.map((task) => task.id).join("\n");
  useEffect(() => {
    if (!scheduledTaskKey) return;
    void loadAllScheduledRuns().catch(() => undefined);
  }, [loadAllScheduledRuns, scheduledTaskKey]);

  const chatSessionById = useMemo(
    () =>
      new Map(
        Array.from(props.sessionsByWorkspace.values())
          .flat()
          .map((session) => [session.id, session] as const),
      ),
    [props.sessionsByWorkspace],
  );

  const providerGroups = useMemo(
    () =>
      PROVIDERS.map((provider) => {
        const groups = groupImSessions(
          provider.channel,
          imSessions,
          props.projectList,
        )
          .map((group) => ({
            ...group,
            items: group.items.filter(
              (session) => !chatSessionById.get(session.threadId)?.isPinned,
            ),
          }))
          .filter((group) => group.items.length > 0);
        return { ...provider, groups };
      }).filter(
        (provider) =>
          provider.groups.length > 0 || Boolean(statuses[provider.channel]),
      ),
    [chatSessionById, imSessions, props.projectList, statuses],
  );

  const scheduledGroups = useMemo(
    () => groupScheduledTasks(scheduledTasks, props.projectList),
    [props.projectList, scheduledTasks],
  );
  const imSessionIds = useMemo(
    () => new Set(imSessions.map((session) => session.threadId)),
    [imSessions],
  );
  const scheduledSessionIds = useMemo(
    () =>
      new Set(
        Object.values(scheduledRuns)
          .flat()
          .flatMap((run) => (run.sessionId ? [run.sessionId] : [])),
      ),
    [scheduledRuns],
  );
  const dailySessionsByWorkspace = useMemo(() => {
    const map = new Map<string, ChatSessionRecord[]>();
    for (const [path, sessions] of props.sessionsByWorkspace) {
      const dailySessions = sessions.filter(
        (session) =>
          !imSessionIds.has(session.id) && !scheduledSessionIds.has(session.id),
      );
      if (dailySessions.length > 0) map.set(path, dailySessions);
    }
    return map;
  }, [imSessionIds, props.sessionsByWorkspace, scheduledSessionIds]);

  useEffect(() => {
    const activeImSession = imSessions.find(
      (session) => session.threadId === props.activeSessionId,
    );
    if (!activeImSession) return;
    setExpandedAreas((current) => addToSet(current, activeImSession.channel));
    setExpandedBranches((current) =>
      addToSet(
        current,
        getBranchKey(activeImSession.channel, activeImSession.workspacePath),
      ),
    );
  }, [imSessions, props.activeSessionId]);

  useEffect(() => {
    const activeTask = scheduledTasks.find((candidate) =>
      (scheduledRuns[candidate.id] ?? []).some(
        (run) => run.sessionId === props.activeSessionId,
      ),
    );
    if (!activeTask) return;
    setExpandedAreas((current) => addToSet(current, "scheduled"));
    setExpandedBranches((current) =>
      addToSet(current, getBranchKey("scheduled", activeTask.workspacePath)),
    );
  }, [props.activeSessionId, scheduledRuns, scheduledTasks]);

  useEffect(() => {
    const branchKeys = [
      ...providerGroups.flatMap((provider) =>
        provider.groups.map((group) =>
          getBranchKey(provider.channel, group.path),
        ),
      ),
      ...scheduledGroups.map((group) => getBranchKey("scheduled", group.path)),
    ];
    if (branchKeys.length === 0) return;
    setExpandedBranches((current) => {
      let changed = false;
      const next = new Set(current);
      for (const key of branchKeys) {
        if (next.has(key)) continue;
        next.add(key);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [providerGroups, scheduledGroups]);

  const dailyActivity = resolveSessionCollectionActivity(
    props.projectList.flatMap((project) =>
      (dailySessionsByWorkspace.get(project.path) ?? [])
        .filter((session) => !session.isPinned)
        .map((session) => session.id),
    ),
    props.unreadCompletedSessionIds,
    props.runningSessionIds,
  );

  const toggleArea = (area: WorkAreaId) => {
    setExpandedAreas((current) => toggleSetValue(current, area));
  };
  const toggleBranch = (key: string) => {
    setExpandedBranches((current) => toggleSetValue(current, key));
  };

  return (
    <div
      className="work-area-zone scrollbar-thin"
      aria-label="工作区与会话列表"
    >
      <div className="work-area-list">
        <PinnedSessionGroup {...props} />
        {providerGroups.map((provider) => {
          const expanded = expandedAreas.has(provider.channel);
          const providerActivity = getCollectionActivity(
            provider.groups.flatMap((group) =>
              group.items.map((session) => session.threadId),
            ),
            props.unreadCompletedSessionIds,
            props.runningSessionIds,
          );
          return (
            <WorkspaceArea
              key={provider.channel}
              areaId={provider.channel}
              label={provider.label}
              expanded={expanded}
              activity={providerActivity}
              onToggle={() => toggleArea(provider.channel)}
            >
              {provider.groups.map((group) => {
                const branchKey = getBranchKey(provider.channel, group.path);
                const branchExpanded = expandedBranches.has(branchKey);
                const branchActivity = getCollectionActivity(
                  group.items.map((session) => session.threadId),
                  props.unreadCompletedSessionIds,
                  props.runningSessionIds,
                );
                return (
                  <WorkAreaProjectRow
                    key={group.key}
                    name={group.name}
                    title={group.path}
                    expanded={branchExpanded}
                    activity={branchActivity}
                    onToggle={() => toggleBranch(branchKey)}
                  >
                    {group.items.map((session) => (
                      <WorkAreaLeafRow
                        key={session.threadId}
                        title={session.title.replace(/^\[IM\]\s*/, "")}
                        time={formatSidebarTimestamp(session.updatedAt)}
                        active={
                          props.page === "chat" &&
                          props.activeSessionId === session.threadId
                        }
                        activity={
                          getCollectionActivity(
                            [session.threadId],
                            props.unreadCompletedSessionIds,
                            props.runningSessionIds,
                          ) ?? undefined
                        }
                        onOpen={() => {
                          props.onSetActiveSession(session.threadId);
                          props.onPage("chat");
                        }}
                      />
                    ))}
                  </WorkAreaProjectRow>
                );
              })}
            </WorkspaceArea>
          );
        })}

        {scheduledGroups.length > 0 ? (
          <WorkspaceArea
            areaId="scheduled"
            label="定时任务区"
            expanded={expandedAreas.has("scheduled")}
            onToggle={() => toggleArea("scheduled")}
          >
            {scheduledGroups.map((group) => {
              const branchKey = getBranchKey("scheduled", group.path);
              const branchExpanded = expandedBranches.has(branchKey);
              const conversations = group.items
                .flatMap((task) =>
                  (scheduledRuns[task.id] ?? [])
                    .filter((run) => Boolean(run.sessionId))
                    .map((run) => ({ task, run })),
                )
                .sort(
                  (left, right) =>
                    (right.run.startedAt ?? right.run.createdAt) -
                    (left.run.startedAt ?? left.run.createdAt),
                );
              const running = conversations.some(
                ({ run }) => run.status === "running",
              );
              return (
                <WorkAreaProjectRow
                  key={group.key}
                  name={group.name}
                  title={group.path}
                  expanded={branchExpanded}
                  activity={!branchExpanded && running ? "running" : null}
                  onToggle={() => toggleBranch(branchKey)}
                >
                  {conversations.map(({ task, run }) => {
                    const sessionId = run.sessionId!;
                    const session = chatSessionById.get(sessionId);
                    return (
                      <WorkAreaLeafRow
                        key={sessionId}
                        title={(session?.title ?? task.name).replace(
                          /^⏰\s*/,
                          "",
                        )}
                        time={formatSidebarTimestamp(
                          session?.updatedAt ?? run.startedAt ?? run.createdAt,
                        )}
                        active={
                          props.page === "chat" &&
                          props.activeSessionId === sessionId
                        }
                        activity={
                          run.status === "running"
                            ? "running"
                            : (getCollectionActivity(
                                [sessionId],
                                props.unreadCompletedSessionIds,
                                props.runningSessionIds,
                              ) ?? undefined)
                        }
                        onOpen={() => {
                          props.onSetActiveSession(sessionId);
                          props.onPage("chat");
                        }}
                      />
                    );
                  })}
                </WorkAreaProjectRow>
              );
            })}
          </WorkspaceArea>
        ) : null}

        <WorkspaceArea
          areaId="daily"
          label="日常区"
          expanded={expandedAreas.has("daily")}
          activity={dailyActivity}
          onToggle={() => toggleArea("daily")}
          onAdd={props.onAddWorkspace}
        >
          <DailyProjectTree
            {...props}
            sessionsByWorkspace={dailySessionsByWorkspace}
          />
        </WorkspaceArea>
      </div>
    </div>
  );
}

function getBranchKey(area: WorkAreaId, path: string): string {
  return `${area}:${path || "__virtual__"}`;
}

function getCollectionActivity(
  ids: Iterable<string>,
  unreadIds: ReadonlySet<string>,
  runningIds: ReadonlySet<string>,
): SidebarActivityStatus {
  return resolveSessionCollectionActivity(ids, unreadIds, runningIds);
}

function toggleSetValue<T>(current: Set<T>, value: T): Set<T> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function addToSet<T>(current: Set<T>, value: T): Set<T> {
  if (current.has(value)) return current;
  const next = new Set(current);
  next.add(value);
  return next;
}
