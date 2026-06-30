import { app } from "electron";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { logError, logInfo } from "./core/logging/app-logger";
import { getStateDir } from "./app-paths";
import type { RuntimeKind, TokenUsage } from "../shared/types";
import type { WorkflowUserMessageContent } from "../shared/workflow-read-thread-contract";
import { upsertSessionRecord } from "./services/session-store";

export interface Provider {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  model?: string;
  enabled: boolean;
}

export interface Settings {
  language: string;
  autoSave: boolean;
  maxSessions: number;
  theme: "light" | "dark" | "auto";
  accentColor: string;
  fontSize: number;
  compactMode: boolean;
  workingDirectory: string;
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy: "untrusted" | "on-request" | "never";
  webSearch: boolean;
}

export interface StoredMessageItem {
  id: string;
  type:
    | "agent_message"
    | "reasoning"
    | "command_execution"
    | "file_change"
    | "mcp_tool_call"
    | "web_search"
    | "todo_list"
    | "permission_request"
    | "error";
  rawType?: string;
  phase?: "started" | "updated" | "completed";
  text?: string;
  command?: string;
  shell?: string;
  aggregated_output?: string;
  exit_code?: number;
  status?: string;
  startedAt?: number;
  updatedAt?: number;
  completedAt?: number;
  server?: string;
  tool?: string;
  toolName?: string;
  args?: unknown;
  arguments?: unknown;
  result?: unknown;
  reason?: string;
  timeoutMs?: number;
  changes?: { path: string; kind: string }[];
  error?: { message: string };
  query?: string;
  message?: string;
  items?: { text: string; completed: boolean }[];
  rawItem?: unknown;
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  userContent?: WorkflowUserMessageContent[];
  timestamp: number;
  status?: "thinking" | "running" | "completed" | "failed";
  startedAt?: number;
  updatedAt?: number;
  completedAt?: number;
  modelId?: string;
  modelName?: string;
  usage?: TokenUsage;
  items: StoredMessageItem[];
  rawEvents?: { method: string; params: unknown; receivedAt: number }[];
}

export interface StoredSession {
  id: string;
  title: string;
  updatedAt: number;
  pinned?: boolean;
  archived?: boolean;
  runtimeThreadId?: string;
  runtimeThreadIds?: Partial<Record<RuntimeKind, string>>;
  cwd?: string;
  model?: string;
  tokenUsage?: {
    input: number;
    output: number;
    cached: number;
  };
  turnCount?: number;
  messages: StoredMessage[];
}

interface StoreData {
  providers: Provider[];
  selectedProviderId: string;
  settings: Settings;
  sessions: StoredSession[];
}

const defaults: StoreData = {
  providers: [
    {
      id: "minimax",
      name: "MiniMax",
      apiKey: "",
      baseUrl: "https://api.minimaxi.com/v1",
      model: "MiniMax-M2.7-highspeed",
      enabled: true,
    },
    {
      id: "openai",
      name: "OpenAI",
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      enabled: false,
    },
    {
      id: "anthropic",
      name: "Anthropic",
      apiKey: "",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-5",
      enabled: false,
    },
  ],
  selectedProviderId: "minimax",
  settings: {
    language: "zh-CN",
    autoSave: true,
    maxSessions: 50,
    theme: "dark",
    accentColor: "#6366f1",
    fontSize: 13,
    compactMode: false,
    workingDirectory: "",
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    webSearch: false,
  },
  sessions: [],
};

class SimpleStore {
  private filePath: string;
  private data: StoreData;
  private writeQueue: (() => void)[] = [];
  private isWriting = false;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly FLUSH_DELAY = 100;
  private readonly MAX_BATCH_SIZE = 10;

  constructor() {
    const userDataPath = getStoreUserDataPath();
    if (!existsSync(userDataPath)) {
      mkdirSync(userDataPath, { recursive: true });
    }
    this.filePath = join(userDataPath, "config.json");
    this.data = this.load();
  }

