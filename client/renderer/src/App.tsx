import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { AuthGate } from "@/components/auth";
import { OnboardingView } from "@/components/onboarding";
import { SettingsPage } from "@/components/settings";
import { WorkbenchRoot } from "@/components/workbench/WorkbenchRoot";
import type { Page } from "@/components/workbench/types";
import {
  WorkflowChatShellFixturePage,
  WorkflowCodexFixturePage,
  TaskContextFixturePage,
} from "@/components/workflow-chat";
import { useThemeSync } from "@/hooks/use-theme";
import { useWatermark } from "@/hooks/use-watermark";
import {
  initAnalytics,
  trackSessionEnd,
  trackSessionStart,
} from "@/lib/analytics";
import { notify } from "@/lib/notifications";
import { useOnboardingStore } from "@/stores/onboarding-store";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import { createItemEventBatcher } from "@/stores/item-event-batcher";
import { useSettingsStore } from "@/stores/settings-store";
import { useUpdateStore } from "@/stores/update-store";
import { useThemeStore } from "@/stores/theme-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type {
  AgentSettings,
  PermissionDialogRequest,
  WorkspaceSettings,
} from "@shared/types";
import type { UIEvent } from "@shared/ui-protocol";
import type { WorkflowTurnItem } from "@shared/workflow-read-thread-contract";
import type { MessageItem } from "@shared/workflow-types";
import { messageItemToWorkflowTurnItem } from "@shared/adapters/message-item-to-workflow-turn-item";

let initialConfigLogged = false;
const runtimeInitLogKeys = new Set<string>();

export default function App() {
  const workflowFixture = new URLSearchParams(window.location.search).get(
    "workflowFixture",
  );
  if (import.meta.env.DEV && workflowFixture === "chatShell") {
    applyCodexFixtureTheme();
    return <WorkflowChatShellFixturePage />;
  }
  if (import.meta.env.DEV && workflowFixture === "codex") {
    applyCodexFixtureTheme();
    return <WorkflowCodexFixturePage />;
  }
  if (import.meta.env.DEV && workflowFixture === "taskContext") {
    applyCodexFixtureTheme();
    return <TaskContextFixturePage />;
  }

  return <MainApp />;
}

function MainApp() {
  useThemeSync();

  return (
    <>
      <AuthGate>
        <AuthenticatedApp />
      </AuthGate>
      <Toaster
        position="top-right"
        closeButton
        richColors={false}
        expand={false}
        visibleToasts={3}
        duration={3800}
        gap={8}
      />
    </>
  );
}

function applyCodexFixtureTheme(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = "dark";
  root.dataset.themePreference = "dark";
  root.style.colorScheme = "dark";
  root.classList.add("dark");
  root.classList.remove("light", "warm");
}

