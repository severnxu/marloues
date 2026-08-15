/**
 * Main process IPC handlers wired to AgentRuntime.
 * Provides the full IPC surface expected by the marloues UI.
 */

import { app, ipcMain, BrowserWindow, dialog, shell } from "electron";
import { writeFileSync } from "node:fs";
import { IPC } from "./channels";
import { logInfo } from "../core/logging/app-logger";
import type {
  ChatSendRequest,
  ChatSendReceipt,
  ChatResendRequest,
  ChatForkRequest,
  ChatRewindRequest,
  ChatRewindResult,
  ChatMessageRecord,
  TimelineItem,
  RuntimeKind,
  WorkspaceInfo,
  WorkspaceSettings,
  ChatSessionRecord,
  AgentSettings,
  McpServerConfig,
  ModelProviderConfig,
  SkillDetail,
  SkillInfo,
  SessionSearchResult,
} from "@shared/types";
import {
  getRuntime,
  getRuntimeState,
  listRuntimeModels,
  setRuntimeModel,
  switchRuntime,
} from "../core/runtime/manager";
import {
  estimateSessionTokens,
  evaluateContextPolicy,
} from "../core/context/context-policy";
import { translateRuntimeEventToUIEvent } from "@shared/runtime-event-adapter";
import {
  getAgentSettings,
  saveAgentSettings,
} from "../services/config-service";
import { resolveModelProvider } from "../core/config/model-provider";
import {
  compactAndRecordSessionState,
  prependStatePackToPrompt,
} from "../services/context-compaction-service";
import { exportDiagnostics } from "../services/diagnostics-service";
import { getAuthStatus, logout, openAuthPage } from "../services/auth-service";
import {
  applyUpdatePreferences,
  checkForUpdatesManual,
  downloadUpdateNow,
  getUpdateState,
  installUpdateNow,
} from "../services/auto-update-service";
import {
  getUpdatePreferences,
  saveUpdatePreferences,
} from "../services/update-preferences-service";
import { getAppVersionInfo } from "../hot-update/package-store";
import { markRendererReady } from "../hot-update/renderer-controller";
import {
  listEndpointModels,
  testEndpointModel,
  testEndpointProfile,
} from "../services/endpoint-models";
import {
  listWorkspaceDir,
  readWorkspaceFile,
  statWorkspaceFile,
} from "../services/file-service";
import {
  listMemoryFiles as listMemoryFilesFromService,
  readMemoryFile,
  writeMemoryFile,
} from "../services/memory-service";
import {
  listMcpServers,
  listRuntimeMcpTools,
  refreshMcpServerStatuses,
  saveMcpServers,
  testMcpServer,
} from "../services/mcp-service";
import {
  getCurrentWorkspace as currentWorkspace,
  getWorkspaceSettings,
  removeWorkspace,
  renameWorkspace,
  selectWorkspace,
  switchWorkspace,
} from "../services/workspace-service";
import {
  getMarketplaceSkillDetail,
  getSkillDetail as getSkillDetailFromService,
  importSkillFolder as importSkillFolderFromService,
  installMarketplaceSkill,
  listInstalledSkills as listInstalledSkillsFromService,
  listMarketplaceSkills,
  removeSkill as removeSkillFromService,
  toggleSkill as toggleSkillFromService,
} from "../services/skill-service";
import type { MessageItem } from "@shared/workflow-types";
import type { WorkflowTurnItem } from "@shared/workflow-read-thread-contract";
import { messageItemToWorkflowTurnItem } from "@shared/adapters/message-item-to-workflow-turn-item";
import type { Message, Thread } from "@shared/agent-runtime";
import type { WorkflowReadThreadResponse } from "@shared/workflow-read-thread-contract";
import { workspacePathsEqual } from "@shared/workspace-path";
import { store, type StoredSession } from "../store";
import { workflowThreadStore } from "../core/runtime/workflow-thread-store";
import {
  listAuditEvents,
  recordAuditEvent,
  recordWorkspaceRewindEvent,
} from "../services/session-store";
import {
  applyWorkspaceRewind,
  captureWorkspaceCheckpoint,
  previewWorkspaceRewind,
} from "../services/workspace-checkpoint-service";

const pendingApprovalItems = new Map<
  string,
  {
    sessionId: string;
    turnId: string;
    toolName: string;
    reason: string;
    timeoutMs?: number;
  }
>();

const RENDERER_TEXT_LIMIT = 120_000;
const RENDERER_ITEM_TEXT_LIMIT = 24_000;
const RENDERER_OBJECT_STRING_LIMIT = 12_000;
const RENDERER_OBJECT_DEPTH_LIMIT = 6;
const RENDERER_OBJECT_ARRAY_LIMIT = 200;
const RENDERER_OBJECT_KEYS_LIMIT = 100;

type RendererWorkflowTurnItem =
  WorkflowReadThreadResponse["turns"][number]["items"][number];

async function readRuntimeThreadSnapshot(
  threadId: string,
): Promise<WorkflowReadThreadResponse | null> {
  const runtime = getRuntime();
  if (!runtime.readThread) return null;
  const snapshot = await runtime.readThread({ threadId, limit: 100 });
  return snapshot.turns.length > 0
    ? sanitizeReadThreadForRenderer(snapshot)
    : null;
}

async function sendReadThreadUpdate(threadId: string): Promise<void> {
  const mainWindow = getMainWindow();
  if (!mainWindow) return;
  try {
    mainWindow.webContents.send(
      IPC.CHAT_READ_THREAD_UPDATE,
      await readRuntimeThreadSnapshot(threadId),
    );
  } catch {
    mainWindow.webContents.send(IPC.CHAT_READ_THREAD_UPDATE, null);
  }
}

let readThreadBroadcastRegistered = false;

function registerReadThreadBroadcast(): void {
  if (readThreadBroadcastRegistered) return;
  readThreadBroadcastRegistered = true;
  workflowThreadStore.addListener((threadId) => {
    void sendReadThreadUpdate(threadId);
  });
}

function getMainWindow(): BrowserWindow | null {
  const wins = BrowserWindow.getAllWindows();
  return wins.find((w) => !w.isDestroyed()) ?? null;
}

function isDefaultSessionTitle(title: string): boolean {
  return title === "New chat" || title === "Untitled";
}

function titleFromText(text: string): string {
  const title = text.trim().replace(/\s+/g, " ").slice(0, 50);
  return title || "New chat";
}

function chatMessageFromRuntimeMessage(
  message: Message,
): ChatSessionRecord["messages"][number] {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    blocks: message.content
      ? [{ id: `${message.id}-text`, type: "text", text: message.content }]
      : [],
    createdAt: message.timestamp,
    items: [],
    startedAt: message.timestamp,
  };
}

function storedMessageFromChatMessage(
  message: ChatSessionRecord["messages"][number],
): StoredSession["messages"][number] {
  return {
    id: message.id,
    role: message.role === "system" ? "assistant" : message.role,
    content: message.content,
    userContent: message.userContent,
    timestamp: message.createdAt,
    status: message.isError ? "failed" : "completed",
    usage: message.usage,
    items: message.items,
    startedAt: message.startedAt,
    completedAt: message.completedAt,
    modelId: message.modelId,
    modelName: message.modelName,
  };
}

function chatMessageFromStoredMessage(
  message: StoredSession["messages"][number],
): ChatSessionRecord["messages"][number] {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    userContent: message.userContent,
    blocks: message.content
      ? [{ id: `${message.id}-text`, type: "text", text: message.content }]
      : [],
    createdAt: message.timestamp,
    items: message.items,
    startedAt: message.startedAt,
    completedAt: message.completedAt,
    modelId: message.modelId,
    modelName: message.modelName,
    usage: message.usage,
    isError: message.status === "failed",
  };
}

function sanitizeSessionForRenderer(
  session: ChatSessionRecord,
): ChatSessionRecord {
  return {
    ...session,
    title: truncateText(session.title, 1_000),
    messages: session.messages.map(sanitizeChatMessageForRenderer),
  };
}

