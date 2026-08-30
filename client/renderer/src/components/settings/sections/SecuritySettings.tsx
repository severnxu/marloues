import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileLock2,
  FolderOpen,
  Globe2,
  GlobeLock,
  Hand,
  Plus,
  ShieldCheck,
  SquareTerminal,
  TriangleAlert,
  X,
} from "lucide-react";
import type { AgentSecurityMode, AgentSettings } from "@shared/types";
import { applySecurityMode } from "@shared/security-policy";
import {
  SegmentedOptions,
  SettingRow,
  SettingsCard,
  SettingsSelect,
  ToggleSwitch,
} from "@/components/settings";
import { FullAccessConfirmDialog } from "@/components/workflow-chat";

const BUILT_IN_PROTECTED_PATHS = [
  "~/.ssh",
  "~/.aws",
  "~/.azure",
  "~/.kube",
  "~/.gnupg",
  ".git",
  ".marloues",
];

function splitRuleEntries(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function SecurityRuleGroup({
  icon,
  items,
  label,
  onItemsChange,
  placeholder,
}: {
  icon: ReactNode;
  items: string[];
  label: string;
  onItemsChange: (items: string[]) => void;
  placeholder: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const [input, setInput] = useState("");

  const addItems = () => {
    const nextItems = splitRuleEntries(input).filter(
      (item) => !items.includes(item),
    );
    if (nextItems.length === 0) return;
    onItemsChange([...items, ...nextItems]);
    setInput("");
  };

  return (
    <div
      className={`security-item-group ${expanded ? "" : "collapsed"}`.trim()}
    >
      <div className="security-group-head">
        <button
          className="security-group-toggle"
          type="button"
          aria-label={`${expanded ? "收起" : "展开"}${label}`}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <ChevronDown size={14} aria-hidden="true" />
          ) : (
            <ChevronRight size={14} aria-hidden="true" />
          )}
        </button>
        <span className="security-group-label">{label}</span>
        <span className="security-group-count">{items.length}</span>
      </div>

      {expanded ? (
        <>
          <div className="security-item-input-row">
            <input
              aria-label={`添加${label}`}
              value={input}
              placeholder={placeholder}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                addItems();
              }}
            />
            <button
              className="security-item-add"
              type="button"
              disabled={!input.trim()}
              onClick={addItems}
            >
              <Plus size={14} aria-hidden="true" />
              添加
            </button>
          </div>
          <div className="security-item-list">
            {items.length === 0 ? (
              <div className="security-item-empty">
                暂无规则，在上方输入后点击添加
              </div>
            ) : (
              items.map((item) => (
                <div className="security-item-row" key={item}>
                  <code title={item}>
                    <span className="security-item-icon">{icon}</span>
                    <span className="security-item-text">{item}</span>
                  </code>
                  <button
                    className="security-item-remove"
                    type="button"
                    title={`移除 ${item}`}
                    aria-label={`移除 ${item}`}
                    onClick={() =>
                      onItemsChange(items.filter((value) => value !== item))
                    }
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function SecuritySettings({
  draft,
  isPermissionTimeoutManaged,
  onCommitDraft,
}: {
  draft: AgentSettings;
  isPermissionTimeoutManaged: boolean;
  onCommitDraft: (nextDraft: AgentSettings) => void;
}) {
  const [confirmFullAccess, setConfirmFullAccess] = useState(false);
  const rules = draft.securityRules;
  const policy = draft.toolPermissionPolicy;

  const selectMode = (value: string) => {
    const mode = value as AgentSecurityMode;
    if (mode === "full-access" && draft.securityMode !== "full-access") {
      setConfirmFullAccess(true);
      return;
    }
    onCommitDraft(applySecurityMode(draft, mode));
  };

  const updateRules = (patch: Partial<AgentSettings["securityRules"]>) =>
    onCommitDraft({
      ...draft,
      securityRules: { ...rules, ...patch },
    });

  return (
    <>
      <div className="security-settings">
        <SettingsCard
          title="权限模式"
          description="所有运行时共享同一套批准策略；计划模式始终只读。"
          icon={<ShieldCheck size={16} />}
        >
          <SegmentedOptions
            value={draft.securityMode}
            onChange={selectMode}
            options={[
              {
                value: "request",
                title: "请求批准",
                description: "越过工作区或联网前询问",
              },
              {
                value: "auto-review",
                title: "帮我批准",
                description: "隔离审查器评估风险请求",
              },
              {
                value: "full-access",
                title: "完全访问",
                description: "不受沙箱和审批限制",
              },
            ]}
          />
        </SettingsCard>

        <SettingsCard
          title="沙箱边界"
          description="限制进程实际能够读取、写入和联网的范围，与运行时实现无关。"
          icon={<ShieldCheck size={16} />}
        >
          <SettingRow
            icon={<FileLock2 size={16} />}
            title="执行边界"
            description={
              draft.securityMode === "full-access"
                ? "完全访问模式已关闭沙箱"
                : "审批通过时只为当前操作临时提升边界"
            }
            trailing={
              <div className="security-select-control">
                <SettingsSelect
                  ariaLabel="沙箱执行边界"
                  disabled={draft.securityMode === "full-access"}
                  value={
                    draft.securityMode === "full-access"
                      ? "danger-full-access"
                      : (draft.sandboxMode ?? "workspace-write")
                  }
                  options={
                    draft.securityMode === "full-access"
                      ? [{ value: "danger-full-access", label: "完全访问" }]
                      : [
                          { value: "read-only", label: "只读" },
                          {
                            value: "workspace-write",
                            label: "工作区可写",
                          },
                          {
                            value: "workspace-write-network",
                            label: "工作区可写并联网",
                          },
                        ]
                  }
                  onChange={(value) =>
                    onCommitDraft({
                      ...draft,
                      sandboxEnabled: true,
                      sandboxMode: value as AgentSettings["sandboxMode"],
                    })
                  }
                />
              </div>
            }
          />
          <SettingRow
            icon={<TriangleAlert size={16} />}
            title="敏感操作确认"
            description="Bash、写文件和 MCP 等敏感工具需要策略检查"
            trailing={
              <ToggleSwitch
                checked={policy?.requireConfirmationForSensitiveTools ?? true}
                onChange={() =>
                  onCommitDraft({
                    ...draft,
                    toolPermissionPolicy: {
                      ...policy,
                      sensitiveToolAllowlist:
                        policy?.sensitiveToolAllowlist ?? [],
                      requireConfirmationForSensitiveTools: !(
                        policy?.requireConfirmationForSensitiveTools ?? true
                      ),
                    },
                  })
                }
              />
            }
          />
          <SettingRow
            icon={<Hand size={16} />}
            title="审批超时"
            description="等待批准超过该时长后自动拒绝"
            trailing={
              <input
                className="security-number-control"
                aria-label="审批超时（秒）"
                type="number"
                min={10}
                max={3600}
                disabled={isPermissionTimeoutManaged}
                value={Math.round(draft.permissionApprovalTimeoutMs / 1000)}
                onChange={(event) =>
                  onCommitDraft({
                    ...draft,
                    permissionApprovalTimeoutMs:
                      Math.min(
                        Math.max(Number(event.target.value) || 120, 10),
                        3600,
                      ) * 1000,
                  })
                }
              />
            }
          />
        </SettingsCard>

        <SettingsCard
          title="文件安全"
          description="白名单只降低审批频率；内置敏感目录始终优先保护。"
          icon={<FileLock2 size={16} />}
        >
          <SecurityRuleGroup
            icon={<FolderOpen size={14} aria-hidden="true" />}
            items={rules.autoAllowPaths}
            label="自动放行路径"
            placeholder="例如：C:\\workspace\\shared-cache"
            onItemsChange={(autoAllowPaths) => updateRules({ autoAllowPaths })}
          />
          <SecurityRuleGroup
            icon={<ShieldCheck size={14} aria-hidden="true" />}
            items={rules.protectedPaths}
            label="强制审批路径"
            placeholder="例如：C:\\Users\\me\\Documents"
            onItemsChange={(protectedPaths) => updateRules({ protectedPaths })}
          />
          <div className="settings-field security-builtins-field">
            <span>内置保护路径</span>
            <div className="security-builtins" aria-label="内置保护路径">
              {BUILT_IN_PROTECTED_PATHS.map((path) => (
                <code key={path}>{path}</code>
              ))}
            </div>
          </div>
        </SettingsCard>

        <SettingsCard
          title="命令安全"
          description="按命令前缀匹配；强制审批规则优先于自动放行。"
          icon={<SquareTerminal size={16} />}
        >
          <SecurityRuleGroup
            icon={<SquareTerminal size={14} aria-hidden="true" />}
            items={rules.commandAllowlist}
            label="放行命令"
            placeholder="例如：git status"
            onItemsChange={(commandAllowlist) =>
              updateRules({ commandAllowlist })
            }
          />
          <SecurityRuleGroup
            icon={<SquareTerminal size={14} aria-hidden="true" />}
            items={rules.commandAsklist}
            label="询问命令"
            placeholder="例如：git push"
            onItemsChange={(commandAsklist) => updateRules({ commandAsklist })}
          />
        </SettingsCard>

        <SettingsCard
          title="网络安全"
          description="域名规则在沙箱联网许可之前检查，拒绝列表优先。"
          icon={<Globe2 size={16} />}
        >
          <SettingRow
            icon={<Globe2 size={16} />}
            title="默认网络策略"
            description="未命中域名规则时采用的访问策略"
            trailing={
              <div className="security-select-control">
                <SettingsSelect
                  ariaLabel="默认网络策略"
                  value={rules.networkAccess}
                  options={[
                    { value: "ask", label: "按请求审批" },
                    { value: "deny", label: "阻断所有网络" },
                    { value: "allow", label: "允许网络" },
                  ]}
                  onChange={(value) =>
                    updateRules({
                      networkAccess:
                        value as AgentSettings["securityRules"]["networkAccess"],
                    })
                  }
                />
              </div>
            }
          />
          <SecurityRuleGroup
            icon={<Globe2 size={14} aria-hidden="true" />}
            items={rules.allowedDomains}
            label="允许域名"
            placeholder="api.example.com"
            onItemsChange={(allowedDomains) => updateRules({ allowedDomains })}
          />
          <SecurityRuleGroup
            icon={<GlobeLock size={14} aria-hidden="true" />}
            items={rules.deniedDomains}
            label="拒绝域名"
            placeholder="tracking.example.com"
            onItemsChange={(deniedDomains) => updateRules({ deniedDomains })}
          />
        </SettingsCard>
      </div>

      {confirmFullAccess ? (
        <FullAccessConfirmDialog
          onCancel={() => setConfirmFullAccess(false)}
          onConfirm={() => {
            onCommitDraft(applySecurityMode(draft, "full-access"));
            setConfirmFullAccess(false);
          }}
        />
      ) : null}
    </>
  );
}
