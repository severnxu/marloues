import {
  type SetStateAction,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bot,
  Brain,
  FileText,
  Terminal,
  UserRoundCog,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FileExplorer, MemoryPanel, OutputsPanel, ReviewPanel } from "./panels";
import { workflowItemsToTimeline } from "./panels/workflow-items-to-timeline";
import { SubagentWorkspace } from "@/components/workflow-chat";
import type { TimelineItem } from "@shared/types";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { type ReviewTarget, useInspectorStore } from "@/stores/inspector-store";
import type { ExecutionSubagentRecord } from "@/stores/unified-chat-store";
import {
  AUXILIARY_VIEW_ICONS,
  AUXILIARY_VIEW_LABELS,
  AUXILIARY_VIEW_OPTIONS,
} from "./catalog";
import { AuxiliaryHeader } from "./AuxiliaryHeader";
import {
  AuxiliaryEmptyLauncher,
  AuxiliaryViewHost,
  AuxiliaryViewPanel,
} from "./AuxiliaryViewHost";
import {
  auxiliaryTabDomId,
  type AuxiliaryHeaderTab,
  type AuxiliaryStaticViewType,
} from "./types";

interface TabState {
  id: string;
  type: AuxiliaryStaticViewType | "subagent";
  subagentId?: string;
  reviewTarget?: ReviewTarget;
}

interface SessionAuxiliaryState {
  tabs: TabState[];
  activeTabId: string | null;
  closedSubagentTabs: Set<string>;
}

const EMPTY_SESSION_AUXILIARY_STATE: SessionAuxiliaryState = {
  tabs: [],
  activeTabId: null,
  closedSubagentTabs: new Set(),
};
const NO_SESSION_SCOPE = "__no-session__";

function resolveStateAction<T>(action: SetStateAction<T>, previous: T): T {
  return typeof action === "function"
    ? (action as (value: T) => T)(previous)
    : action;
}

const SUBAGENT_ICONS: LucideIcon[] = [
  Bot,
  Brain,
  UserRoundCog,
  Terminal,
  FileText,
  Wrench,
];

let nextTabId = 0;
function makeTabId(): string {
  return `tab-${++nextTabId}`;
}

const REVIEW_TAB_ID = "review-tab";

function subagentTabId(subagentId: string): string {
  return `subagent-tab:${subagentId}`;
}

function iconFromSeed(seed: string): LucideIcon {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return SUBAGENT_ICONS[hash % SUBAGENT_ICONS.length];
}