function sanitizeChatMessageForRenderer(
  message: ChatSessionRecord["messages"][number],
): ChatSessionRecord["messages"][number] {
  const content = truncateText(message.content, RENDERER_TEXT_LIMIT);
  return {
    ...message,
    content,
    blocks: message.blocks.map((block) => {
      if (block.type === "text" || block.type === "thinking")
        return {
          ...block,
          text: truncateText(block.text, RENDERER_TEXT_LIMIT),
        };
      if (block.type === "tool_result") {
        return {
          ...block,
          result: {
            ...block.result,
            output: sanitizeUnknownForRenderer(block.result.output, 0),
          },
        };
      }
      if (block.type === "tool_call") {
        return {
          ...block,
          tool: {
            ...block.tool,
            input: sanitizeUnknownForRenderer(block.tool.input, 0),
          },
        };
      }
      if (block.type === "error")
        return {
          ...block,
          message: truncateText(block.message, RENDERER_ITEM_TEXT_LIMIT),
        };
      return block;
    }),
    items: message.items.map(sanitizeMessageItemForRenderer),
    timeline: message.timeline?.map(sanitizeTimelineItemForRenderer),
  };
}

function sanitizeMessageItemForRenderer(
  item: WorkflowTurnItem,
): WorkflowTurnItem {
  if (item.type === "agentMessage" || item.type === "plan") {
    return { ...item, text: truncateText(item.text, RENDERER_TEXT_LIMIT) };
  }
  if (item.type === "reasoning") {
    return {
      ...item,
      summary: truncateText(item.summary, RENDERER_ITEM_TEXT_LIMIT),
    };
  }
  if (item.type === "unknown") {
    return { ...item, raw: sanitizeUnknownForRenderer(item.raw, 0) };
  }
  return item;
}

function sanitizeTimelineItemForRenderer(item: TimelineItem): TimelineItem {
  return {
    ...item,
    label: truncateText(item.label, 1_000),
    detail:
      item.detail === undefined
        ? undefined
        : truncateText(item.detail, RENDERER_ITEM_TEXT_LIMIT),
    toolInput: sanitizeUnknownForRenderer(item.toolInput, 0),
    toolOutput: sanitizeUnknownForRenderer(item.toolOutput, 0),
  };
}

function sanitizeReadThreadForRenderer(
  snapshot: WorkflowReadThreadResponse,
): WorkflowReadThreadResponse {
  return {
    ...snapshot,
    thread: {
      ...snapshot.thread,
      title: truncateText(snapshot.thread.title, 1_000),
      preview: truncateText(snapshot.thread.preview, RENDERER_ITEM_TEXT_LIMIT),
    },
    turns: snapshot.turns.map((turn) => ({
      ...turn,
      error: turn.error
        ? {
            ...turn.error,
            message: truncateText(turn.error.message, RENDERER_ITEM_TEXT_LIMIT),
            additionalDetails: sanitizeUnknownForRenderer(
              turn.error.additionalDetails,
              0,
            ),
          }
        : null,
      items: turn.items.map(sanitizeWorkflowTurnItemForRenderer),
    })),
  };
}

function sanitizeWorkflowTurnItemForRenderer(
  item: RendererWorkflowTurnItem,
): RendererWorkflowTurnItem {
  switch (item.type) {
    case "userMessage":
      return {
        ...item,
        content: item.content.map((content) =>
          content.type === "text"
            ? {
                ...content,
                text: truncateText(content.text, RENDERER_TEXT_LIMIT),
              }
            : content,
        ),
      };
    case "agentMessage":
    case "plan":
      return { ...item, text: truncateText(item.text, RENDERER_TEXT_LIMIT) };
    case "reasoning":
      return {
        ...item,
        summary: truncateText(item.summary, RENDERER_ITEM_TEXT_LIMIT),
        content: item.content?.map((output) =>
          sanitizeWorkflowTextOutput(output, RENDERER_ITEM_TEXT_LIMIT),
        ),
      };
    case "commandExecution":
      return {
        ...item,
        command: truncateText(item.command, RENDERER_ITEM_TEXT_LIMIT),
        output: item.output
          ? sanitizeWorkflowTextOutput(item.output, RENDERER_ITEM_TEXT_LIMIT)
          : undefined,
      };
    case "fileChange":
      return {
        ...item,
        changes: item.changes.map((change) => ({
          ...change,
          diff: change.diff
            ? sanitizeWorkflowTextOutput(change.diff, RENDERER_ITEM_TEXT_LIMIT)
            : undefined,
        })),
      };
    case "mcpToolCall":
    case "dynamicToolCall":
      return {
        ...item,
        arguments: sanitizeUnknownForRenderer(item.arguments, 0),
        output: item.output
          ? sanitizeWorkflowTextOutput(item.output, RENDERER_ITEM_TEXT_LIMIT)
          : undefined,
        modelOutput: item.modelOutput
          ? sanitizeWorkflowTextOutput(
              item.modelOutput,
              RENDERER_ITEM_TEXT_LIMIT,
            )
          : undefined,
      };
    case "webSearch":
      return {
        ...item,
        query:
          item.query === undefined
            ? undefined
            : truncateText(item.query, RENDERER_ITEM_TEXT_LIMIT),
        action: sanitizeUnknownForRenderer(item.action, 0),
      };
    case "imageGeneration":
      return {
        ...item,
        revisedPrompt:
          item.revisedPrompt === undefined
            ? undefined
            : truncateText(item.revisedPrompt, RENDERER_ITEM_TEXT_LIMIT),
        result: sanitizeUnknownForRenderer(item.result, 0),
      };
    case "permissionRequest":
      return {
        ...item,
        toolName: truncateText(item.toolName, 1_000),
        reason: truncateText(item.reason, RENDERER_ITEM_TEXT_LIMIT),
      };
    case "unknown":
      return {
        ...item,
        raw: sanitizeUnknownForRenderer(item.raw, 0),
      };
    default:
      return sanitizeUnknownForRenderer(item, 0) as RendererWorkflowTurnItem;
  }
}

function sanitizeWorkflowTextOutput<
  T extends { text: string; truncated?: boolean; originalChars?: number },
>(output: T, limit: number): T {
  if (output.text.length <= limit) return output;
  return {
    ...output,
    text: truncateText(output.text, limit),
    truncated: true,
    originalChars: output.originalChars ?? output.text.length,
  };
}

function sanitizeUnknownForRenderer(value: unknown, depth: number): unknown {
  if (typeof value === "string")
    return truncateText(
      value,
      depth === 0 ? RENDERER_ITEM_TEXT_LIMIT : RENDERER_OBJECT_STRING_LIMIT,
    );
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (depth >= RENDERER_OBJECT_DEPTH_LIMIT)
    return "[truncated: object depth limit]";
  if (Array.isArray(value)) {
    const next = value
      .slice(0, RENDERER_OBJECT_ARRAY_LIMIT)
      .map((item) => sanitizeUnknownForRenderer(item, depth + 1));
    if (value.length > RENDERER_OBJECT_ARRAY_LIMIT)
      next.push(
        `[truncated: ${value.length - RENDERER_OBJECT_ARRAY_LIMIT} more items]`,
      );
    return next;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const next: Record<string, unknown> = {};
    for (const [key, entryValue] of entries.slice(
      0,
      RENDERER_OBJECT_KEYS_LIMIT,
    )) {
      next[key] = sanitizeUnknownForRenderer(entryValue, depth + 1);
    }
    if (entries.length > RENDERER_OBJECT_KEYS_LIMIT)
      next.__truncatedKeys = entries.length - RENDERER_OBJECT_KEYS_LIMIT;
    return next;
  }
  return String(value);
}

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const omitted = text.length - limit;
  return `${text.slice(0, limit)}\n\n[truncated ${omitted} chars for renderer stability]`;
}

function sessionRecordFromStoredSession(
  session: StoredSession,
): ChatSessionRecord {
  const workspace = getWorkspaceSettings().workspaces.find(
    (item) => item.path === session.cwd,
  );
  return {
    id: session.id,
    title: session.title,
    createdAt: session.messages[0]?.timestamp ?? session.updatedAt,
    updatedAt: session.updatedAt,
    isPinned: Boolean(session.pinned),
    messages: session.messages.map(chatMessageFromStoredMessage),
    kernelSessionId: session.runtimeThreadId ?? session.id,
    runtimeThreadIds: session.runtimeThreadIds,
    workspacePath: session.cwd,
    workspaceName: workspace?.name,
  };
}

function storedSessionFromRecord(
  record: ChatSessionRecord,
  existing?: StoredSession,
): StoredSession {
  const runtimeThreadIds = {
    ...(existing?.runtimeThreadIds ?? {}),
    ...(record.runtimeThreadIds ?? {}),
  };
  return {
    id: record.id,
    title: record.title,
    updatedAt: record.updatedAt,
    pinned: record.isPinned,
    runtimeThreadId: record.kernelSessionId ?? existing?.runtimeThreadId,
    runtimeThreadIds,
    cwd: record.workspacePath ?? existing?.cwd,
    model: existing?.model,
    tokenUsage: existing?.tokenUsage,
    turnCount: record.messages.length,
    messages: record.messages.map(storedMessageFromChatMessage),
  };
}

