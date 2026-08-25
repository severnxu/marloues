import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getMarlouesHome } from "../../app-paths";
import { logInfo, logWarn } from "../../core/logging/app-logger";
import type {
  ImChannelId,
  ImSessionRecord,
  RendererImSession,
} from "@shared/im/im-types";

interface ImSessionsFile {
  sessions: ImSessionRecord[];
}

const SESSIONS_FILE = join(getMarlouesHome(), "config", "im-sessions.json");

export function sanitizeChatId(chatId: string): string {
  const safe = chatId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
  return safe || "chat";
}

export function getImWorkspacePath(
  channel: ImChannelId,
  chatId: string,
): string {
  return join(
    getMarlouesHome(),
    "im-workspaces",
    `${channel}-${sanitizeChatId(chatId)}`,
  );
}

function readSessionsFile(): ImSessionsFile {
  try {
    if (!existsSync(SESSIONS_FILE)) return { sessions: [] };
    const parsed = JSON.parse(readFileSync(SESSIONS_FILE, "utf-8")) as
      ImSessionsFile | undefined;
    return Array.isArray(parsed?.sessions) ? parsed : { sessions: [] };
  } catch (error) {
    logWarn("im.session.readFailed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { sessions: [] };
  }
}

function normalizeRecord(record: ImSessionRecord): ImSessionRecord {
  return {
    ...record,
    state: record.state === "suspended" ? "suspended" : "active",
  };
}

function writeSessionsFile(file: ImSessionsFile): void {
  try {
    mkdirSync(dirname(SESSIONS_FILE), { recursive: true });
    writeFileSync(SESSIONS_FILE, JSON.stringify(file, null, 2), "utf-8");
  } catch (error) {
    logWarn("im.session.writeFailed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export class ImSessionRegistry {
  private readonly byChat = new Map<string, ImSessionRecord>();
  private readonly byThread = new Map<string, ImSessionRecord>();

  private chatKey(channel: ImChannelId, chatId: string): string {
    return `${channel}:${chatId}`;
  }

  loadAll(): void {
    this.byChat.clear();
    this.byThread.clear();
    for (const record of readSessionsFile().sessions) {
      const normalized = normalizeRecord(record);
      this.byThread.set(normalized.threadId, normalized);
      if (normalized.state !== "active") continue;
      const key = this.chatKey(normalized.channel, normalized.chatId);
      const current = this.byChat.get(key);
      if (!current || normalized.updatedAt >= current.updatedAt) {
        this.byChat.set(key, normalized);
      }
    }
    logInfo("im.session.restored", { count: this.byChat.size });
  }

  getThreadId(channel: ImChannelId, chatId: string): string | undefined {
    return this.byChat.get(this.chatKey(channel, chatId))?.threadId;
  }

  getByThreadId(threadId: string): ImSessionRecord | undefined {
    return this.byThread.get(threadId);
  }

  bind(record: ImSessionRecord): void {
    const key = this.chatKey(record.channel, record.chatId);
    const previous = this.byChat.get(key);
    if (previous && previous.threadId !== record.threadId) {
      previous.state = "suspended";
      this.byThread.set(previous.threadId, previous);
    }
    const next = normalizeRecord({ ...record, state: "active" });
    this.byChat.set(key, next);
    this.byThread.set(next.threadId, next);
    this.persist();
  }

  unbind(channel: ImChannelId, chatId: string): void {
    const key = this.chatKey(channel, chatId);
    const record = this.byChat.get(key);
    if (record) {
      record.state = "suspended";
      this.byThread.set(record.threadId, record);
      this.byChat.delete(key);
      this.persist();
    }
  }

  updateLastTurn(channel: ImChannelId, chatId: string, turnId: string): void {
    const record = this.byChat.get(this.chatKey(channel, chatId));
    if (!record) return;
    this.updateRecordLastTurn(record, turnId);
  }

  updateLastTurnForThread(threadId: string, turnId: string): void {
    const record = this.byThread.get(threadId);
    if (!record) return;
    this.updateRecordLastTurn(record, turnId);
  }

  clearThreadState(threadId: string): void {
    const record = this.byThread.get(threadId);
    if (!record) return;
    record.lastTurnId = undefined;
    record.updatedAt = Date.now();
    this.byThread.set(threadId, record);
    const active = this.byChat.get(this.chatKey(record.channel, record.chatId));
    if (active?.threadId === threadId) {
      this.byChat.set(this.chatKey(record.channel, record.chatId), record);
    }
    this.persist();
  }

  listForRenderer(
    titleForThread: (threadId: string, chatId: string) => string,
  ): RendererImSession[] {
    return Array.from(this.byThread.values())
      .map((record) => ({
        channel: record.channel,
        chatId: record.chatId,
        threadId: record.threadId,
        title: titleForThread(record.threadId, record.chatId),
        workspacePath: record.workspacePath,
        lastTurnId: record.lastTurnId,
        updatedAt: record.updatedAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  ensureWorkspace(channel: ImChannelId, chatId: string): string {
    const dir = getImWorkspacePath(channel, chatId);
    try {
      mkdirSync(dir, { recursive: true });
    } catch (error) {
      logWarn("im.workspace.ensureFailed", {
        dir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return dir;
  }

  private persist(): void {
    writeSessionsFile({ sessions: Array.from(this.byThread.values()) });
  }

  private updateRecordLastTurn(record: ImSessionRecord, turnId: string): void {
    record.lastTurnId = turnId;
    record.updatedAt = Date.now();
    this.byThread.set(record.threadId, record);
    const active = this.byChat.get(this.chatKey(record.channel, record.chatId));
    if (active?.threadId === record.threadId) {
      this.byChat.set(this.chatKey(record.channel, record.chatId), record);
    }
    this.persist();
  }
}