  private load(): StoreData {
    try {
      if (existsSync(this.filePath)) {
        const content = readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(content) as Partial<StoreData>;
        const mergedProviders = defaults.providers.map((def) => {
          const saved = (parsed.providers || []).find((p) => p.id === def.id);
          return saved ? { ...def, ...saved } : def;
        });
        const customProviders = (parsed.providers || []).filter(
          (p) => !defaults.providers.find((d) => d.id === p.id),
        );
        const sessions = (parsed.sessions || []).map((session) => {
          const legacyThreadId = (
            session as StoredSession & Record<string, unknown>
          )["co" + "dexThreadId"];
          return typeof legacyThreadId === "string" && !session.runtimeThreadId
            ? { ...session, runtimeThreadId: legacyThreadId, runtimeThreadIds: { binary: legacyThreadId } }
            : session;
        });

        return {
          ...defaults,
          ...parsed,
          providers: [...mergedProviders, ...customProviders],
          settings: { ...defaults.settings, ...(parsed.settings || {}) },
          sessions,
        };
      }
    } catch (e) {
      logError("Store.configLoadFailed", e);
    }
    return { ...defaults, sessions: [] };
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => this.flush(), this.FLUSH_DELAY);
  }

  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;

    try {
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (e) {
      logError("Store.configSaveFailed", e);
      this.dirty = true;
    }
  }

  saveSync(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  get<K extends keyof StoreData>(key: K): StoreData[K] {
    return this.data[key];
  }

  set<K extends keyof StoreData>(key: K, value: StoreData[K]): void {
    this.data[key] = value;
    this.scheduleSave();
  }

  getProvider(id: string): Provider | undefined {
    return this.data.providers.find((p) => p.id === id);
  }

  getSelectedProvider(): Provider | undefined {
    return this.data.providers.find(
      (p) => p.id === this.data.selectedProviderId,
    );
  }

  updateProvider(id: string, updates: Partial<Provider>): void {
    const index = this.data.providers.findIndex((p) => p.id === id);
    if (index >= 0) {
      this.data.providers[index] = {
        ...this.data.providers[index],
        ...updates,
      };
      this.scheduleSave();
    }
  }

  getSettings(): Settings {
    return this.data.settings;
  }

  updateSettings(updates: Partial<Settings>): void {
    this.data.settings = { ...this.data.settings, ...updates };
    this.scheduleSave();
  }

  // Session CRUD
  getSessions(): StoredSession[] {
    return this.data.sessions;
  }

  getSession(id: string): StoredSession | undefined {
    return this.data.sessions.find((s) => s.id === id);
  }

  saveSession(session: StoredSession): void {
    const index = this.data.sessions.findIndex((s) => s.id === session.id);
    if (index >= 0) {
      this.data.sessions[index] = session;
    } else {
      this.data.sessions.unshift(session);
      logInfo("store.sessionCreated", {
        sessionId: session.id,
        title: session.title,
      });
    }
    // Enforce maxSessions limit
    const max = this.data.settings.maxSessions || 50;
    if (this.data.sessions.length > max) {
      this.data.sessions = this.data.sessions.slice(0, max);
    }
    upsertSessionRecord({
      id: session.id,
      title: session.title,
      workspacePath: session.cwd,
      createdAt: session.messages[0]?.timestamp ?? session.updatedAt,
      updatedAt: session.updatedAt,
      pinned: session.pinned,
      sdkSessionId: session.runtimeThreadIds?.sdk ?? session.runtimeThreadId,
      archived: session.archived,
    });
    this.scheduleSave();
  }

  deleteSession(id: string): void {
    this.data.sessions = this.data.sessions.filter((s) => s.id !== id);
    logInfo("store.sessionDeleted", { sessionId: id });
    this.scheduleSave();
  }

  renameSession(id: string, title: string): void {
    const session = this.data.sessions.find((s) => s.id === id);
    if (session) {
      session.title = title;
      session.updatedAt = Date.now();
      logInfo("store.sessionRenamed", { sessionId: id, title });
      this.scheduleSave();
    }
  }

  archiveSession(id: string): void {
    const session = this.data.sessions.find((s) => s.id === id);
    if (session) {
      session.archived = true;
      session.updatedAt = Date.now();
      logInfo("store.sessionArchived", { sessionId: id });
      this.scheduleSave();
    }
  }

  unarchiveSession(id: string): void {
    const session = this.data.sessions.find((s) => s.id === id);
    if (session) {
      session.archived = false;
      session.updatedAt = Date.now();
      logInfo("store.sessionUnarchived", { sessionId: id });
      this.scheduleSave();
    }
  }
}

function getStoreUserDataPath(): string {
  try {
    if (app?.getPath) return app.getPath("userData");
  } catch {
    // Non-Electron scripts use the project state dir.
  }
  return join(getStateDir(), "legacy-store");
}

export const store = new SimpleStore();

// Ensure data is saved on app quit
process.on("beforeExit", () => {
  store.saveSync();
});
