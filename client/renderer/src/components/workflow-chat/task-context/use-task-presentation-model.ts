import { useCallback, useEffect, useMemo, useState } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { WorkspaceGitContext } from "@shared/types";
import { workspacePathsEqual } from "@shared/workspace-path";
import {
  buildTaskPresentationModel,
  taskFocusTurn,
} from "./task-presentation-model";

export function useTaskPresentationModel() {
  const activeSessionId = useUnifiedChatStore((state) => state.activeSessionId);
  const activeSession = useUnifiedChatStore((state) =>
    state.activeSessionId
      ? state.sessions.find((session) => session.id === state.activeSessionId)
      : undefined,
  );
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
  const workspace =
    workspaceSettings.workspaces.find((item) =>
      workspacePathsEqual(item.path, activeSession?.workspacePath),
    ) ?? currentWorkspace;
  const focusTurn = taskFocusTurn(readThread);
  const refreshKey = `${workspace?.id ?? "none"}:${focusTurn?.id ?? "none"}:${focusTurn?.status ?? "none"}:${focusTurn?.completedAt ?? ""}`;
  const [gitState, setGitState] = useState<{
    workspaceId?: string;
    context: WorkspaceGitContext | null;
    loading: boolean;
  }>({ context: null, loading: false });

  const refreshGitContext = useCallback(async () => {
    // Marloues main process does not expose git context yet: the task
    // presentation falls back to a null git branch.
    setGitState({ context: null, loading: false });
  }, []);

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
