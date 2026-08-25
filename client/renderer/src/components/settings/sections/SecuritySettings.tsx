import { useState } from "react";
import {
  FileLock2,
  Globe2,
  Hand,
  ShieldCheck,
  SquareTerminal,
  TriangleAlert,
} from "lucide-react";
import type { AgentSecurityMode, AgentSettings } from "@shared/types";
import { applySecurityMode } from "@shared/security-policy";
import {
  SegmentedOptions,
  SettingRow,
  SettingsCard,
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

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
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
              icon: <Hand size={15} />,
            },
            {
              value: "auto-review",
              title: "帮我批准",
              description: "隔离审查器评估风险请求",
              icon: <ShieldCheck size={15} />,
            },
            {
              value: "full-access",
              title: "完全访问",
              description: "不受沙箱和审批限制",
              icon: <TriangleAlert size={15} />,
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
            <select
              aria-label="沙箱执行边界"
              disabled={draft.securityMode === "full-access"}
              value={draft.sandboxMode ?? "workspace-write"}
              onChange={(event) => {
                const sandboxMode = event.target
                  .value as AgentSettings["sandboxMode"];
                onCommitDraft({
                  ...draft,
                  sandboxEnabled: true,
                  sandboxMode,
                });
              }}
            >
              {draft.securityMode === "full-access" ? (
                <option value="danger-full-access">完全访问</option>
              ) : null}
              <option value="read-only">只读</option>
              <option value="workspace-write">工作区可写</option>
              <option value="workspace-write-network">工作区可写并联网</option>
            </select>
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
        <label>
          审批超时（秒）
          <input
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
        </label>
      </SettingsCard>

      <SettingsCard
        title="文件安全"
        description="白名单只降低审批频率；内置敏感目录始终优先保护。"
        icon={<FileLock2 size={16} />}
      >
        <label>
          自动放行路径（每行一项）
          <textarea
            rows={3}
            placeholder="例如：C:\\workspace\\shared-cache"
            value={rules.autoAllowPaths.join("\n")}
            onChange={(event) =>
              updateRules({ autoAllowPaths: splitLines(event.target.value) })
            }
          />
        </label>
        <label>
          强制审批路径（每行一项）
          <textarea
            rows={3}
            placeholder="例如：C:\\Users\\me\\Documents"
            value={rules.protectedPaths.join("\n")}
            onChange={(event) =>
              updateRules({ protectedPaths: splitLines(event.target.value) })
            }
          />
        </label>
        <div className="security-builtins" aria-label="内置保护路径">
          {BUILT_IN_PROTECTED_PATHS.map((path) => (
            <code key={path}>{path}</code>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard
        title="命令安全"
        description="按命令前缀匹配；强制审批规则优先于自动放行。"
        icon={<SquareTerminal size={16} />}
      >
        <label>
          放行命令（每行一项）
          <textarea
            rows={3}
            placeholder="例如：git status"
            value={rules.commandAllowlist.join("\n")}
            onChange={(event) =>
              updateRules({ commandAllowlist: splitLines(event.target.value) })
            }
          />
        </label>
        <label>
          询问命令（每行一项）
          <textarea
            rows={3}
            placeholder="例如：git push"
            value={rules.commandAsklist.join("\n")}
            onChange={(event) =>
              updateRules({ commandAsklist: splitLines(event.target.value) })
            }
          />
        </label>
      </SettingsCard>

      <SettingsCard
        title="网络安全"
        description="域名规则在沙箱联网许可之前检查，拒绝列表优先。"
        icon={<Globe2 size={16} />}
      >
        <label>
          默认网络策略
          <select
            value={rules.networkAccess}
            onChange={(event) =>
              updateRules({
                networkAccess: event.target
                  .value as AgentSettings["securityRules"]["networkAccess"],
              })
            }
          >
            <option value="ask">按请求审批</option>
            <option value="deny">阻断所有网络</option>
            <option value="allow">允许网络</option>
          </select>
        </label>
        <label>
          允许域名（每行一项）
          <textarea
            rows={3}
            placeholder="api.example.com"
            value={rules.allowedDomains.join("\n")}
            onChange={(event) =>
              updateRules({ allowedDomains: splitLines(event.target.value) })
            }
          />
        </label>
        <label>
          拒绝域名（每行一项）
          <textarea
            rows={3}
            placeholder="tracking.example.com"
            value={rules.deniedDomains.join("\n")}
            onChange={(event) =>
              updateRules({ deniedDomains: splitLines(event.target.value) })
            }
          />
        </label>
      </SettingsCard>

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