function sessionRecordFromThread(thread: Thread): ChatSessionRecord {
  const saved = store.getSession(thread.id);
  const messages = thread.messages.map(chatMessageFromRuntimeMessage);
  return {
    id: thread.id,
    title: saved?.title ?? thread.title,
    createdAt: thread.createdAt,
    updatedAt: Math.max(saved?.updatedAt ?? 0, thread.updatedAt),
    isPinned: Boolean(saved?.pinned),
    messages,
    kernelSessionId: saved?.runtimeThreadId ?? thread.id,
    runtimeThreadIds: saved?.runtimeThreadIds,
  };
}

function persistSessionRecord(record: ChatSessionRecord): void {
  store.saveSession(
    storedSessionFromRecord(record, store.getSession(record.id)),
  );
}

function mergeRuntimeAndStoredSessions(
  threads: Thread[],
  workspacePath?: string,
): ChatSessionRecord[] {
  const byId = new Map<string, ChatSessionRecord>();
  for (const saved of store
    .getSessions()
    .filter((session) => shouldIncludeStoredSession(session, workspacePath))) {
    byId.set(saved.id, sessionRecordFromStoredSession(saved));
  }
  for (const thread of threads) {
    const saved = store.getSession(thread.id);
    if (!shouldIncludeStoredSession(saved, workspacePath)) continue;
    byId.set(thread.id, sessionRecordFromThread(thread));
  }
  return Array.from(byId.values())
    .sort(
      (a, b) =>
        Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)) ||
        b.updatedAt - a.updatedAt,
    )
    .map(sanitizeSessionForRenderer);
}

function shouldIncludeStoredSession(
  session: StoredSession | undefined,
  workspacePath?: string,
): boolean {
  if (session?.archived) return false;
  if (!workspacePath) return true;
  return workspacePathsEqual(session?.cwd, workspacePath);
}

function findStoredChatSession(sessionId: string): ChatSessionRecord {
  const saved = store.getSession(sessionId);
  if (saved) return sessionRecordFromStoredSession(saved);
  throw new Error(`Session not found: ${sessionId}`);
}

