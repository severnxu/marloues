import { ShieldCheck } from "lucide-react";
import { SettingsCard } from "@/components/settings";
import type { AgentSettings } from "@shared/types";
import { splitLines } from "./skill-audit-helpers";

export function RuntimeSettings({
  draft,
  isPermissionTimeoutManaged,
  onCommitDraft,
}: {
  draft: AgentSettings;
  isPermissionTimeoutManaged: boolean;
  onCommitDraft: (nextDraft: AgentSettings) => void;
}) {
  const policy = draft.toolPermissionPolicy;
  const sensitiveToolAllowlist = policy?.sensitiveToolAllowlist ?? [
    "Read",
    "Glob",
    "Grep",
    "LS",
    "TodoWrite",
  ];

  return (
    <SettingsCard
      title="运行限制"
      description="让长任务保持可控，并方便检查执行过程。"
      icon={<ShieldCheck size={16} />}
    >
      <label>
        权限模式
        <select
          value={draft.permissionMode}
          onChange={(event) =>
            onCommitDraft({
              ...draft,
              permissionMode: event.target.value as typeof draft.permissionMode,
            })
          }
        >
          <option value="default">请求批准</option>
          <option value="acceptEdits">自动批准编辑</option>
          <option value="bypassPermissions">免审批（仍受沙箱限制）</option>
        </select>
      </label>
      <label>
        沙箱模式
        <select
          value={draft.sandboxMode ?? "workspace-write"}
          onChange={(event) => {
            const sandboxMode = event.target.value as NonNullable<
              AgentSettings["sandboxMode"]
            >;
            onCommitDraft({
              ...draft,
              sandboxEnabled: sandboxMode !== "danger-full-access",
              sandboxMode,
            });
          }}
        >
          <option value="read-only">只读</option>
          <option value="workspace-write">工作区可写</option>
          <option value="workspace-write-network">工作区可写并允许网络</option>
          <option value="danger-full-access">关闭沙箱</option>
        </select>
      </label>
      <label>
        最大轮次
        <input
          type="number"
          value={draft.maxTurns}
          onChange={(event) =>
            onCommitDraft({
              ...draft,
              maxTurns: Number(event.target.value) || 50,
            })
          }
        />
      </label>
      <label>
        审批超时（秒）
        <input
          type="number"
          min={10}
          max={3600}
          disabled={isPermissionTimeoutManaged}
          title={
            isPermissionTimeoutManaged
              ? "由企业配置管理"
              : "设置敏感工具审批自动拒绝时间"
          }
          value={Math.round(
            (draft.permissionApprovalTimeoutMs ?? 120_000) / 1000,
          )}
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
      <label>
        最大思考 Token
        <input
          type="number"
          value={draft.maxThinkingTokens}
          onChange={(event) =>
            onCommitDraft({
              ...draft,
              maxThinkingTokens: Number(event.target.value) || 0,
            })
          }
        />
      </label>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={draft.thinkingEnabled}
          onChange={(event) =>
            onCommitDraft({ ...draft, thinkingEnabled: event.target.checked })
          }
        />
        启用思考
      </label>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={policy?.requireConfirmationForSensitiveTools ?? true}
          onChange={(event) =>
            onCommitDraft({
              ...draft,
              toolPermissionPolicy: {
                ...policy,
                sensitiveToolAllowlist,
                requireConfirmationForSensitiveTools: event.target.checked,
              },
            })
          }
        />
        敏感工具需要确认
      </label>
      <label>
        敏感工具白名单
        <textarea
          value={sensitiveToolAllowlist.join("\n")}
          onChange={(event) =>
            onCommitDraft({
              ...draft,
              toolPermissionPolicy: {
                ...policy,
                requireConfirmationForSensitiveTools:
                  policy?.requireConfirmationForSensitiveTools ?? true,
                sensitiveToolAllowlist: splitLines(event.target.value),
              },
            })
          }
        />
      </label>
      <label>
        allowedTools
        <textarea readOnly value={(policy?.allowedTools ?? []).join("\n")} />
      </label>
      <label>
        disallowedTools
        <textarea readOnly value={(policy?.disallowedTools ?? []).join("\n")} />
      </label>
    </SettingsCard>
  );
}