export function AuxiliarySidebar({
  open,
  primary,
  onTogglePrimary,
}: {
  open: boolean;
  primary: boolean;
  onTogglePrimary: () => void;
}) {
  const activeSessionId = useUnifiedChatStore((state) => state.activeSessionId);
  const sessionScope = activeSessionId ?? NO_SESSION_SCOPE;
  const [auxiliaryStateBySession, setAuxiliaryStateBySession] = useState<
    Record<string, SessionAuxiliaryState>
  >({});
  const auxiliaryState =
    auxiliaryStateBySession[sessionScope] ?? EMPTY_SESSION_AUXILIARY_STATE;
  const { tabs, activeTabId, closedSubagentTabs } = auxiliaryState;

  const updateAuxiliaryState = useCallback(
    (update: (state: SessionAuxiliaryState) => SessionAuxiliaryState) => {
      setAuxiliaryStateBySession((current) => {
        const previous = current[sessionScope] ?? EMPTY_SESSION_AUXILIARY_STATE;
        const next = update(previous);
        return next === previous
          ? current
          : { ...current, [sessionScope]: next };
      });
    },
    [sessionScope],
  );
  const setTabs = useCallback(
    (action: SetStateAction<TabState[]>) => {
      updateAuxiliaryState((previous) => {
        const next = resolveStateAction(action, previous.tabs);
        return next === previous.tabs ? previous : { ...previous, tabs: next };
      });
    },
    [updateAuxiliaryState],
  );
  const setActiveTabId = useCallback(
    (action: SetStateAction<string | null>) => {
      updateAuxiliaryState((previous) => {
        const next = resolveStateAction(action, previous.activeTabId);
        return next === previous.activeTabId
          ? previous
          : { ...previous, activeTabId: next };
      });
    },
    [updateAuxiliaryState],
  );
  const setClosedSubagentTabs = useCallback(
    (action: SetStateAction<Set<string>>) => {
      updateAuxiliaryState((previous) => {
        const next = resolveStateAction(action, previous.closedSubagentTabs);
        return next === previous.closedSubagentTabs
          ? previous
          : { ...previous, closedSubagentTabs: next };
      });
    },
    [updateAuxiliaryState],
  );

  const launcherFirstActionRef = useRef<HTMLButtonElement>(null);
  const handledRevealBySessionRef = useRef(new Map<string, number>());
  const handledReviewSeqRef = useRef<number | null>(null);

  const readThread = useUnifiedChatStore((state) =>
    activeSessionId ? state.readThreads[activeSessionId] : undefined,
  );
  const workspace = useWorkspaceStore((state) => state.current);
  const executionState = useUnifiedChatStore((state) =>
    activeSessionId
      ? (state.executionBySession[activeSessionId] ?? null)
      : null,
  );
  const subagents = useMemo(
    () =>
      Object.values(executionState?.subagents ?? {}).sort(
        (a, b) => a.ordinal - b.ordinal,
      ),
    [executionState?.subagents],
  );
  const subagentById = useMemo(() => {
    const map = new Map<string, ExecutionSubagentRecord>();
    for (const subagent of subagents) map.set(subagent.id, subagent);
    return map;
  }, [subagents]);
  const subagentIdsKey = subagents.map((subagent) => subagent.id).join("|");
  const selectExecutionSubagent = useUnifiedChatStore(
    (state) => state.selectExecutionSubagent,
  );
  const { timeline, sessionTimeline } = useMemo(() => {
    if (!readThread) {
      return {
        timeline: [] as TimelineItem[],
        sessionTimeline: [] as TimelineItem[],
      };
    }
    const sessionTimeline = workflowItemsToTimeline(readThread.turns);
    const runningTurn = readThread.turns.find(
      (turn) => turn.status === "running",
    );
    const focusTurn = runningTurn ?? readThread.turns[0];
    const timeline = focusTurn ? workflowItemsToTimeline([focusTurn]) : [];
    return { timeline, sessionTimeline };
  }, [readThread]);

  const reviewTarget = useInspectorStore((state) => state.reviewTarget);

  useEffect(() => {
    setTabs((prev) => {
      const openSubagentIds = new Set(
        subagents
          .map((subagent) => subagent.id)
          .filter((id) => !closedSubagentTabs.has(id)),
      );
      const existingSubagentIds = new Set(
        prev
          .filter((tab) => tab.type === "subagent" && tab.subagentId)
          .map((tab) => tab.subagentId as string),
      );
      const next = prev.filter(
        (tab) =>
          tab.type !== "subagent" ||
          (tab.subagentId ? openSubagentIds.has(tab.subagentId) : false),
      );
      for (const subagent of subagents) {
        if (
          closedSubagentTabs.has(subagent.id) ||
          existingSubagentIds.has(subagent.id)
        ) {
          continue;
        }
        next.push({
          id: subagentTabId(subagent.id),
          type: "subagent",
          subagentId: subagent.id,
        });
      }
      return next;
    });
  }, [closedSubagentTabs, setTabs, subagentIdsKey, subagents]);

  useEffect(() => {
    const selectedId = executionState?.selectedSubagentId;
    const revealSeq = executionState?.revealSubagentSeq;
    if (
      !activeSessionId ||
      !selectedId ||
      !revealSeq ||
      !subagentById.has(selectedId) ||
      handledRevealBySessionRef.current.get(activeSessionId) === revealSeq
    ) {
      return;
    }
    handledRevealBySessionRef.current.set(activeSessionId, revealSeq);
    setClosedSubagentTabs((prev) => {
      if (!prev.has(selectedId)) return prev;
      const next = new Set(prev);
      next.delete(selectedId);
      return next;
    });
    setActiveTabId(subagentTabId(selectedId));
  }, [
    activeSessionId,
    executionState?.revealSubagentSeq,
    executionState?.selectedSubagentId,
    setActiveTabId,
    setClosedSubagentTabs,
    subagentById,
  ]);

  useEffect(() => {
    if (!reviewTarget || handledReviewSeqRef.current === reviewTarget.seq) {
      return;
    }
    handledReviewSeqRef.current = reviewTarget.seq;
    setTabs((prev) => {
      const existing = prev.find((tab) => tab.type === "review");
      if (!existing) {
        return [...prev, { id: REVIEW_TAB_ID, type: "review", reviewTarget }];
      }
      return prev.map((tab) =>
        tab.type === "review" ? { ...tab, reviewTarget } : tab,
      );
    });
    setActiveTabId(REVIEW_TAB_ID);
  }, [reviewTarget, reviewTarget?.seq, setActiveTabId, setTabs]);

  const addTab = useCallback(
    (type: AuxiliaryStaticViewType) => {
      const existing = tabs.find((tab) => tab.type === type);
      const id = existing?.id ?? makeTabId();
      if (!existing) setTabs((prev) => [...prev, { id, type }]);
      setActiveTabId(id);
    },
    [setActiveTabId, setTabs, tabs],
  );

  const focusTabAfterUpdate = useCallback((id: string | null) => {
    window.setTimeout(() => {
      if (id) document.getElementById(auxiliaryTabDomId(id))?.focus();
      else launcherFirstActionRef.current?.focus();
    }, 0);
  }, []);

  const removeTab = useCallback(
    (id: string) => {
      const tab = tabs.find((item) => item.id === id);
      if (tab?.type === "subagent" && tab.subagentId) {
        setClosedSubagentTabs((prev) => new Set(prev).add(tab.subagentId!));
      }
      setTabs((prev) => {
        const idx = prev.findIndex((tab) => tab.id === id);
        const next = prev.filter((tab) => tab.id !== id);
        if (next.length === 0) {
          setActiveTabId(null);
          focusTabAfterUpdate(null);
          return next;
        }
        let nextActiveId = activeTabId;
        if (activeTabId === id) {
          const newIdx = Math.min(idx, next.length - 1);
          nextActiveId = next[newIdx].id;
          setActiveTabId(nextActiveId);
        }
        focusTabAfterUpdate(nextActiveId ?? next[0].id);
        return next;
      });
    },
    [
      activeTabId,
      focusTabAfterUpdate,
      setActiveTabId,
      setClosedSubagentTabs,
      setTabs,
      tabs,
    ],
  );

  // Keep the selected tab session-specific, but defer mounting its potentially
  // large body until after the session switch has painted. This avoids showing
  // stale content without turning session isolation into a destructive reset.
  const deferredSessionScope = useDeferredValue(sessionScope);
  const deferredActiveTabId = useDeferredValue(activeTabId);
  const activeTab =
    deferredSessionScope === sessionScope
      ? (tabs.find((tab) => tab.id === deferredActiveTabId) ?? null)
      : null;

  useEffect(() => {
    if (!activeTabId) return;
    const el = document.getElementById(auxiliaryTabDomId(activeTabId));
    el?.scrollIntoView({
      inline: "nearest",
      block: "nearest",
      behavior: "smooth",
    });
  }, [activeTabId]);

  const moveTab = useCallback(
    (from: number, to: number) => {
      if (from === to) return;
      setTabs((prev) => {
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    },
    [setTabs],
  );

  const activateTab = useCallback(
    (id: string) => {
      const tab = tabs.find((item) => item.id === id);
      setActiveTabId(id);
      if (activeSessionId && tab?.type === "subagent" && tab.subagentId) {
        selectExecutionSubagent(activeSessionId, tab.subagentId);
      }
    },
    [activeSessionId, selectExecutionSubagent, setActiveTabId, tabs],
  );

  const tabLabel = useCallback(
    (tab: TabState): string => {
      if (tab.type !== "subagent") return AUXILIARY_VIEW_LABELS[tab.type];
      const subagent = tab.subagentId ? subagentById.get(tab.subagentId) : null;
      if (!subagent) return "子代理";
      const name = (subagent.agentName ?? subagent.agentType ?? "").trim();
      if (name && name.toLowerCase() !== "agent") return name;
      const description = subagent.description ?? subagent.title;
      if (description?.trim()) return compactTabLabel(description);
      return `#${subagent.ordinal}`;
    },
    [subagentById],
  );

  const headerTabs = useMemo<AuxiliaryHeaderTab[]>(
    () =>
      tabs.map((tab) => ({
        id: tab.id,
        label: tabLabel(tab),
        icon:
          tab.type === "subagent"
            ? iconFromSeed(tab.subagentId ?? tab.id)
            : AUXILIARY_VIEW_ICONS[tab.type],
        selected: tab.id === activeTabId,
      })),
    [activeTabId, tabLabel, tabs],
  );

  const availableViews = useMemo(
    () =>
      AUXILIARY_VIEW_OPTIONS.filter(
        (option) => !tabs.some((tab) => tab.type === option.type),
      ),
    [tabs],
  );

  return (
    <aside className={`inspector ${tabs.length === 0 ? "tabs-empty" : ""}`}>
      <AuxiliaryHeader
        open={open}
        primary={primary}
        tabs={headerTabs}
        availableViews={availableViews}
        onActivate={activateTab}
        onCloseTab={removeTab}
        onMoveTab={moveTab}
        onOpenView={addTab}
        onTogglePrimary={onTogglePrimary}
      />

      <AuxiliaryViewHost>
        {tabs.length === 0 ? (
          <AuxiliaryEmptyLauncher
            options={AUXILIARY_VIEW_OPTIONS}
            firstActionRef={launcherFirstActionRef}
            onOpenView={addTab}
          />
        ) : null}
        {tabs.map((tab) => (
          <AuxiliaryViewPanel
            key={tab.id}
            tabId={tab.id}
            active={activeTab?.id === tab.id}
          >
            {tab.type === "files" ? (
              <FileExplorer workspacePath={workspace?.path} />
            ) : tab.type === "subagent" &&
              tab.subagentId &&
              subagentById.has(tab.subagentId) ? (
              <SubagentWorkspace subagentId={tab.subagentId} />
            ) : tab.type === "outputs" ? (
              <OutputsPanel timeline={timeline} />
            ) : tab.type === "memory" ? (
              <MemoryPanel
                workspacePath={workspace?.path}
                timeline={sessionTimeline}
              />
            ) : tab.type === "review" ? (
              <ReviewPanel
                reviewTarget={tab.reviewTarget ?? null}
                timeline={sessionTimeline}
              />
            ) : null}
          </AuxiliaryViewPanel>
        ))}
      </AuxiliaryViewHost>
    </aside>
  );
}

function compactTabLabel(value: string): string {
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length <= 22) return text;
  return `${text.slice(0, 21).trimEnd()}…`;
}
