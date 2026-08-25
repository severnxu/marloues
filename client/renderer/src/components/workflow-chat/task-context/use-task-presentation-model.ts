import { useCallback, useEffect, useMemo, useState } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type {
  ChatSessionRecord,
  WorkspaceGitContext,
  WorkspaceInfo,
  WorkspaceSettings,
} from "@shared/types";
import {
  normalizeWorkspacePathForCompare,
  workspacePathsEqual,
} from "@shared/workspace-path";
import {
  buildTaskPresentationModel,
  taskFocusTurn,
} from "./task-presentation-model";

export function useTaskPresentationModel() {
  const activeSessionId = useUnifiedChatStore((state) => state.activeSessionId);
  const activeSession = useUnifiedChatStore((state) => {
    const sessionId = state.activeSessionId;
    if (!sessionId) return undefined;
    return (
      state.sessions.find((session) => session.id === sessionId) ??
      state.allSessions.find((session) => session.id === sessionId)
    );
  });
  const readThread = useUnifiedChatStore((state) =>
    state.activeSessionId
      ? state.readThreads[state.activeSessionId]
      : undefined,
  );
  const execution = useUnifiedChatStore((state) =>
    state.activeSessionId
      ? state.executionBySession[state.activeSessionId]
      : undefined,
  );
  const workspaceSettings = useWorkspaceStore((state) => state.settings);
  const currentWorkspace = useWorkspaceStore((state) => state.current);
  const settings = useSettingsStore((state) => state.settings);
  const workspace = resolveTaskWorkspace({
    activeSession,
    workspaceSettings,
    currentWorkspace,
  });
  const focusTurn = taskFocusTurn(readThread);
  const refreshKey = `${workspace?.id ?? "none"}:${workspace?.path ?? "none"}:${focusTurn?.id ?? "none"}:${focusTurn?.status ?? "none"}:${focusTurn?.completedAt ?? ""}`;
  const [gitState, setGitState] = useState<{
    workspaceId?: string;
    context: WorkspaceGitContext | null;
    loading: boolean;
  }>({ context: null, loading: false });

  const refreshGitContext = useCallback(async () => {
    if (!workspace?.id) {
      setGitState({ context: null, loading: false });
      return;
    }
    const workspaceId = workspace.id;
    setGitState((current) => ({
      workspaceId,
      context: current.workspaceId === workspaceId ? current.context : null,
      loading: true,
    }));
    try {
      const context = await window.marloues.workspace.getGitContext(
        workspaceId,
        workspace.path,
      );
      setGitState({ workspaceId, context, loading: false });
    } catch {
      setGitState({ workspaceId, context: null, loading: false });
    }
  }, [workspace?.id, workspace?.path]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshGitContext(), 180);
    return () => window.clearTimeout(timer);
  }, [refreshGitContext, refreshKey]);

  const model = useMemo(
    () =>
      buildTaskPresentationModel({
        sessionId: activeSessionId,
        readThread,
        workspace,
        gitContext:
          gitState.workspaceId === workspace?.id ? gitState.context : null,
        tasks: Object.values(execution?.tasks ?? {}),
        securityMode: settings?.securityMode,
        fallbackModelName: settings?.defaultModel.modelId,
      }),
    [
      activeSessionId,
      execution?.tasks,
      gitState,
      readThread,
      settings?.defaultModel.modelId,
      settings?.securityMode,
      workspace,
    ],
  );

  return {
    model,
    gitLoading: gitState.loading,
    refreshGitContext,
  };
}

export function resolveTaskWorkspace({
  activeSession,
  workspaceSettings,
  currentWorkspace,
}: {
  activeSession?: ChatSessionRecord;
  workspaceSettings: WorkspaceSettings;
  currentWorkspace: WorkspaceInfo | null;
}): WorkspaceInfo | null {
  const session = activeSession;
  const sessionWorkspacePath = session?.workspacePath?.trim();
  if (session && sessionWorkspacePath) {
    const configured = workspaceSettings.workspaces.find((item) =>
      workspacePathsEqual(item.path, sessionWorkspacePath),
    );
    if (configured) return configured;
    return {
      id: `session-workspace:${normalizeWorkspacePathForCompare(
        sessionWorkspacePath,
      )}`,
      name:
        session.workspaceName || workspaceNameFromPath(sessionWorkspacePath),
      path: sessionWorkspacePath,
      lastOpenedAt: session.updatedAt,
    };
  }
  return currentWorkspace;
}

function workspaceNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/g, "");
  return normalized.split("/").filter(Boolean).at(-1) || "工作区";
}