function AuthenticatedApp() {
  useWatermark();
  const [page, setPage] = useState<Page>("chat");
  const [permissionRequests, setPermissionRequests] = useState<
    PermissionDialogRequest[]
  >([]);
  const [isReady, setIsReady] = useState(false);
  // WA 上报初始化（对齐 marloues-client App.tsx initTracking）
  useEffect(() => {
    void initAnalytics().catch((error) => {
      console.warn("[App] Analytics init failed:", error);
    });
  }, []);
  const isDark = useThemeStore((state) => state.isDark);
  const themeMode = useThemeStore((state) => state.mode);
  const onboardingCompleted = useOnboardingStore((state) => state.completed);
  const workspace = useWorkspaceStore((state) => state.current);
  const toggleTheme = useThemeStore((state) => state.toggle);
  const loadSettings = useSettingsStore((state) => state.load);
  const loadWorkspace = useWorkspaceStore((state) => state.load);
  const loadChats = useUnifiedChatStore((state) => state.load);
  const activeSessionId = useUnifiedChatStore((state) => state.activeSessionId);
  const handleEvent = useUnifiedChatStore((state) => state.handleEvent);
  const handleItemEvent = useUnifiedChatStore((state) => state.handleItemEvent);
  const handleReadThread = useUnifiedChatStore(
    (state) => state.handleReadThread,
  );
  const applyPendingState = useUnifiedChatStore(
    (state) => state.applyPendingState,
  );

  useEffect(() => {
    void (async () => {
      await Promise.all([loadSettings(), loadWorkspace()]);
      // loadChats() is now handled by the workspace watcher useEffect below,
      // which fires whenever workspace?.id changes (covers add/remove/switch
      // through onboarding, sidebar, or any other path).
      const [settings, workspaceSettings] = await Promise.all([
        window.marloues.config.getAgentSettings(),
        window.marloues.workspace.getSettings(),
      ]);
      logRendererInitialConfig(settings, workspaceSettings);
      setIsReady(true);
    })();
    const unsubscribeChat = window.marloues.chat.onEvent((event) => {
      logRendererRuntimeInit(event);
      notifyAgentEvent(event);
      handleEvent(event);
    });
    const itemEventBatcher = createItemEventBatcher({
      handleEvent: handleItemEvent,
    });
    const unsubscribeItemEvent = window.marloues.chat.onItemEvent(
      (rawEvent) => {
        const event = rawEvent as {
          type: string;
          sessionId: string;
          turnId: string;
          item?: MessageItem;
          items?: MessageItem[];
          startedAt?: number;
          completedAt?: number;
          final?: boolean;
          result?: string;
          error?: string;
        };
        const item = event.item
          ? messageItemToWorkflowTurnItem(event.item)
          : undefined;
        const items = event.items
          ? event.items
              .map(messageItemToWorkflowTurnItem)
              .filter((candidate): candidate is WorkflowTurnItem =>
                Boolean(candidate),
              )
          : undefined;
        itemEventBatcher.handle({
          type: event.type,
          sessionId: event.sessionId,
          turnId: event.turnId,
          startedAt: event.startedAt,
          completedAt: event.completedAt,
          final: event.final,
          result: event.result,
          error: event.error,
          item,
          items,
        });
      },
    );
    const unsubscribeReadThread = window.marloues.chat.onReadThread(
      (snapshot) => {
        handleReadThread(snapshot);
      },
    );
    const unsubscribePermission = window.marloues.chat.onPermissionRequest(
      (request) => {
        setPermissionRequests((requests) => [
          ...requests.filter((item) => item.id !== request.id),
          request,
        ]);
      },
    );
    const unsubscribePendingState = window.marloues.chat.onPendingState(
      (snapshot) => {
        applyPendingState(snapshot);
      },
    );
    const unsubscribeUpdateState = window.marloues.update.onState((state) => {
      useUpdateStore.getState().applyState(state);
    });
    void useUpdateStore.getState().load();
    return () => {
      unsubscribeChat();
      unsubscribeItemEvent();
      itemEventBatcher.flush();
      itemEventBatcher.dispose();
      unsubscribeReadThread();
      unsubscribePermission();
      unsubscribePendingState();
      unsubscribeUpdateState();
    };
  }, [
    handleEvent,
    handleItemEvent,
    handleReadThread,
    applyPendingState,
    loadSettings,
    loadWorkspace,
  ]);

  // Reload sessions whenever the active workspace changes.
  // This covers ALL workspace transitions: initial load, sidebar switch,
  // sidebar add, sidebar remove, and onboarding workspace selection.
  // Without this, deleting the only workspace (→ onboarding view) and
  // re-adding it via the folder picker leaves the sessions list empty
  // because the onboarding flow never calls loadChats().
  useEffect(() => {
    if (!workspace) return;
    void loadChats();
  }, [workspace, loadChats]);

  // Runtime guard: onboarding is considered needed if the localStorage flag is
  // not set OR if no workspace is currently selected (e.g. it was removed).
  const needsOnboarding = !onboardingCompleted || !workspace;

  const activePermissionRequest =
    permissionRequests.find(
      (request) => request.sessionId === activeSessionId,
    ) ?? permissionRequests.find((request) => !request.sessionId);
  const respondToPermission = (
    approved: boolean,
    scope?: "once" | "session",
    reason?: string,
  ) => {
    if (!activePermissionRequest) return;
    window.marloues.chat.respondToPermission(
      activePermissionRequest.id,
      approved,
      scope,
      reason,
    );
    setPermissionRequests((requests) =>
      requests.filter((request) => request.id !== activePermissionRequest.id),
    );
  };

  if (!isReady) return null;

  if (needsOnboarding) {
    return (
      <>
        <OnboardingView />
        <SettingsPage />
      </>
    );
  }

  return (
    <WorkbenchRoot
      page={page}
      onPage={setPage}
      isDark={isDark}
      themeMode={themeMode}
      onToggleTheme={toggleTheme}
      permissionRequest={activePermissionRequest}
      pendingPermissionSessionIds={permissionRequests.flatMap((request) =>
        request.sessionId ? [request.sessionId] : [],
      )}
      onPermissionRespond={respondToPermission}
    />
  );
}

function notifyAgentEvent(event: UIEvent): void {
  if (event.type === "turn.start") {
    trackSessionStart({ conversationId: event.sessionId });
  }
  if (event.type === "turn.complete" && event.result === "success") {
    trackSessionEnd({ result: "success", conversationId: event.sessionId });
    notify({
      title: "Task complete",
      description: "The current conversation has been saved to history.",
      tone: "success",
    });
  }
  if (event.type === "turn.complete" && event.result === "error") {
    trackSessionEnd({
      result: "failure",
      conversationId: event.sessionId,
      errorType: event.error,
    });
    notify({
      title: "Task complete",
      description: "The current conversation has been saved to history.",
      tone: "error",
    });
  }
  if (event.type === "error") {
    notify({
      title: "Runtime error",
      description: event.message,
      tone: "error",
    });
  }
}

