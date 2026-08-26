import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentSettings,
  ChatForkRequest,
  ChatResendRequest,
  ChatRewindRequest,
  ChatSendRequest,
  McpServerConfig,
  ModelProviderConfig,
  MarlouesAPI,
  PermissionDialogRequest,
} from "@shared/types";
import type { UpdateState } from "@shared/hot-update";
import { IM_IPC } from "@shared/im/im-ipc";
import type { FeishuQrCodePush, FeishuQrStatusPush } from "@shared/im/im-ipc";
import type {
  ImChannelId,
  ImChannelStatus,
  ImChannelSecretsConfig,
} from "@shared/im/im-types";
import { IPC } from "@shared/types";
import type { UIEvent } from "@shared/ui-protocol";

const api: MarlouesAPI = {
  auth: {
    getStatus: () => ipcRenderer.invoke(IPC.AUTH_GET_STATUS),
    openLogin: () => ipcRenderer.invoke(IPC.AUTH_OPEN_LOGIN),
    openRegister: () => ipcRenderer.invoke(IPC.AUTH_OPEN_REGISTER),
    logout: () => ipcRenderer.invoke(IPC.AUTH_LOGOUT),
    onStatusChanged: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        status: Awaited<ReturnType<MarlouesAPI["auth"]["getStatus"]>>,
      ) => callback(status);
      ipcRenderer.on(IPC.AUTH_STATUS_CHANGED, listener);
      return () => ipcRenderer.off(IPC.AUTH_STATUS_CHANGED, listener);
    },
  },
  app: {
    platform: process.platform,
    getVersion: () => ipcRenderer.invoke(IPC.APP_GET_VERSION),
    getVersionInfo: () => ipcRenderer.invoke(IPC.APP_GET_VERSION_INFO),
    markRendererReady: (info) =>
      ipcRenderer.invoke(IPC.APP_RENDERER_READY, info),
    exportDiagnostics: () => ipcRenderer.invoke(IPC.APP_EXPORT_DIAGNOSTICS),
  },
  update: {
    getState: () => ipcRenderer.invoke(IPC.UPDATE_GET_STATE),
    getPreferences: () => ipcRenderer.invoke(IPC.UPDATE_GET_PREFERENCES),
    savePreferences: (preferences) =>
      ipcRenderer.invoke(IPC.UPDATE_SAVE_PREFERENCES, preferences),
    check: () => ipcRenderer.invoke(IPC.UPDATE_CHECK),
    download: () => ipcRenderer.invoke(IPC.UPDATE_DOWNLOAD),
    installNow: () => ipcRenderer.invoke(IPC.UPDATE_INSTALL_NOW),
    onState: (callback: (state: UpdateState) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        state: UpdateState,
      ) => callback(state);
      ipcRenderer.on(IPC.UPDATE_STATE, listener);
      return () => ipcRenderer.off(IPC.UPDATE_STATE, listener);
    },
  },
  window: {
    minimize: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
    setMaximized: (maximized: boolean) =>
      ipcRenderer.invoke(IPC.WINDOW_SET_MAXIMIZED, maximized),
    close: () => ipcRenderer.send(IPC.WINDOW_CLOSE),
    isMaximized: () => ipcRenderer.invoke(IPC.WINDOW_IS_MAXIMIZED),
    setTheme: (mode, background, nativeTheme) =>
      ipcRenderer.send(IPC.WINDOW_SET_THEME, mode, background, nativeTheme),
    onMaximizedChanged: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        maximized: boolean,
      ) => callback(maximized);
      ipcRenderer.on(IPC.WINDOW_MAXIMIZED_CHANGED, listener);
      return () => ipcRenderer.off(IPC.WINDOW_MAXIMIZED_CHANGED, listener);
    },
    onMaximizedChange: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        maximized: boolean,
      ) => callback(maximized);
      ipcRenderer.on(IPC.WINDOW_MAXIMIZED_CHANGED, listener);
      return () => ipcRenderer.off(IPC.WINDOW_MAXIMIZED_CHANGED, listener);
    },
  },
  workspace: {
    select: () => ipcRenderer.invoke(IPC.WORKSPACE_SELECT),
    switch: (workspaceId: string) =>
      ipcRenderer.invoke(IPC.WORKSPACE_SWITCH, workspaceId),
    rename: (workspaceId: string, name: string) =>
      ipcRenderer.invoke(IPC.WORKSPACE_RENAME, workspaceId, name),
    remove: (workspaceId: string) =>
      ipcRenderer.invoke(IPC.WORKSPACE_REMOVE, workspaceId),
    getCurrent: () => ipcRenderer.invoke(IPC.WORKSPACE_GET_CURRENT),
    getSettings: () => ipcRenderer.invoke(IPC.WORKSPACE_GET_SETTINGS),
    getGitContext: (workspaceId: string, workspacePath?: string) =>
      ipcRenderer.invoke(
        IPC.WORKSPACE_GET_GIT_CONTEXT,
        workspaceId,
        workspacePath,
      ),
    openInExplorer: (workspaceId: string) =>
      ipcRenderer.invoke(IPC.WORKSPACE_OPEN_IN_EXPLORER, workspaceId),
  },
  fs: {
    listDir: (dirPath: string) => ipcRenderer.invoke(IPC.FS_LIST_DIR, dirPath),
    readFile: (filePath: string) =>
      ipcRenderer.invoke(IPC.FS_READ_FILE, filePath),
    stat: (filePath: string) => ipcRenderer.invoke(IPC.FS_STAT, filePath),
  },
  memory: {
    list: () => ipcRenderer.invoke(IPC.MEMORY_LIST),
    read: (fileId: string) => ipcRenderer.invoke(IPC.MEMORY_READ, fileId),
    write: (fileId: string, content: string) =>
      ipcRenderer.invoke(IPC.MEMORY_WRITE, fileId, content),
  },
  config: {
    getAgentSettings: () => ipcRenderer.invoke(IPC.CONFIG_GET_AGENT_SETTINGS),
    saveAgentSettings: (settings: AgentSettings) =>
      ipcRenderer.invoke(IPC.CONFIG_SAVE_AGENT_SETTINGS, settings),
    testEndpointProfile: (profile: ModelProviderConfig, endpointId?: string) =>
      ipcRenderer.invoke(IPC.CONFIG_TEST_ENDPOINT_PROFILE, profile, endpointId),
    testEndpointModel: (
      profile: ModelProviderConfig,
      modelId: string,
      endpointId?: string,
    ) =>
      ipcRenderer.invoke(
        IPC.CONFIG_TEST_ENDPOINT_MODEL,
        profile,
        modelId,
        endpointId,
      ),
    listEndpointModels: (profile: ModelProviderConfig, endpointId?: string) =>
      ipcRenderer.invoke(IPC.CONFIG_LIST_ENDPOINT_MODELS, profile, endpointId),
  },
  runtime: {
    getState: () => ipcRenderer.invoke(IPC.RUNTIME_GET_STATE),
    switch: (runtimeId) => ipcRenderer.invoke(IPC.RUNTIME_SWITCH, runtimeId),
    listModels: () => ipcRenderer.invoke(IPC.RUNTIME_LIST_MODELS),
    setModel: (providerId, modelId) =>
      ipcRenderer.invoke(IPC.RUNTIME_SET_MODEL, providerId, modelId),
  },
  mcp: {
    listServers: () => ipcRenderer.invoke(IPC.MCP_LIST_SERVERS),
    saveServers: (servers: McpServerConfig[]) =>
      ipcRenderer.invoke(IPC.MCP_SAVE_SERVERS, servers),
    testServer: (server: McpServerConfig) =>
      ipcRenderer.invoke(IPC.MCP_TEST_SERVER, server),
    refreshStatus: () => ipcRenderer.invoke(IPC.MCP_REFRESH_STATUS),
    listTools: () => ipcRenderer.invoke(IPC.MCP_LIST_TOOLS),
  },
  audit: {
    list: (limit?: number) => ipcRenderer.invoke(IPC.AUDIT_LIST, limit),
  },
  im: {
    getConfig: () => ipcRenderer.invoke(IM_IPC.GET_CONFIG),
    saveConfig: (channels: ImChannelSecretsConfig) =>
      ipcRenderer.invoke(IM_IPC.SAVE_CONFIG, channels),
    testChannel: (channel: ImChannelId) =>
      ipcRenderer.invoke(IM_IPC.TEST_CHANNEL, channel),
    listSessions: () => ipcRenderer.invoke(IM_IPC.LIST_SESSIONS),
    onStatus: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        status: ImChannelStatus,
      ) => callback(status);
      ipcRenderer.on(IM_IPC.SET_STATUS, listener);
      return () => ipcRenderer.off(IM_IPC.SET_STATUS, listener);
    },
    onSessionsChanged: (callback) => {
      const listener = () => callback();
      ipcRenderer.on(IM_IPC.SESSION_UPDATED, listener);
      return () => ipcRenderer.off(IM_IPC.SESSION_UPDATED, listener);
    },
    generateWecomQr: () => ipcRenderer.invoke(IM_IPC.WECOM_QR_GENERATE),
    pollWecomQr: (scode: string) =>
      ipcRenderer.invoke(IM_IPC.WECOM_QR_POLL, scode),
    registerFeishuApp: () => ipcRenderer.invoke(IM_IPC.FEISHU_QR_START),
    cancelFeishuRegister: () => ipcRenderer.invoke(IM_IPC.FEISHU_QR_CANCEL),
    onFeishuQrCode: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: FeishuQrCodePush,
      ) => callback(payload);
      ipcRenderer.on(IM_IPC.FEISHU_QR_CODE, listener);
      return () => ipcRenderer.off(IM_IPC.FEISHU_QR_CODE, listener);
    },
    onFeishuQrStatus: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: FeishuQrStatusPush,
      ) => callback(payload);
      ipcRenderer.on(IM_IPC.FEISHU_QR_STATUS, listener);
      return () => ipcRenderer.off(IM_IPC.FEISHU_QR_STATUS, listener);
    },
  },
  skill: {
    list: () => ipcRenderer.invoke(IPC.SKILL_LIST),
    selectImportFolder: () =>
      ipcRenderer.invoke(IPC.SKILL_SELECT_IMPORT_FOLDER),
    importFolder: (path?: string) =>
      ipcRenderer.invoke(IPC.SKILL_IMPORT_FOLDER, path),
    toggle: (skillId: string, enabled: boolean) =>
      ipcRenderer.invoke(IPC.SKILL_TOGGLE, skillId, enabled),
    remove: (skillId: string) => ipcRenderer.invoke(IPC.SKILL_REMOVE, skillId),
    getDetail: (skillId: string) =>
      ipcRenderer.invoke(IPC.SKILL_GET_DETAIL, skillId),
    marketplaceList: (request) =>
      ipcRenderer.invoke(IPC.SKILL_MARKETPLACE_LIST, request),
    marketplaceDetail: (slug: string, version?: string) =>
      ipcRenderer.invoke(IPC.SKILL_MARKETPLACE_DETAIL, slug, version),
    marketplaceInstall: (slug: string, version?: string) =>
      ipcRenderer.invoke(IPC.SKILL_MARKETPLACE_INSTALL, slug, version),
  },
  chat: {
    listSessions: () => ipcRenderer.invoke(IPC.CHAT_LIST_SESSIONS),
    listAllSessions: () => ipcRenderer.invoke(IPC.CHAT_LIST_ALL_SESSIONS),
    searchSessions: (query: string, limit?: number) =>
      ipcRenderer.invoke(IPC.CHAT_SEARCH_SESSIONS, query, limit),
    createSession: () => ipcRenderer.invoke(IPC.CHAT_CREATE_SESSION),
    deleteSession: (sessionId: string) =>
      ipcRenderer.invoke(IPC.CHAT_DELETE_SESSION, sessionId),
    updateSessionTitle: (sessionId: string, title: string) =>
      ipcRenderer.invoke(IPC.CHAT_UPDATE_SESSION_TITLE, sessionId, title),
    toggleSessionPinned: (sessionId: string) =>
      ipcRenderer.invoke(IPC.CHAT_TOGGLE_SESSION_PINNED, sessionId),
    forkSession: (request: ChatForkRequest) =>
      ipcRenderer.invoke(IPC.CHAT_FORK_SESSION, request),
    rewindFiles: (request: ChatRewindRequest) =>
      ipcRenderer.invoke(IPC.CHAT_REWIND_FILES, request),
    exportSession: (sessionId: string) =>
      ipcRenderer.invoke(IPC.CHAT_EXPORT_SESSION, sessionId),
    send: (request: ChatSendRequest) =>
      ipcRenderer.invoke(IPC.CHAT_SEND, request),
    resendFromMessage: (request: ChatResendRequest) =>
      ipcRenderer.invoke(IPC.CHAT_RESEND_FROM_MESSAGE, request),
    abort: (requestId: string) => ipcRenderer.invoke(IPC.CHAT_ABORT, requestId),
    cancelTool: (toolCallId: string) =>
      ipcRenderer.invoke(IPC.CHAT_CANCEL_TOOL, toolCallId),
    compact: (sessionId: string) =>
      ipcRenderer.invoke(IPC.CHAT_COMPACT, sessionId),
    getPendingState: (sessionId?: string) =>
      ipcRenderer.invoke(IPC.CHAT_GET_PENDING_STATE, sessionId),
    resumeOutbox: (sessionId: string, messageId?: string) =>
      ipcRenderer.invoke(IPC.CHAT_RESUME_OUTBOX, sessionId, messageId),
    cancelSteer: (sessionId: string, messageId: string) =>
      ipcRenderer.invoke(IPC.CHAT_CANCEL_STEER, sessionId, messageId),
    applySteerNow: (sessionId: string, messageId: string) =>
      ipcRenderer.invoke(IPC.CHAT_APPLY_STEER_NOW, sessionId, messageId),
    reorderSteers: (sessionId: string, messageIds: string[]) =>
      ipcRenderer.invoke(IPC.CHAT_REORDER_STEERS, sessionId, messageIds),
    onPendingState: (
      callback: (
        snapshot: Awaited<ReturnType<MarlouesAPI["chat"]["getPendingState"]>>,
      ) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        snapshot: Awaited<ReturnType<MarlouesAPI["chat"]["getPendingState"]>>,
      ) => callback(snapshot);
      ipcRenderer.on(IPC.CHAT_PENDING_STATE_UPDATE, listener);
      return () => ipcRenderer.off(IPC.CHAT_PENDING_STATE_UPDATE, listener);
    },
    readThread: (sessionId: string) =>
      ipcRenderer.invoke(IPC.CHAT_READ_THREAD, sessionId),
    onReadThread: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        snapshot: Awaited<ReturnType<MarlouesAPI["chat"]["readThread"]>>,
      ) => {
        callback(snapshot);
      };
      ipcRenderer.on(IPC.CHAT_READ_THREAD_UPDATE, listener);
      return () => ipcRenderer.off(IPC.CHAT_READ_THREAD_UPDATE, listener);
    },
    onEvent: (callback: (event: UIEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, uiEvent: UIEvent) =>
        callback(uiEvent);
      ipcRenderer.on(IPC.CHAT_EVENT, listener);
      return () => ipcRenderer.off(IPC.CHAT_EVENT, listener);
    },
    onItemEvent: (callback: (event: unknown) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        itemEvent: unknown,
      ) => callback(itemEvent);
      ipcRenderer.on(IPC.CHAT_ITEM_EVENT, listener);
      return () => ipcRenderer.off(IPC.CHAT_ITEM_EVENT, listener);
    },
    onPermissionRequest: (
      callback: (request: PermissionDialogRequest) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        request: PermissionDialogRequest,
      ) => callback(request);
      ipcRenderer.on(IPC.CHAT_PERMISSION_REQUEST, listener);
      return () => ipcRenderer.off(IPC.CHAT_PERMISSION_REQUEST, listener);
    },
    respondToPermission: (
      requestId: string,
      approved: boolean,
      scope = "once",
      reason?: string,
    ) =>
      ipcRenderer.send(IPC.CHAT_PERMISSION_RESPONSE, {
        requestId,
        approved,
        scope,
        reason,
      }),
  },
  schedule: {
    list: () => ipcRenderer.invoke(IPC.SCHEDULE_LIST),
    create: (input) => ipcRenderer.invoke(IPC.SCHEDULE_CREATE, input),
    update: (taskId, input) =>
      ipcRenderer.invoke(IPC.SCHEDULE_UPDATE, taskId, input),
    remove: (taskId) => ipcRenderer.invoke(IPC.SCHEDULE_REMOVE, taskId),
    toggle: (taskId) => ipcRenderer.invoke(IPC.SCHEDULE_TOGGLE, taskId),
    runNow: (taskId) => ipcRenderer.invoke(IPC.SCHEDULE_RUN_NOW, taskId),
    listRuns: (taskId, limit) =>
      ipcRenderer.invoke(IPC.SCHEDULE_LIST_RUNS, taskId, limit),
    onChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) =>
        callback(payload as never);
      ipcRenderer.on(IPC.SCHEDULE_CHANGED, listener);
      return () => ipcRenderer.off(IPC.SCHEDULE_CHANGED, listener);
    },
  },
};

contextBridge.exposeInMainWorld("marloues", api);