async function exportChatSession(sessionId: string): Promise<string | null> {
  const session = findStoredChatSession(sessionId);
  const result = await dialog.showSaveDialog({
    title: "Export chat",
    defaultPath: `${toSafeFileName(session.title)}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });

  if (result.canceled || !result.filePath) return null;
  writeFileSync(result.filePath, renderSessionMarkdown(session), "utf-8");
  recordAuditEvent({
    workspacePath: session.workspacePath,
    toolName: "chat.exportSession",
    inputSummary: session.id,
    outputSummary: result.filePath,
    status: "completed",
  });
  return result.filePath;
}

function renderSessionMarkdown(session: ChatSessionRecord): string {
  const lines = [
    `# ${session.title}`,
    "",
    `- Created: ${new Date(session.createdAt).toISOString()}`,
    `- Updated: ${new Date(session.updatedAt).toISOString()}`,
  ];

  if (session.workspaceName || session.workspacePath) {
    lines.push(
      `- Workspace: ${session.workspaceName ?? "Unknown"}${session.workspacePath ? ` (${session.workspacePath})` : ""}`,
    );
  }

  lines.push("");
  for (const message of session.messages) {
    lines.push(renderMessageMarkdown(message), "");
  }
  return `${lines.join("\n").trim()}\n`;
}

function renderMessageMarkdown(message: ChatMessageRecord): string {
  const title =
    message.role === "user"
      ? "User"
      : message.role === "system"
        ? "System"
        : "Marloues";
  const content =
    message.content.trim() ||
    assistantTextFromMessageItems(message) ||
    "_No content_";
  const lines = [
    `## ${title}`,
    "",
    `_${new Date(message.createdAt).toISOString()}_`,
    "",
    content,
  ];

  if (message.timeline?.length) {
    lines.push("", "<details>", "<summary>Runtime events</summary>", "");
    for (const item of message.timeline) {
      lines.push(renderTimelineMarkdown(item), "");
    }
    lines.push("</details>");
  }

  return lines.join("\n");
}

function assistantTextFromMessageItems(message: ChatMessageRecord): string {
  return (message.items ?? [])
    .filter((item) => item.type === "agentMessage")
    .map((item) => ("text" in item ? (item.text ?? "") : ""))
    .join("")
    .trim();
}

function renderTimelineMarkdown(item: TimelineItem): string {
  const lines = [
    `### ${item.label}`,
    "",
    `- Type: ${item.type}`,
    `- Time: ${new Date(item.createdAt).toISOString()}`,
  ];

  if (item.status) lines.push(`- Status: ${item.status}`);
  if (item.toolName) lines.push(`- Tool: ${item.toolName}`);
  if (item.isError) lines.push("- Error: true");
  if (item.detail) lines.push("", "```txt", item.detail, "```");
  return lines.join("\n");
}

function toSafeFileName(value: string): string {
  const withoutControls = Array.from(
    value.trim() || "marloues-chat",
    (character) => (character.charCodeAt(0) <= 31 ? "-" : character),
  ).join("");
  return withoutControls
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}
function appendStoredMessage(
  sessionId: string,
  message: StoredSession["messages"][number],
  titleSeed?: string,
  runtimeThreadId?: string,
  runtimeId?: RuntimeKind,
): void {
  const existing = store.getSession(sessionId);
  const now = Date.now();
  const title =
    existing?.title && !isDefaultSessionTitle(existing.title)
      ? existing.title
      : titleSeed
        ? titleFromText(titleSeed)
        : (existing?.title ?? "New chat");
  const messages = [
    ...(existing?.messages ?? []).filter((item) => item.id !== message.id),
    message,
  ];
  const runtimeThreadIds = { ...(existing?.runtimeThreadIds ?? {}) };
  if (runtimeThreadId && runtimeId) {
    runtimeThreadIds[runtimeId] = runtimeThreadId;
  }
  store.saveSession({
    id: sessionId,
    title,
    updatedAt: now,
    pinned: existing?.pinned,
    runtimeThreadId: runtimeThreadId ?? existing?.runtimeThreadId,
    runtimeThreadIds,
    cwd: existing?.cwd ?? currentWorkspace()?.path,
    model: existing?.model,
    tokenUsage: existing?.tokenUsage,
    turnCount: messages.length,
    messages,
  });
}

function modelSnapshotFromProvider(
  modelProvider: ReturnType<typeof resolveModelProvider>,
): { modelId: string; modelName: string } {
  const modelId = modelProvider.selection.modelId || modelProvider.model;
  const model = modelProvider.provider?.models.find(
    (item) => item.id === modelId,
  );
  return {
    modelId,
    modelName: model?.label || modelId,
  };
}

function userContentFromAttachments(
  text: string,
  attachments: unknown[] | undefined,
): import("@shared/workflow-read-thread-contract").WorkflowUserMessageContent[] {
  const content: import("@shared/workflow-read-thread-contract").WorkflowUserMessageContent[] =
    [];
  if (text.trim()) content.push({ type: "text", text });
  for (const attachment of attachments ?? []) {
    const record =
      attachment && typeof attachment === "object"
        ? (attachment as Record<string, unknown>)
        : null;
    if (!record) continue;
    if (
      record.type === "localImage" &&
      typeof record.path === "string" &&
      record.path.trim()
    ) {
      content.push({ type: "localImage", path: record.path });
      continue;
    }
    const imageUrl =
      typeof record.url === "string"
        ? record.url
        : typeof record.dataUrl === "string"
          ? record.dataUrl
          : "";
    if ((record.type === "image" || record.dataUrl) && imageUrl.trim()) {
      content.push({ type: "image", url: imageUrl });
      continue;
    }
    if (
      (record.type === "skill" || record.type === "mention") &&
      typeof record.name === "string" &&
      record.name.trim()
    ) {
      const path =
        typeof record.path === "string" && record.path.trim()
          ? record.path
          : undefined;
      content.push(
        record.type === "skill"
          ? { type: "skill", name: record.name, path }
          : { type: "mention", name: record.name, path },
      );
    }
  }
  return content;
}

function titleSeedFromUserContent(
  content: import("@shared/workflow-read-thread-contract").WorkflowUserMessageContent[],
): string {
  const image = content.find(
    (item) => item.type === "localImage" || item.type === "image",
  );
  if (image?.type === "localImage")
    return image.path.split(/[\\/]/).pop() || "Image message";
  if (image?.type === "image") return "Image message";
  return "New chat";
}

function appendAttachmentSummaryToPrompt(
  text: string,
  attachments: unknown[] | undefined,
): string {
  const summaries = attachmentPromptSummaries(attachments);
  if (summaries.length === 0) return text;
  const base = text.trim() ? text : "(No text message.)";
  const plural = summaries.length === 1 ? "image" : "images";
  return [
    base,
    "",
    `[User attached ${summaries.length} ${plural}. The current runtime receives this metadata, but not the image pixels.]`,
    ...summaries,
  ].join("\n");
}

function attachmentPromptSummaries(
  attachments: unknown[] | undefined,
): string[] {
  const summaries: string[] = [];
  for (const attachment of attachments ?? []) {
    const record =
      attachment && typeof attachment === "object"
        ? (attachment as Record<string, unknown>)
        : null;
    if (!record) continue;
    const type = typeof record.type === "string" ? record.type : "";
    if (
      type === "localImage" &&
      typeof record.path === "string" &&
      record.path.trim()
    ) {
      summaries.push(
        `${summaries.length + 1}. ${record.path.split(/[\\/]/).pop() || "local image"} (local path: ${record.path})`,
      );
      continue;
    }
    const imageUrl =
      typeof record.url === "string"
        ? record.url
        : typeof record.dataUrl === "string"
          ? record.dataUrl
          : "";
    if ((type === "image" || record.dataUrl) && imageUrl.trim()) {
      const name =
        typeof record.name === "string" && record.name.trim()
          ? record.name.trim()
          : `image-${summaries.length + 1}`;
      const mediaType =
        typeof record.mimeType === "string" && record.mimeType.trim()
          ? record.mimeType.trim()
          : mediaTypeFromImageUrl(imageUrl);
      const size =
        typeof record.size === "number" &&
        Number.isFinite(record.size) &&
        record.size > 0
          ? `, ${Math.round(record.size / 1024)} KB`
          : "";
      summaries.push(
        `${summaries.length + 1}. ${name} (${mediaType || "image"}${size})`,
      );
    }
  }
  return summaries;
}

function mediaTypeFromImageUrl(value: string): string {
  const match = value.match(/^data:([^;,]+)[;,]/i);
  if (match?.[1]) return match[1];
  if (/^https?:\/\//i.test(value)) return "remote image";
  if (/^file:/i.test(value)) return "local image";
  return "image";
}

function truncateStoredSession(
  sessionId: string,
  fromMessageId: string,
  includeMessage = false,
): ChatSessionRecord {
  const existing = store.getSession(sessionId);
  if (!existing) throw new Error(`Session not found: ${sessionId}`);
  const index = existing.messages.findIndex(
    (message) => message.id === fromMessageId,
  );
  if (index < 0) throw new Error(`Message not found: ${fromMessageId}`);
  const end = includeMessage ? index + 1 : index;
  const messages = existing.messages.slice(0, end);
  const now = Date.now();
  const next: StoredSession = {
    ...existing,
    messages,
    turnCount: messages.length,
    updatedAt: now,
  };
  store.saveSession(next);
  return sessionRecordFromStoredSession(next);
}

async function sendChatTurn(
  request: ChatSendRequest,
): Promise<ChatSendReceipt> {
  const runtime = getRuntime();
  const threadId = request.sessionId;
  const content = request.text;
  let runtimeContent = content;
  const mainWindow = getMainWindow();
  if (!mainWindow) {
    return {
      status: "failed",
      sessionId: threadId,
      messageId: request.clientMessageId ?? "",
      reason: "no_window",
    };
  }

  const turnId = crypto.randomUUID();
  const startedAt = Date.now();
  const userMessageId = request.clientMessageId || `user-${turnId}`;
  const workspacePath = currentWorkspace()?.path;
  const turnSettings = getAgentSettings();
  const turnModelProvider = resolveModelProvider(turnSettings);
  const turnModelSnapshot = modelSnapshotFromProvider(turnModelProvider);
  const activeRuntimeId = getRuntimeState().activeRuntimeId;
  const savedSession = store.getSession(threadId);
  const nativeRuntimeThreadId =
    savedSession?.runtimeThreadIds?.[activeRuntimeId] ??
    (activeRuntimeId === "sdk" ? savedSession?.runtimeThreadId : undefined);
  logInfo("chat.turnStarted", {
    sessionId: threadId,
    model: turnModelSnapshot.modelName,
    runtime: runtime.name,
  });

  const userContent = userContentFromAttachments(content, request.attachments);

  appendStoredMessage(
    threadId,
    {
      id: userMessageId,
      role: "user",
      content,
      userContent,
      timestamp: startedAt,
      status: "completed",
      items: [],
    },
    content || titleSeedFromUserContent(userContent),
  );

  mainWindow.webContents.send(IPC.CHAT_ITEM_EVENT, {
    type: "turn.start",
    sessionId: threadId,
    turnId,
    startedAt,
    modelId: turnModelSnapshot.modelId,
    modelName: turnModelSnapshot.modelName,
  });

  void (async () => {
    const items = new Map<string, MessageItem>();
    let lastAgentId = "";
    let agentSequence = 0;
    let tokenUsage: ChatSessionRecord["messages"][number]["usage"] | undefined;

    const fullAgentText = () =>
      Array.from(items.values())
        .filter((item) => item.type === "agent_message")
        .map((item) => item.text ?? "")
        .join("");

    const closeCurrentAgentMessage = (completedAt: number) => {
      if (!lastAgentId || !items.has(lastAgentId)) return;
      const item = {
        ...items.get(lastAgentId)!,
        phase: "completed" as const,
        status: "completed" as const,
        completedAt,
      };
      items.set(lastAgentId, item);
      mainWindow.webContents.send(IPC.CHAT_ITEM_EVENT, {
        type: "item.updated",
        sessionId: threadId,
        turnId,
        item,
      });
      lastAgentId = "";
    };

    const upsertAgentMessage = (content: string, updatedAt: number) => {
      if (!content) return;
      if (!lastAgentId || !items.has(lastAgentId)) {
        agentSequence += 1;
        lastAgentId =
          agentSequence === 1
            ? `agent-${turnId}`
            : `agent-${turnId}-${agentSequence}`;
        const item: MessageItem = {
          id: lastAgentId,
          type: "agent_message",
          rawType: "text_delta",
          phase: "updated",
          text: content,
          status: "in_progress",
          updatedAt,
        };
        items.set(lastAgentId, item);
        mainWindow.webContents.send(IPC.CHAT_ITEM_EVENT, {
          type: "item.updated",
          sessionId: threadId,
          turnId,
          item,
        });
        return;
      }

      const existing = items.get(lastAgentId)!;
      const existingText = existing.text ?? "";
      const nextText = content.startsWith(existingText)
        ? content
        : existingText + content;
      if (nextText === existingText) return;
      const item = { ...existing, text: nextText, updatedAt };
      items.set(lastAgentId, item);
      mainWindow.webContents.send(IPC.CHAT_ITEM_EVENT, {
        type: "item.updated",
        sessionId: threadId,
        turnId,
        item,
      });
    };

    try {
      await captureWorkspaceCheckpoint({
        sessionId: threadId,
        turnId,
        messageId: userMessageId,
        workspacePath,
        phase: "turn_start",
      });
      const sessionForContext = store.getSession(threadId);
      if (sessionForContext && !request.forceSend) {
        const settings = turnSettings;
        const sessionRecord = sessionRecordFromStoredSession(sessionForContext);
        const modelProvider = turnModelProvider;
        const contextTokens = estimateSessionTokens(sessionRecord);
        const decision = evaluateContextPolicy({
          settings,
          providerId: modelProvider.selection.providerId,
          modelId: modelProvider.selection.modelId,
          model: modelProvider.model,
          totalTokens: contextTokens,
          reason: "preflight",
        });
        mainWindow.webContents.send(IPC.CHAT_EVENT, {
          type: "context.usage",
          sessionId: threadId,
          turnId,
          phase: "turn_start",
          percentage: decision.percentage,
          limit: decision.contextWindowTokens,
          usage: {
            total: { tokens: contextTokens },
            limit: {
              tokens: decision.contextWindowTokens,
              source: decision.source,
            },
            percentage: decision.percentage ?? 0,
          },
        });
        if (decision.level === "warning" || decision.level === "compact") {
          mainWindow.webContents.send(IPC.CHAT_EVENT, {
            type: "context.warning",
            sessionId: threadId,
            turnId,
            level: decision.level === "warning" ? "medium" : "high",
            message: `Context usage is ${Math.round(decision.percentage ?? 0)}%. Consider starting a new branch soon.`,
            percentage: decision.percentage,
          });
        }
        if (decision.level === "compact") {
          mainWindow.webContents.send(IPC.CHAT_EVENT, {
            type: "context.compaction",
            sessionId: threadId,
            turnId,
            phase: "started",
            reason: "preflight",
            message: "Compressing older context before sending this turn.",
          });
          const compacted = await compactAndRecordSessionState({
            session: sessionRecord,
            modelProvider,
            targetTokens: decision.targetTokens,
            currentUserMessageId: userMessageId,
            turnId,
            messageId: userMessageId,
            reason: "preflight",
            totalTokens: contextTokens,
            contextWindowTokens: decision.contextWindowTokens,
            createdAt: Date.now(),
          });
          runtimeContent = prependStatePackToPrompt(
            compacted.statePack,
            content,
          );
          mainWindow.webContents.send(IPC.CHAT_EVENT, {
            type: "context.compaction",
            sessionId: threadId,
            turnId,
            phase: "completed",
            reason: "preflight",
            message: `Compressed context to ${compacted.afterTokens} estimated tokens before sending.`,
          });
        }
        if (decision.level === "restart" || decision.level === "blocked") {
          const completedAt = Date.now();
          mainWindow.webContents.send(IPC.CHAT_EVENT, {
            type: "context.compaction",
            sessionId: threadId,
            turnId,
            phase: "blocked",
            reason: "preflight",
            message: `Context usage is ${Math.round(decision.percentage ?? 0)}%, above the restart threshold. Start a new session or switch to a larger context model.`,
            actionRequest: {
              id: `context-action-${turnId}`,
              sessionId: threadId,
              reason: "context_too_large",
              title: "Context window is nearly full",
              detail: `Estimated ${contextTokens} tokens / ${decision.contextWindowTokens} token context window.`,
              largerModel: decision.fallback?.largerModel,
              actions: Array.from(
                new Set([
                  ...(decision.fallback?.actions ?? ["new_session"]),
                  "continue_anyway",
                ]),
              ),
            },
          });
          mainWindow.webContents.send(IPC.CHAT_ITEM_EVENT, {
            type: "turn.complete",
            sessionId: threadId,
            turnId,
            result: "error",
            error:
              "Context window is nearly full. Start a new session or choose a larger context model.",
            completedAt,
          });
          appendStoredMessage(threadId, {
            id: `assistant-${turnId}`,
            role: "assistant",
            content:
              "Context window is nearly full. Start a new session or choose a larger context model.",
            timestamp: startedAt,
            status: "failed",
            startedAt,
            completedAt,
            modelId: turnModelSnapshot.modelId,
            modelName: turnModelSnapshot.modelName,
            items: [],
          });
          return;
        }
      }
      runtimeContent = appendAttachmentSummaryToPrompt(
        runtimeContent,
        request.attachments,
      );
      const eventStream = await runtime.sendMessage({
        threadId,
        turnId,
        content: runtimeContent,
        displayContent: content,
        cwd: currentWorkspace()?.path,
        attachments: request.attachments,
        messageId: userMessageId,
        runtimeThreadId: nativeRuntimeThreadId,
        settingsSnapshot: turnSettings,
      });
      for await (const evt of eventStream) {
        const ts = Date.now();
        const uiEvent = translateRuntimeEventToUIEvent(evt, threadId, turnId);
        if (!uiEvent) continue;
        if (uiEvent.type === "usage" || uiEvent.type === "context.usage") {
          mainWindow.webContents.send(IPC.CHAT_EVENT, uiEvent);
        }

        if (uiEvent.type === "text.chunk") {
          upsertAgentMessage(uiEvent.content, ts);
          continue;
        }

        if (uiEvent.type === "thinking.chunk") {
          const id = `reasoning-${turnId}`;
          const existing = items.get(id);
          const text = (existing?.text ?? "") + uiEvent.content;
          const item: MessageItem = {
            id,
            type: "reasoning",
            rawType: "thinking_delta",
            phase: "updated",
            text,
            status: "in_progress",
            updatedAt: ts,
          };
          items.set(id, item);
          mainWindow.webContents.send(IPC.CHAT_ITEM_EVENT, {
            type: "item.updated",
            sessionId: threadId,
            turnId,
            item,
          });
          continue;
        }

        if (uiEvent.type === "tool.start") {
          closeCurrentAgentMessage(ts);
          const item: MessageItem = {
            id: uiEvent.toolId,
            type: "mcp_tool_call",
            rawType: "tool_use",
            phase: "started",
            tool: uiEvent.toolName,
            args: uiEvent.input ?? {},
            arguments: uiEvent.input ?? {},
            status: "in_progress",
            startedAt: ts,
          };
          items.set(uiEvent.toolId, item);
          mainWindow.webContents.send(IPC.CHAT_ITEM_EVENT, {
            type: "item.updated",
            sessionId: threadId,
            turnId,
            item,
          });
          continue;
        }

        if (uiEvent.type === "tool.complete") {
          const existing = items.get(uiEvent.toolId);
          const item: MessageItem = {
            ...(existing ?? {
              id: uiEvent.toolId,
              type: "mcp_tool_call" as const,
              tool: "tool",
              args: {},
              arguments: {},
            }),
            id: uiEvent.toolId,
            type: "mcp_tool_call",
            rawType: "tool_result",
            phase: "completed",
            result: uiEvent.output,
            status: uiEvent.isError ? "error" : "completed",
            completedAt: ts,
          };
          items.set(uiEvent.toolId, item);
          mainWindow.webContents.send(IPC.CHAT_ITEM_EVENT, {
            type: "item.updated",
            sessionId: threadId,
            turnId,
            item,
          });
          continue;
        }

        if (uiEvent.type === "approval.request") {
          const item: MessageItem = {
            id: uiEvent.requestId,
            type: "permission_request",
            rawType: "approval_request",
            phase: "started",
            toolName: uiEvent.toolName,
            tool: uiEvent.toolName,
            reason: uiEvent.reason,
            message: uiEvent.reason,
            status: "running",
            timeoutMs: uiEvent.timeout,
            startedAt: ts,
          };
          items.set(uiEvent.requestId, item);
          pendingApprovalItems.set(uiEvent.requestId, {
            sessionId: threadId,
            turnId,
            toolName: uiEvent.toolName,
            reason: uiEvent.reason,
            timeoutMs: uiEvent.timeout,
          });
          mainWindow.webContents.send(IPC.CHAT_ITEM_EVENT, {
            type: "item.updated",
            sessionId: threadId,
            turnId,
            item,
          });
          getMainWindow()?.webContents.send(IPC.CHAT_PERMISSION_REQUEST, {
            id: uiEvent.requestId,
            requestId: uiEvent.requestId,
            sessionId: threadId,
            turnId,
            toolName: uiEvent.toolName,
            reason: uiEvent.reason,
            inputSummary: uiEvent.reason,
            cwd: currentWorkspace()?.path,
            timeout: uiEvent.timeout,
          });
          continue;
        }

        if (uiEvent.type === "usage") {
          tokenUsage = uiEvent.usage;
          continue;
        }

        if (uiEvent.type === "turn.complete") {
          const completedAt = ts;
          await captureWorkspaceCheckpoint({
            sessionId: threadId,
            turnId,
            messageId: userMessageId,
            workspacePath,
            phase: "turn_end",
          });
          closeCurrentAgentMessage(completedAt);

          mainWindow.webContents.send(IPC.CHAT_ITEM_EVENT, {
            type: "turn.complete",
            sessionId: threadId,
            turnId,
            result: uiEvent.result,
            error: uiEvent.error,
            usage: tokenUsage,
            completedAt,
          });
          appendStoredMessage(
            threadId,
            {
              id: `assistant-${turnId}`,
              role: "assistant",
              content: fullAgentText() || uiEvent.error || "",
              timestamp: startedAt,
              status: uiEvent.result === "error" ? "failed" : "completed",
              startedAt,
              completedAt,
              modelId: turnModelSnapshot.modelId,
              modelName: turnModelSnapshot.modelName,
              usage: tokenUsage,
              items: Array.from(items.values()).map(
                messageItemToWorkflowTurnItem,
              ),
            },
            undefined,
            uiEvent.sdkSessionId,
            activeRuntimeId,
          );
          const usageInput = tokenUsage?.inputTokens;
          const usageOutput = tokenUsage?.outputTokens;
          const usageStr =
            usageInput != null && usageOutput != null
              ? `${usageInput}+${usageOutput}`
              : null;
          logInfo("chat.turnCompleted", {
            sessionId: threadId,
            result: uiEvent.result,
            elapsedMs: Date.now() - startedAt,
            ...(usageStr ? { usage: usageStr } : {}),
          });
          continue;
        }

        if (uiEvent.type === "error") {
          const completedAt = ts;
          await captureWorkspaceCheckpoint({
            sessionId: threadId,
            turnId,
            messageId: userMessageId,
            workspacePath,
            phase: "turn_end",
          });
          closeCurrentAgentMessage(completedAt);
          mainWindow.webContents.send(IPC.CHAT_ITEM_EVENT, {
            type: "turn.complete",
            sessionId: threadId,
            turnId,
            result: "error",
            error: uiEvent.message,
            completedAt,
          });
          appendStoredMessage(threadId, {
            id: `assistant-${turnId}`,
            role: "assistant",
            content: fullAgentText() || uiEvent.message,
            timestamp: startedAt,
            status: "failed",
            startedAt,
            completedAt,
            modelId: turnModelSnapshot.modelId,
            modelName: turnModelSnapshot.modelName,
            usage: tokenUsage,
            items: Array.from(items.values()).map(
              messageItemToWorkflowTurnItem,
            ),
          });
        }
      }
    } catch (err) {
      const completedAt = Date.now();
      const errorMessage = err instanceof Error ? err.message : String(err);
      await captureWorkspaceCheckpoint({
        sessionId: threadId,
        turnId,
        messageId: userMessageId,
        workspacePath,
        phase: "turn_end",
      });
      closeCurrentAgentMessage(completedAt);
      mainWindow.webContents.send(IPC.CHAT_ITEM_EVENT, {
        type: "turn.complete",
        sessionId: threadId,
        turnId,
        result: "error",
        error: errorMessage,
        completedAt,
      });
      appendStoredMessage(threadId, {
        id: `assistant-${turnId}`,
        role: "assistant",
        content: fullAgentText() || errorMessage,
        timestamp: startedAt,
        status: "failed",
        startedAt,
        completedAt,
        modelId: turnModelSnapshot.modelId,
        modelName: turnModelSnapshot.modelName,
        usage: tokenUsage,
        items: Array.from(items.values()).map(messageItemToWorkflowTurnItem),
      });
    }
  })();

  return {
    status: "started",
    sessionId: threadId,
    messageId: userMessageId,
    turnId,
  };
}

export function registerHandlers(): void {
  registerReadThreadBroadcast();
  // ---------- App ----------

  ipcMain.handle(IPC.APP_GET_VERSION, () => app.getVersion());
  ipcMain.handle(IPC.APP_GET_VERSION_INFO, () => getAppVersionInfo());
  ipcMain.handle(IPC.APP_RENDERER_READY, (_event, payload: unknown) =>
    markRendererReady(payload),
  );
  ipcMain.handle(IPC.APP_EXPORT_DIAGNOSTICS, () => exportDiagnostics());

  ipcMain.handle(IPC.UPDATE_GET_STATE, () => getUpdateState());
  ipcMain.handle(IPC.UPDATE_GET_PREFERENCES, () => getUpdatePreferences());
  ipcMain.handle(IPC.UPDATE_SAVE_PREFERENCES, (_event, value: unknown) => {
    const previous = getUpdatePreferences();
    const preferences = saveUpdatePreferences(value);
    applyUpdatePreferences(preferences, {
      channelChanged: previous.channel !== preferences.channel,
    });
    return preferences;
  });
  ipcMain.handle(IPC.UPDATE_CHECK, () => checkForUpdatesManual());
  ipcMain.handle(IPC.UPDATE_DOWNLOAD, () => downloadUpdateNow());
  ipcMain.handle(IPC.UPDATE_INSTALL_NOW, () => installUpdateNow());

  // ---------- Window ----------

  ipcMain.on(IPC.WINDOW_MINIMIZE, (event) =>
    BrowserWindow.fromWebContents(event.sender)?.minimize(),
  );
  ipcMain.on(IPC.WINDOW_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
  ipcMain.handle(IPC.WINDOW_SET_MAXIMIZED, (event, maximized: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    if (maximized) win.maximize();
    else win.unmaximize();
    return win.isMaximized();
  });
  ipcMain.on(IPC.WINDOW_CLOSE, (event) =>
    BrowserWindow.fromWebContents(event.sender)?.close(),
  );
  ipcMain.handle(
    IPC.WINDOW_IS_MAXIMIZED,
    (event) =>
      BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false,
  );

  // ---------- Auth ----------

  ipcMain.handle(IPC.AUTH_GET_STATUS, () => getAuthStatus());
  ipcMain.handle(IPC.AUTH_OPEN_LOGIN, () => {
    const status = openAuthPage("login");
    getMainWindow()?.webContents.send(IPC.AUTH_STATUS_CHANGED, status);
    return status;
  });
  ipcMain.handle(IPC.AUTH_OPEN_REGISTER, () => {
    const status = openAuthPage("register");
    getMainWindow()?.webContents.send(IPC.AUTH_STATUS_CHANGED, status);
    return status;
  });
  ipcMain.handle(IPC.AUTH_LOGOUT, () => {
    const status = logout();
    getMainWindow()?.webContents.send(IPC.AUTH_STATUS_CHANGED, status);
    return status;
  });

  // ---------- Chat ----------

  ipcMain.handle(IPC.CHAT_LIST_SESSIONS, async () => {
    const runtime = getRuntime();
    const threads = await runtime.listThreads();
    return mergeRuntimeAndStoredSessions(threads, currentWorkspace()?.path);
  });

  ipcMain.handle(IPC.CHAT_LIST_ALL_SESSIONS, async () => {
    const runtime = getRuntime();
    const threads = await runtime.listThreads();
    return mergeRuntimeAndStoredSessions(threads);
  });

  ipcMain.handle(
    IPC.CHAT_SEARCH_SESSIONS,
    async (_e, query: string, limit?: number) => {
      const threads = await getRuntime().listThreads();
      const sessions = mergeRuntimeAndStoredSessions(
        threads,
        currentWorkspace()?.path,
      );
      const needle = query.trim().toLowerCase();
      if (!needle) return [];
      const results: SessionSearchResult[] = [];
      for (const session of sessions) {
        if (limit && results.length >= limit) break;
        const matches = session.messages
          .filter((message) => message.content.toLowerCase().includes(needle))
          .slice(0, 20);
        for (const message of matches) {
          if (limit && results.length >= limit) break;
          const excerpt = truncateText(message.content, 160);
          results.push({
            sessionId: session.id,
            turnId: message.id,
            ordinal: 0,
            title: session.title,
            workspacePath: session.workspacePath,
            excerpt,
            updatedAt: message.createdAt,
          });
        }
      }
      return results;
    },
  );

  ipcMain.handle(IPC.CHAT_CREATE_SESSION, async () => {
    const runtime = getRuntime();
    const thread = await runtime.createThread();
    const workspace = currentWorkspace();
    const record = {
      id: thread.id,
      title: thread.title,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      isPinned: false,
      messages: [],
      workspacePath: workspace?.path,
      workspaceName: workspace?.name,
    } as ChatSessionRecord;
    persistSessionRecord(record);
    logInfo("chat.sessionCreated", {
      sessionId: thread.id,
      title: thread.title,
    });
    return record;
  });

  ipcMain.handle(IPC.CHAT_DELETE_SESSION, async (_e, sessionId: string) => {
    const runtime = getRuntime();
    await runtime.deleteThread(sessionId);
    store.deleteSession(sessionId);
    logInfo("chat.sessionDeleted", { sessionId });
  });

  ipcMain.handle(
    IPC.CHAT_UPDATE_SESSION_TITLE,
    async (_e, sessionId: string, title: string) => {
      const nextTitle = title.trim();
      if (!nextTitle) return;
      store.renameSession(sessionId, nextTitle);
    },
  );

  ipcMain.handle(
    IPC.CHAT_TOGGLE_SESSION_PINNED,
    async (_e, sessionId: string) => {
      const existing = store.getSession(sessionId);
      if (existing) {
        store.saveSession({
          ...existing,
          pinned: !existing.pinned,
          updatedAt: Date.now(),
        });
        return;
      }
      const runtime = getRuntime();
      const thread = (await runtime.listThreads()).find(
        (item) => item.id === sessionId,
      );
      if (!thread) return;
      const record = {
        ...sessionRecordFromThread(thread),
        isPinned: true,
        updatedAt: Date.now(),
      };
      persistSessionRecord(record);
    },
  );

  ipcMain.handle(
    IPC.CHAT_FORK_SESSION,
    async (_e, request: ChatForkRequest) => {
      const runtime = getRuntime();
      if (!runtime.capabilities.forkThread || !runtime.forkThread) return null;
      const newThread = await runtime.forkThread(
        request.sessionId,
        request.upToMessageId,
      );
      const record = {
        id: newThread.id,
        title: request.title?.trim() || newThread.title,
        createdAt: newThread.createdAt,
        updatedAt: newThread.updatedAt,
        isPinned: false,
        messages: newThread.messages.map(chatMessageFromRuntimeMessage),
      } as ChatSessionRecord;
      persistSessionRecord(record);
      logInfo("chat.sessionForked", {
        parentSessionId: request.sessionId,
        newSessionId: newThread.id,
      });
      return record;
    },
  );

  ipcMain.handle(
    IPC.CHAT_REWIND_FILES,
    async (_e, request: ChatRewindRequest): Promise<ChatRewindResult> => {
      const dryRun = request.dryRun !== false;
      const result = dryRun
        ? previewWorkspaceRewind({
            sessionId: request.sessionId,
            targetMessageId: request.userMessageId,
          })
        : await applyWorkspaceRewind({
            sessionId: request.sessionId,
            targetMessageId: request.userMessageId,
            confirmedFiles: request.confirmedFiles ?? [],
          });

      recordWorkspaceRewindEvent({
        sessionId: request.sessionId,
        targetMessageId: request.userMessageId,
        dryRun,
        status: result.error
          ? "error"
          : result.canRewind === false
            ? "blocked"
            : "ready",
        files: result.filesChanged,
        result,
        createdAt: Date.now(),
      });
      return result;
    },
  );

  ipcMain.handle(
    IPC.CHAT_EXPORT_SESSION,
    async (_e, sessionId: string): Promise<string | null> => {
      return exportChatSession(sessionId);
    },
  );

  // Send a chat message and normalize it into MessageItem events.
  ipcMain.handle(IPC.CHAT_SEND, async (_event, request: ChatSendRequest) =>
    sendChatTurn(request),
  );

  ipcMain.handle(
    IPC.CHAT_RESEND_FROM_MESSAGE,
    async (_event, request: ChatResendRequest) => {
      const runtime = getRuntime();
      if (!runtime.capabilities.editMessage || !runtime.truncateThread) {
        throw new Error(
          `${runtime.name} does not support editing or regeneration`,
        );
      }

      const trimmedText = request.text.trim();
      if (!trimmedText) throw new Error("Message text cannot be empty");

      await runtime.truncateThread(request.sessionId, {
        fromMessageId: request.fromMessageId,
        includeMessage: false,
      });
      truncateStoredSession(request.sessionId, request.fromMessageId, false);
      const receipt = await sendChatTurn({
        sessionId: request.sessionId,
        text: trimmedText,
        clientMessageId: request.fromMessageId,
      });
      const session = store.getSession(request.sessionId);
      if (!session)
        throw new Error(`Session not found after resend: ${request.sessionId}`);

      return {
        ...sessionRecordFromStoredSession(session),
        requestId: receipt.turnId ?? receipt.messageId,
      };
    },
  );

  ipcMain.handle(IPC.CHAT_ABORT, async (_e, requestId: string) => {
    try {
      const runtime = getRuntime();
      if (runtime.interruptTurn) await runtime.interruptTurn(requestId);
    } catch {
      // ignore
    }
  });

  ipcMain.handle(IPC.CHAT_READ_THREAD, async (_e, sessionId: string) =>
    readRuntimeThreadSnapshot(sessionId),
  );

  ipcMain.handle(IPC.CHAT_CANCEL_TOOL, async (_e, toolCallId: string) => {
    const runtime = getRuntime();
    if (!runtime.capabilities.cancelTool || !runtime.cancelTool) {
      throw new Error(`${runtime.name} does not support tool cancellation`);
    }
    await runtime.cancelTool(toolCallId);
  });

  ipcMain.handle(IPC.CHAT_COMPACT, async (_e, sessionId: string) => {
    const stored = store.getSession(sessionId);
    if (!stored) return;
    const settings = getAgentSettings();
    const modelProvider = resolveModelProvider(settings);
    const contextMgmt = settings.contextManagement;
    const sessionRecord = sessionRecordFromStoredSession(stored);
    const sessionTokens = estimateSessionTokens(sessionRecord);
    const threshold = contextMgmt?.compactThresholdPercent ?? 75;
    const targetTokens = Math.max(
      1,
      Math.round((sessionTokens * threshold) / 100),
    );
    await compactAndRecordSessionState({
      session: sessionRecord,
      modelProvider,
      targetTokens,
      reason: "manual",
    });
    sendReadThreadUpdate(sessionId);
  });

  ipcMain.on(
    IPC.CHAT_PERMISSION_RESPONSE,
    (_e, { requestId, approved, scope, reason }) => {
      const runtime = getRuntime();
      runtime.respondApproval(requestId, approved, scope, reason);
      const pending = pendingApprovalItems.get(requestId);
      if (pending) {
        pendingApprovalItems.delete(requestId);
        const item: MessageItem = {
          id: requestId,
          type: "permission_request",
          rawType: "approval_request",
          phase: "completed",
          toolName: pending.toolName,
          tool: pending.toolName,
          reason: reason ?? pending.reason,
          message: reason ?? pending.reason,
          status: approved ? "completed" : "denied",
          timeoutMs: pending.timeoutMs,
          completedAt: Date.now(),
        };
        getMainWindow()?.webContents.send(IPC.CHAT_ITEM_EVENT, {
          type: "item.updated",
          sessionId: pending.sessionId,
          turnId: pending.turnId,
          item,
        });
      }
    },
  );

  // ---------- Config ----------

  ipcMain.handle(IPC.CONFIG_GET_AGENT_SETTINGS, async () => getAgentSettings());

  ipcMain.handle(
    IPC.CONFIG_SAVE_AGENT_SETTINGS,
    async (_e, settings: AgentSettings) => {
      saveAgentSettings(settings);
      return settings;
    },
  );

  ipcMain.handle(
    IPC.CONFIG_TEST_ENDPOINT_PROFILE,
    async (_e, profile: ModelProviderConfig) => testEndpointProfile(profile),
  );

  ipcMain.handle(
    IPC.CONFIG_TEST_ENDPOINT_MODEL,
    async (_e, profile: ModelProviderConfig, modelId: string) =>
      testEndpointModel(profile, modelId),
  );

  ipcMain.handle(
    IPC.CONFIG_LIST_ENDPOINT_MODELS,
    async (_e, profile: ModelProviderConfig) => listEndpointModels(profile),
  );

  ipcMain.handle(IPC.RUNTIME_GET_STATE, async () => getRuntimeState());

  ipcMain.handle(IPC.RUNTIME_SWITCH, async (_e, runtimeId: RuntimeKind) => {
    const prev = getRuntime();
    await switchRuntime(runtimeId);
    logInfo("runtime.switched", { from: prev.name, to: runtimeId });
  });

  ipcMain.handle(IPC.RUNTIME_LIST_MODELS, async () => listRuntimeModels());
  ipcMain.handle(
    IPC.RUNTIME_SET_MODEL,
    async (_e, providerId: string, modelId: string) =>
      setRuntimeModel(providerId, modelId),
  );

  // ---------- Workspace ----------

  ipcMain.handle(IPC.WORKSPACE_GET_CURRENT, (): WorkspaceInfo | null => {
    return currentWorkspace();
  });

  ipcMain.handle(IPC.WORKSPACE_GET_SETTINGS, (): WorkspaceSettings =>
    getWorkspaceSettings(),
  );

  ipcMain.handle(
    IPC.WORKSPACE_SELECT,
    async (): Promise<WorkspaceInfo | null> => {
      const workspace = await selectWorkspace();
      if (!workspace) return null;
      recordAuditEvent({
        workspacePath: workspace.path,
        toolName: "workspace.select",
        inputSummary: workspace.path,
        status: "completed",
      });
      return workspace;
    },
  );

  ipcMain.handle(
    IPC.WORKSPACE_SWITCH,
    (_e, id: string): WorkspaceInfo | null => {
      const ws = switchWorkspace(id);
      if (ws) {
        recordAuditEvent({
          workspacePath: ws.path,
          toolName: "workspace.switch",
          inputSummary: id,
          outputSummary: ws.path,
          status: "completed",
        });
      }
      return ws;
    },
  );

  ipcMain.handle(
    IPC.WORKSPACE_RENAME,
    (_e, id: string, name: string): WorkspaceInfo | null => {
      const ws = renameWorkspace(id, name);
      if (ws) {
        recordAuditEvent({
          workspacePath: ws.path,
          toolName: "workspace.rename",
          inputSummary: id,
          outputSummary: ws.name,
          status: "completed",
        });
      }
      return ws;
    },
  );

  ipcMain.handle(
    IPC.WORKSPACE_REMOVE,
    (_e, id: string): WorkspaceInfo | null => {
      const previous = getWorkspaceSettings().workspaces.find(
        (w) => w.id === id,
      );
      const current = removeWorkspace(id);
      if (previous) {
        recordAuditEvent({
          workspacePath: previous.path,
          toolName: "workspace.remove",
          inputSummary: id,
          outputSummary: "Removed from workspace list",
          status: "completed",
        });
      }
      return current;
    },
  );

  ipcMain.handle(IPC.WORKSPACE_OPEN_IN_EXPLORER, (_e, id: string) => {
    const ws = getWorkspaceSettings().workspaces.find((w) => w.id === id);
    if (ws) void shell.openPath(ws.path);
  });
  // ---------- FS ----------

  ipcMain.handle(IPC.FS_LIST_DIR, async (_e, dirPath: string) => {
    const workspace = currentWorkspace();
    const entries = await listWorkspaceDir(workspace, dirPath || ".");
    recordAuditEvent({
      workspacePath: workspace?.path,
      toolName: "fs.listDir",
      inputSummary: dirPath || ".",
      outputSummary: `${entries.length} entries`,
      status: "completed",
    });
    return entries;
  });

  ipcMain.handle(IPC.FS_READ_FILE, async (_e, filePath: string) => {
    const workspace = currentWorkspace();
    const fileStat = await statWorkspaceFile(workspace, filePath);
    const content = await readWorkspaceFile(workspace, filePath);
    recordAuditEvent({
      workspacePath: workspace?.path,
      toolName: "fs.readFile",
      inputSummary: filePath,
      outputSummary: `${fileStat.size} bytes`,
      status: "completed",
    });
    return content;
  });

  ipcMain.handle(IPC.FS_STAT, async (_e, filePath: string) => {
    const workspace = currentWorkspace();
    const fileStat = await statWorkspaceFile(workspace, filePath);
    recordAuditEvent({
      workspacePath: workspace?.path,
      toolName: "fs.stat",
      inputSummary: filePath,
      outputSummary: `${fileStat.size} bytes`,
      status: "completed",
    });
    return fileStat;
  });

  // ---------- Memory ----------

  ipcMain.handle(IPC.MEMORY_LIST, async () =>
    listMemoryFilesFromService(currentWorkspace()),
  );
  ipcMain.handle(IPC.MEMORY_READ, async (_e, fileId: string) =>
    readMemoryFile(fileId, currentWorkspace()),
  );
  ipcMain.handle(
    IPC.MEMORY_WRITE,
    async (_e, fileId: string, content: string) => {
      const updated = await writeMemoryFile(
        fileId,
        content,
        currentWorkspace(),
      );
      recordAuditEvent({
        workspacePath: currentWorkspace()?.path,
        toolName: "memory.write",
        inputSummary: fileId,
        outputSummary: `${Buffer.byteLength(content, "utf-8")} bytes`,
        status: "completed",
      });
      return updated;
    },
  );
  // ---------- MCP ----------

  ipcMain.handle(IPC.MCP_LIST_SERVERS, async (): Promise<McpServerConfig[]> => {
    return listMcpServers();
  });

  ipcMain.handle(
    IPC.MCP_SAVE_SERVERS,
    async (_e, servers: McpServerConfig[]): Promise<McpServerConfig[]> => {
      const saved = await saveMcpServers(servers);
      recordAuditEvent({
        toolName: "mcp.saveServers",
        inputSummary: `${servers.length} servers`,
        status: "completed",
      });
      return saved;
    },
  );

  ipcMain.handle(
    IPC.MCP_TEST_SERVER,
    async (_e, server: McpServerConfig): Promise<McpServerConfig> => {
      const tested = await testMcpServer(server);
      recordAuditEvent({
        toolName: "mcp.testServer",
        inputSummary: tested.name,
        outputSummary: tested.lastProbeResult ?? tested.lastError,
        status: tested.lastStatus === "ok" ? "completed" : "error",
        isError: tested.lastStatus === "error",
      });
      return tested;
    },
  );

  ipcMain.handle(
    IPC.MCP_REFRESH_STATUS,
    async (): Promise<McpServerConfig[]> => {
      const refreshed = await refreshMcpServerStatuses();
      recordAuditEvent({
        toolName: "mcp.refreshStatus",
        inputSummary: `${refreshed.filter((server) => server.enabled).length} enabled servers`,
        outputSummary: refreshed
          .map((server) => `${server.name}:${server.lastStatus ?? "untested"}`)
          .join(", "),
        status: refreshed.some(
          (server) =>
            server.lastStatus === "error" ||
            server.lastStatus === "disconnected",
        )
          ? "error"
          : "completed",
        isError: refreshed.some(
          (server) =>
            server.lastStatus === "error" ||
            server.lastStatus === "disconnected",
        ),
      });
      return refreshed;
    },
  );

  ipcMain.handle(IPC.MCP_LIST_TOOLS, async (): Promise<string[]> => {
    return listRuntimeMcpTools();
  });

  // ---------- Audit ----------

  ipcMain.handle(IPC.AUDIT_LIST, async (_e, limit?: number) =>
    listAuditEvents(limit),
  );

  // ---------- Skill ----------

  ipcMain.handle(IPC.SKILL_LIST, async (): Promise<SkillInfo[]> =>
    listInstalledSkillsFromService(),
  );

  ipcMain.handle(
    IPC.SKILL_IMPORT_FOLDER,
    async (): Promise<SkillInfo | null> => {
      const skill = await importSkillFolderFromService();
      if (!skill) return null;
      recordAuditEvent({
        toolName: "skill.importFolder",
        inputSummary: skill.path,
        outputSummary: skill.name,
        status: "completed",
      });
      return skill;
    },
  );

  ipcMain.handle(
    IPC.SKILL_TOGGLE,
    async (_e, skillId: string, enabled: boolean): Promise<SkillInfo[]> => {
      const skills = toggleSkillFromService(skillId, enabled);
      recordAuditEvent({
        toolName: "skill.toggle",
        inputSummary: `${skillId} -> ${enabled ? "enabled" : "disabled"}`,
        status: "completed",
      });
      return skills;
    },
  );

  ipcMain.handle(
    IPC.SKILL_REMOVE,
    async (_e, skillId: string): Promise<SkillInfo[]> => {
      const before = listInstalledSkillsFromService().find(
        (item) => item.id === skillId,
      );
      const skills = removeSkillFromService(skillId);
      recordAuditEvent({
        toolName: "skill.remove",
        inputSummary: skillId,
        outputSummary: before?.path,
        status: "completed",
      });
      return skills;
    },
  );

  ipcMain.handle(
    IPC.SKILL_GET_DETAIL,
    async (_e, skillId: string): Promise<SkillDetail> =>
      getSkillDetailFromService(skillId),
  );

  ipcMain.handle(IPC.SKILL_MARKETPLACE_LIST, async () =>
    listMarketplaceSkills(),
  );
  ipcMain.handle(IPC.SKILL_MARKETPLACE_DETAIL, async (_e, slug: string) =>
    getMarketplaceSkillDetail(slug),
  );
  ipcMain.handle(IPC.SKILL_MARKETPLACE_INSTALL, async () =>
    installMarketplaceSkill(),
  );
}
