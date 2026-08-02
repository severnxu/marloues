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
    exportDiagnostics: () => ipcRenderer.invoke(IPC.APP_EXPORT_DIAGNOSTICS),
  },
  window: {
    minimize: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.send(IPC.WINDOW_CLOSE),
    isMaximized: () => ipcRenderer.invoke(IPC.WINDOW_IS_MAXIMIZED),
    onMaximizedChanged: (callback) => {
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
    testEndpointProfile: (profile: ModelProviderConfig) =>
      ipcRenderer.invoke(IPC.CONFIG_TEST_ENDPOINT_PROFILE, profile),
    testEndpointModel: (profile: ModelProviderConfig, modelId: string) =>
      ipcRenderer.invoke(IPC.CONFIG_TEST_ENDPOINT_MODEL, profile, modelId),
    listEndpointModels: (profile: ModelProviderConfig) =>
      ipcRenderer.invoke(IPC.CONFIG_LIST_ENDPOINT_MODELS, profile),
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
  skill: {
    list: () => ipcRenderer.invoke(IPC.SKILL_LIST),
    importFolder: () => ipcRenderer.invoke(IPC.SKILL_IMPORT_FOLDER),
    toggle: (skillId: string, enabled: boolean) =>
      ipcRenderer.invoke(IPC.SKILL_TOGGLE, skillId, enabled),
    remove: (skillId: string) => ipcRenderer.invoke(IPC.SKILL_REMOVE, skillId),
    getDetail: (skillId: string) =>
      ipcRenderer.invoke(IPC.SKILL_GET_DETAIL, skillId),
    marketplaceList: (request) =>
      ipcRenderer.invoke(IPC.SKILL_MARKETPLACE_LIST, request),
    marketplaceDetail: (slug: string) =>
      ipcRenderer.invoke(IPC.SKILL_MARKETPLACE_DETAIL, slug),
    marketplaceInstall: (slug: string) =>
      ipcRenderer.invoke(IPC.SKILL_MARKETPLACE_INSTALL, slug),
  },
  chat: {
    listSessions: () => ipcRenderer.invoke(IPC.CHAT_LIST_SESSIONS),
    listAllSessions: () => ipcRenderer.invoke(IPC.CHAT_LIST_ALL_SESSIONS),
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
    readThread: (sessionId: string) =>
      ipcRenderer.invoke(IPC.CHAT_READ_THREAD, sessionId),
    onReadThread: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        snapshot: Awaited<ReturnType<MarlouesAPI["chat"]["readThread"]>>,
      ) => callback(snapshot);
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
};

contextBridge.exposeInMainWorld("marloues", api);