function logRendererInitialConfig(
  settings: AgentSettings,
  workspaceSettings: WorkspaceSettings,
): void {
  if (initialConfigLogged) return;
  initialConfigLogged = true;
  const summary = {
    endpointProfileCount: settings.providers.length,
    enabledEndpointProfiles: settings.providers
      .filter((provider) => provider.enabled)
      .map((provider) => provider.id),
    defaultModel: settings.defaultModel,
    mcpServerCount: settings.mcpServers.length,
    enabledMcpServers: settings.mcpServers
      .filter((server) => server.enabled)
      .map((server) => server.name),
    allowedToolCount: settings.toolPermissionPolicy?.allowedTools?.length ?? 0,
    disallowedToolCount:
      settings.toolPermissionPolicy?.disallowedTools?.length ?? 0,
    currentWorkspaceId: workspaceSettings.currentWorkspaceId,
    workspaceCount: workspaceSettings.workspaces.length,
    workspaces: workspaceSettings.workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      path: workspace.path,
    })),
  };
  console.info(`[marloues:init] config.loaded ${JSON.stringify(summary)}`);
  console.info(
    [
      "[marloues:init] config.details",
      "endpointProfiles:",
      ...settings.providers.map(
        (provider) =>
          `  - ${provider.id} (${provider.kind}) enabled=${provider.enabled} purpose=${provider.purpose ?? "dev"} models=${provider.models.map((model) => model.id).join(", ") || "(none)"}`,
      ),
      "defaultModel:",
      `  provider=${settings.defaultModel.providerId}`,
      `  model=${settings.defaultModel.modelId}`,
      "mcpServers:",
      ...settings.mcpServers.map(
        (server) =>
          `  - ${server.name} enabled=${server.enabled} status=${server.lastStatus ?? "unknown"} tools=${server.tools?.join(", ") || "(none)"}`,
      ),
      "workspaces:",
      ...workspaceSettings.workspaces.map(
        (workspace) => `  - ${workspace.name} ${workspace.path}`,
      ),
    ].join("\n"),
  );
}

function logRendererRuntimeInit(event: UIEvent): void {
  if (event.type === "session.info") {
    if (hasLoggedRuntimeInit(event.turnId, event.type)) return;
    const summary = {
      sessionId: event.sessionId,
      turnId: event.turnId,
      skillCount: event.skills.length,
      skills: event.skills,
      slashCommandCount: event.slashCommands.length,
      slashCommands: event.slashCommands,
      agentCount: event.agents.length,
      agents: event.agents,
    };
    console.info(`[marloues:init] sessionInfo ${JSON.stringify(summary)}`);
    console.info(
      [
        `[marloues:init] sessionInfo.details ${event.turnId}`,
        "skills:",
        ...formatConsoleList(event.skills),
        "slashCommands:",
        ...formatConsoleList(event.slashCommands),
        "agents:",
        ...formatConsoleList(event.agents),
      ].join("\n"),
    );
  }
  if (event.type === "mcp.status") {
    if (hasLoggedRuntimeInit(event.turnId, event.type)) return;
    const summary = {
      sessionId: event.sessionId,
      turnId: event.turnId,
      serverCount: event.servers.length,
      servers: event.servers,
      toolCount: event.tools?.length ?? 0,
      tools: event.tools ?? [],
    };
    console.info(`[marloues:init] mcpStatus ${JSON.stringify(summary)}`);
    console.info(
      [
        `[marloues:init] mcpStatus.details ${event.turnId}`,
        "servers:",
        ...formatConsoleList(
          event.servers.map((server) => formatRuntimeServer(server)),
        ),
        "tools:",
        ...formatConsoleList(event.tools ?? []),
      ].join("\n"),
    );
  }
}

function hasLoggedRuntimeInit(
  turnId: string,
  type: "session.info" | "mcp.status",
): boolean {
  const key = `${turnId}:${type}`;
  if (runtimeInitLogKeys.has(key)) return true;
  runtimeInitLogKeys.add(key);
  if (runtimeInitLogKeys.size > 100) {
    const oldestKey = runtimeInitLogKeys.values().next().value;
    if (oldestKey) runtimeInitLogKeys.delete(oldestKey);
  }
  return false;
}

function formatConsoleList(items: string[]): string[] {
  return items.length ? items.map((item) => `  - ${item}`) : ["  (none)"];
}

function formatRuntimeServer(server: unknown): string {
  if (!server || typeof server !== "object") return String(server);
  const record = server as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : "(unnamed)";
  const status = typeof record.status === "string" ? record.status : "unknown";
  const error =
    typeof record.error === "string" ? ` error=${record.error}` : "";
  return `${name} status=${status}${error}`;
}
