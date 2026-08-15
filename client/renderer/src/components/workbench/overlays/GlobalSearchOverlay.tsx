import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Folder,
  History,
  MessageSquare,
  Package,
  PlugZap,
  Search,
  ServerCog,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { SettingsSection } from "@/components/settings/types";
import type { Page } from "../types";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type {
  AgentSettings,
  AuditEventRecord,
  ChatSessionRecord,
  SessionSearchResult,
  SkillInfo,
} from "@shared/types";
import { workspacePathsEqual } from "@shared/workspace-path";

export function GlobalSearchOverlay({
  open,
  onClose,
  onPage,
  onOpenSettings,
}: {
  open: boolean;
  onClose: () => void;
  onPage: (page: Page) => void;
  onOpenSettings: (section: SettingsSection) => void;
}) {
  const [query, setQuery] = useState("");
  const [allSessions, setAllSessions] = useState<ChatSessionRecord[]>([]);
  const [agentSettings, setAgentSettings] = useState<AgentSettings | null>(
    null,
  );
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [mcpTools, setMcpTools] = useState<string[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventRecord[]>([]);
  const [sessionMatches, setSessionMatches] = useState<SessionSearchResult[]>(
    [],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const setActiveSession = useUnifiedChatStore(
    (state) => state.setActiveSession,
  );
  const loadChats = useUnifiedChatStore((state) => state.load);
  const workspace = useWorkspaceStore((state) => state.current);
  const workspaces = useWorkspaceStore((state) => state.settings.workspaces);
  const switchWorkspace = useWorkspaceStore((state) => state.switchWorkspace);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
    const chatApi = window.marloues.chat as typeof window.marloues.chat & {
      listAllSessions?: () => Promise<ChatSessionRecord[]>;
    };

    void Promise.allSettled([
      chatApi.listAllSessions?.() ?? window.marloues.chat.listSessions(),
      window.marloues.config.getAgentSettings(),
      window.marloues.skill.list(),
      window.marloues.mcp.listTools(),
      window.marloues.audit.list(200),
    ]).then(([sessions, settings, skillItems, tools, events]) => {
      setAllSessions(sessions.status === "fulfilled" ? sessions.value : []);
      setAgentSettings(settings.status === "fulfilled" ? settings.value : null);
      setSkills(skillItems.status === "fulfilled" ? skillItems.value : []);
      setMcpTools(tools.status === "fulfilled" ? tools.value : []);
      setAuditEvents(events.status === "fulfilled" ? events.value : []);
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const returnTarget = returnFocusRef.current;
      returnFocusRef.current = null;
      requestAnimationFrame(() => returnTarget?.focus());
    };
  }, [open]);

  useEffect(() => {
    if (!open || !normalizedQuery) {
      setSessionMatches([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void window.marloues.chat
        .searchSessions(query.trim(), 20)
        .then((matches) => {
          if (active) setSessionMatches(matches);
        })
        .catch(() => {
          if (active) setSessionMatches([]);
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [normalizedQuery, open, query]);

  const workspaceResults = useMemo(() => {
    if (!normalizedQuery) return workspaces.slice(0, 3);
    return workspaces.filter((item) =>
      `${item.name} ${item.path}`.toLowerCase().includes(normalizedQuery),
    );
  }, [normalizedQuery, workspaces]);

  const sessionResults = useMemo(() => {
    const items = normalizedQuery
      ? Array.from(
          sessionMatches.reduce((byId, match) => {
            if (byId.has(match.sessionId)) return byId;
            const existing = allSessions.find(
              (session) => session.id === match.sessionId,
            );
            const workspaceMatch = workspaces.find((item) =>
              workspacePathsEqual(item.path, match.workspacePath),
            );
            byId.set(
              match.sessionId,
              existing ?? {
                id: match.sessionId,
                title: match.title,
                createdAt: match.updatedAt,
                updatedAt: match.updatedAt,
                messages: [],
                workspacePath: match.workspacePath,
                workspaceName: workspaceMatch?.name,
              },
            );
            return byId;
          }, new Map<string, ChatSessionRecord>()),
        ).map(([, session]) => session)
      : allSessions.slice(0, 3);
    return items.sort(
      (a, b) =>
        Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)) ||
        b.updatedAt - a.updatedAt,
    );
  }, [allSessions, normalizedQuery, sessionMatches, workspaces]);
  const sessionMatchById = useMemo(
    () =>
      sessionMatches.reduce((byId, match) => {
        if (!byId.has(match.sessionId)) byId.set(match.sessionId, match);
        return byId;
      }, new Map<string, SessionSearchResult>()),
    [sessionMatches],
  );

  const settingResults = useMemo(() => {
    const items: SearchShortcut[] = [
      {
        id: "settings-general",
        title: "通用设置",
        detail: "运行模式、权限模式、审批超时",
        section: "general",
        icon: "settings",
      },
      {
        id: "settings-providers",
        title: "模型与 Provider",
        detail: "模型池、端点、默认模型",
        section: "providers",
        icon: "provider",
      },
      {
        id: "settings-mcp",
        title: "MCP",
        detail: "Server 与工具发现",
        page: "plugins",
        icon: "mcp",
      },
      {
        id: "settings-skills",
        title: "Skills",
        detail: "本地技能、项目技能、企业技能",
        section: "skills",
        icon: "skill",
      },
      {
        id: "settings-audit",
        title: "审计记录",
        detail: "工具运行、权限决策和错误记录",
        section: "audit",
        icon: "audit",
      },
      {
        id: "settings-runtime",
        title: "运行限制",
        detail: "权限、审批超时与敏感工具控制",
        section: "general",
        icon: "runtime",
      },
    ];
    return filterShortcuts(items, normalizedQuery);
  }, [normalizedQuery]);

  const providerResults = useMemo(() => {
    if (!agentSettings) return [];
    const providerItems: SearchShortcut[] = (
      agentSettings.providers ?? []
    ).flatMap((provider) => [
      {
        id: `provider-${provider.id}`,
        title: provider.name || provider.id || "未命名 Provider",
        detail: `${provider.enabled ? "已启用" : "已停用"} · ${provider.baseUrl ?? provider.type}`,
        section: "providers",
        icon: "provider",
      },
      ...(provider.models ?? []).map((model) => ({
        id: `model-${provider.id}-${model.id}`,
        title: model.label || model.id,
        detail: `${provider.name} · ${model.enabled ? "已启用" : "已停用"}`,
        section: "providers" as const,
        icon: "provider" as const,
      })),
    ]);
    return filterShortcuts(providerItems, normalizedQuery);
  }, [agentSettings, normalizedQuery]);

  const mcpResults = useMemo(() => {
    if (!agentSettings) return [];
    const serverItems: SearchShortcut[] = (agentSettings.mcpServers ?? []).map(
      (server) => ({
        id: `mcp-server-${server.id}`,
        title: server.name || server.id || "未命名 MCP Server",
        detail: `${server.enabled ? "已启用" : "已停用"} · ${server.lastStatus ?? "未测试"}${server.lastError ? ` · ${server.lastError}` : ""}`,
        page: "plugins" as const,
        icon: "mcp" as const,
      }),
    );
    const toolItems: SearchShortcut[] = mcpTools.map((tool) => ({
      id: `mcp-tool-${String(tool)}`,
      title: String(tool),
      detail: "MCP 工具",
      page: "plugins" as const,
      icon: "mcp" as const,
    }));
    return filterShortcuts([...serverItems, ...toolItems], normalizedQuery);
  }, [agentSettings, mcpTools, normalizedQuery]);

  const skillResults = useMemo(() => {
    const items: SearchShortcut[] = skills.map((skill) => ({
      id: `skill-${skill.id}`,
      title: skill.name || skill.id || "未命名 Skill",
      detail: `${skill.enabled ? "已启用" : "已停用"} · ${skill.scope}${skill.description ? ` · ${skill.description}` : ""}`,
      section: "skills",
      icon: "skill",
    }));
    return filterShortcuts(items, normalizedQuery);
  }, [normalizedQuery, skills]);

  const permissionResults = useMemo(() => {
    if (!agentSettings) return [];
    const policy = agentSettings.toolPermissionPolicy;
    const items: SearchShortcut[] = [
      {
        id: "permission-mode",
        title: "权限模式",
        detail: agentSettings.permissionMode,
        section: "general",
        icon: "permission",
      },
      {
        id: "permission-timeout",
        title: "审批超时",
        detail: `${Math.round(agentSettings.permissionApprovalTimeoutMs / 1000)} 秒`,
        section: "general",
        icon: "permission",
      },
      ...(agentSettings.toolProfiles ?? []).map((profile) => ({
        id: `tool-profile-${profile.id}`,
        title: profile.name || profile.id || "未命名权限配置",
        detail: `${profile.permissionMode} · ${profile.description}`,
        section: "general" as const,
        icon: "permission" as const,
      })),
      ...(policy?.sensitiveToolAllowlist ?? []).map((tool) => ({
        id: `sensitive-tool-${tool}`,
        title: tool,
        detail: "敏感工具免确认列表",
        section: "general" as const,
        icon: "permission" as const,
      })),
      ...(policy?.allowedTools ?? []).map((tool) => ({
        id: `allowed-tool-${tool}`,
        title: tool,
        detail: "允许工具",
        section: "general" as const,
        icon: "permission" as const,
      })),
      ...(policy?.disallowedTools ?? []).map((tool) => ({
        id: `disallowed-tool-${tool}`,
        title: tool,
        detail: "禁用工具",
        section: "general" as const,
        icon: "permission" as const,
      })),
    ];
    return filterShortcuts(items, normalizedQuery);
  }, [agentSettings, normalizedQuery]);

  const auditResults = useMemo(() => {
    const items: SearchShortcut[] = auditEvents.map((event) => ({
      id: `audit-${event.id}`,
      title: event.toolName || "未知工具",
      detail: `${event.status}${event.workspacePath ? ` · ${event.workspacePath}` : ""}${event.inputSummary ? ` · ${event.inputSummary}` : ""}`,
      section: "audit",
      icon: "audit",
    }));
    return filterShortcuts(items, normalizedQuery);
  }, [auditEvents, normalizedQuery]);

  if (!open) return null;

  const handleWorkspacePick = async (workspaceId: string) => {
    onClose();
    await switchWorkspace(workspaceId);
    await loadChats();
    onPage("chat");
  };

  const handleShortcutPick = (shortcut: SearchShortcut) => {
    if (shortcut.page) {
      onPage(shortcut.page);
    } else if (shortcut.section) {
      onOpenSettings(shortcut.section);
    }
    onClose();
  };

  const handleSessionPick = async (session: ChatSessionRecord) => {
    const targetWorkspace = workspaces.find((item) =>
      workspacePathsEqual(item.path, session.workspacePath),
    );
    if (targetWorkspace && targetWorkspace.id !== workspace?.id) {
      await switchWorkspace(targetWorkspace.id);
      await loadChats();
    }
    setActiveSession(session.id);
    onPage("chat");
    onClose();
  };

  const overlay = (
    <div className="global-search-overlay" onMouseDown={onClose}>
      <section
        className="global-search-panel"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="全局搜索"
      >
        <div className="global-search-input-row">
          <Search size={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索空间、会话和消息..."
          />
          <button
            type="button"
            onClick={onClose}
            title="关闭"
            aria-label="关闭"
          >
            <X size={15} />
          </button>
        </div>
        <div className="global-search-results">
          <div className="global-search-section">
            <span className="global-search-section-title">快捷入口</span>
            <ShortcutResults
              items={settingResults}
              emptyText="没有匹配的入口"
              onPick={handleShortcutPick}
            />
          </div>
          <div className="global-search-section">
            <span className="global-search-section-title">空间</span>
            {workspaceResults.length ? (
              workspaceResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="global-search-result"
                  onClick={() => void handleWorkspacePick(item.id)}
                >
                  <span className="global-search-icon">
                    {item.id === workspace?.id ? (
                      <Check size={15} />
                    ) : (
                      <Folder size={15} />
                    )}
                  </span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.path}</small>
                  </span>
                </button>
              ))
            ) : (
              <p className="global-search-empty">没有匹配的空间</p>
            )}
          </div>
          <div className="global-search-section">
            <span className="global-search-section-title">会话</span>
            {sessionResults.length ? (
              sessionResults.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className="global-search-result"
                  onClick={() => void handleSessionPick(session)}
                >
                  <span className="global-search-icon">
                    <MessageSquare size={15} />
                  </span>
                  <span>
                    <strong>
                      {session.title === "New chat" ? "新对话" : session.title}
                    </strong>
                    <small>
                      {session.workspaceName
                        ? `${session.workspaceName} · `
                        : ""}
                      {sessionMatchById.get(session.id)?.excerpt ??
                        getLastSessionMessage(session) ??
                        "暂无消息"}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <p className="global-search-empty">没有匹配的会话</p>
            )}
          </div>
          <div className="global-search-section">
            <span className="global-search-section-title">模型与 Provider</span>
            <ShortcutResults
              items={providerResults}
              emptyText="没有匹配的模型或 Provider"
              onPick={handleShortcutPick}
            />
          </div>
          <div className="global-search-section">
            <span className="global-search-section-title">MCP</span>
            <ShortcutResults
              items={mcpResults}
              emptyText="没有匹配的 MCP 项"
              onPick={handleShortcutPick}
            />
          </div>
          <div className="global-search-section">
            <span className="global-search-section-title">Skills</span>
            <ShortcutResults
              items={skillResults}
              emptyText="没有匹配的 Skill"
              onPick={handleShortcutPick}
            />
          </div>
          <div className="global-search-section">
            <span className="global-search-section-title">权限</span>
            <ShortcutResults
              items={permissionResults}
              emptyText="没有匹配的权限项"
              onPick={handleShortcutPick}
            />
          </div>
          <div className="global-search-section">
            <span className="global-search-section-title">审计</span>
            <ShortcutResults
              items={auditResults}
              emptyText="没有匹配的审计记录"
              onPick={handleShortcutPick}
            />
          </div>
        </div>
      </section>
    </div>
  );

  return createPortal(overlay, document.body);
}

function getLastSessionMessage(session: ChatSessionRecord): string | undefined {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  return messages.at(-1)?.content;
}

type SearchShortcutIcon =
  | "settings"
  | "provider"
  | "mcp"
  | "skill"
  | "permission"
  | "audit"
  | "runtime";

interface SearchShortcut {
  id: string;
  title: string;
  detail: string;
  /** 设置分区入口（与 page 二选一） */
  section?: SettingsSection;
  /** 页面级入口，例如插件中心（与 section 二选一） */
  page?: Page;
  icon: SearchShortcutIcon;
}

function ShortcutResults({
  items,
  emptyText,
  onPick,
}: {
  items: SearchShortcut[];
  emptyText: string;
  onPick: (shortcut: SearchShortcut) => void;
}) {
  if (!items.length) return <p className="global-search-empty">{emptyText}</p>;

  return (
    <>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="global-search-result"
          onClick={() => onPick(item)}
        >
          <span className="global-search-icon">
            {renderSearchShortcutIcon(item.icon)}
          </span>
          <span>
            <strong>{item.title}</strong>
            <small>{item.detail}</small>
          </span>
        </button>
      ))}
    </>
  );
}

function filterShortcuts<T extends SearchShortcut>(
  items: T[],
  query: string,
): T[] {
  const sorted = [...items].sort((a, b) =>
    String(a.title).localeCompare(String(b.title)),
  );
  if (!query) return sorted.slice(0, 3);
  return sorted.filter((item) =>
    `${String(item.title)} ${String(item.detail)}`
      .toLowerCase()
      .includes(query),
  );
}

function renderSearchShortcutIcon(icon: SearchShortcutIcon) {
  if (icon === "provider") return <ServerCog size={15} />;
  if (icon === "mcp") return <PlugZap size={15} />;
  if (icon === "skill") return <Package size={15} />;
  if (icon === "permission") return <ShieldCheck size={15} />;
  if (icon === "audit") return <History size={15} />;
  if (icon === "runtime") return <SlidersHorizontal size={15} />;
  return <Settings size={15} />;
}
