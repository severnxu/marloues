import { useEffect, useState } from "react";
import { notify } from "@/lib/notifications";
import { useSettingsStore } from "@/stores/settings-store";
import { useThemeStore } from "@/stores/theme-store";
// Note: import from the sections barrel directly to avoid a circular dep
// (the parent `settings/index.ts` re-exports `SettingsWorkbench` itself).
import * as Sections from "@/components/settings/sections";
const {
  AppearanceSettings,
  GeneralSettings,
  PersonalizationSettings,
  AuditSettings,
  ImChannelsSettings,
  RuntimeSettings,
  UpdateSettings,
} = Sections;
import { statusToastTitle } from "@/components/settings";
import { ProviderSection } from "./ProviderSection";
import { useProviderManagement } from "./use-provider-management";
import type { CommitDraft, SetStatus } from "./use-provider-management";
import type { SettingsSection } from "./types";
import { isSecretEncryptionUnavailableError } from "@shared/types";
import { STRINGS } from "@shared/strings.zh";
import type { AgentSettings, AuditEventRecord } from "@shared/types";

export function SettingsWorkbench({ section }: { section: SettingsSection }) {
  const settings = useSettingsStore((state) => state.settings);
  const save = useSettingsStore((state) => state.save);
  const themeMode = useThemeStore((state) => state.mode);
  const setThemeMode = useThemeStore((state) => state.setMode);
  const accentColor = useThemeStore((state) => state.accentColor);
  const setAccentColor = useThemeStore((state) => state.setAccentColor);
  const resetAccentColor = useThemeStore((state) => state.resetAccentColor);
  const [draft, setDraft] = useState(settings);
  const [auditEvents, setAuditEvents] = useState<AuditEventRecord[]>([]);
  const [_status, setStatusState] = useState<{
    message: string;
    tone: "info" | "ok" | "error";
  } | null>(null);

  // ── setStatus / commitDraft (before early return, satisfy Rules of Hooks) ──

  const setStatus: SetStatus = (
    message: string,
    tone: "info" | "ok" | "error" = "info",
  ) => {
    setStatusState({ message, tone });
    notify({
      title: statusToastTitle(message, tone),
      description: message,
      tone: tone === "ok" ? "success" : tone,
    });
  };

  const commitDraft: CommitDraft = async (nextDraft, message, tone = "ok") => {
    setDraft(nextDraft);
    try {
      await save(nextDraft);
    } catch (error) {
      // 密钥无法加密时主进程拒绝落盘。回滚草稿到已持久化的设置，避免 UI 显示
      // 一份实际没保存成功的配置。
      setDraft(settings);
      if (isSecretEncryptionUnavailableError(error)) {
        notify({
          title: STRINGS.system.secretEncryption.unavailableTitle,
          description: STRINGS.system.secretEncryption.unavailableDescription,
          tone: "error",
        });
        return;
      }
      throw error;
    }
    if (message) setStatus(message, tone);
  };

  // ── Provider management hook (must be before early return) ──

  const pm = useProviderManagement(draft, setDraft, commitDraft, setStatus);

  // ── Effects ──

  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => {
    if (section === "audit") {
      void window.marloues.audit.list(100).then(setAuditEvents);
    }
  }, [section]);

  if (!draft) return <div className="settings-page">正在加载设置...</div>;

  // ── Derived state ──

  const enterprisePolicy = draft.enterprisePolicy ?? {};
  const enterpriseControlledSettings = new Set(
    draft.enterpriseControlledSettings ?? [],
  );
  const canEditEndpointProfiles =
    enterprisePolicy.allowLocalEndpointProfiles !== false;
  const canToggleSkills = enterprisePolicy.allowLocalSkillDisable !== false;
  const hasEnterpriseConfig =
    Boolean(draft.enterprisePolicy) || enterpriseControlledSettings.size > 0;
  const isPermissionTimeoutManaged = enterpriseControlledSettings.has(
    "permissionApprovalTimeoutMs",
  );

  return (
    <section
      className={`settings-page settings-section-${section} scrollbar-thin`}
    >
      <div className="settings-shell">
        <div className="settings-content">
          {hasEnterpriseConfig ? (
            <div className="settings-runtime-panel">
              <div>
                <strong>企业配置已启用</strong>
                <small>
                  {enterpriseControlledSettings.size > 0
                    ? `受控字段：${Array.from(enterpriseControlledSettings).join(", ")}`
                    : "当前只下发了策略限制"}
                </small>
              </div>
              <div className="settings-chip-row">
                {!canEditEndpointProfiles ? (
                  <span className="settings-chip">端点受限</span>
                ) : null}
                {!canToggleSkills ? (
                  <span className="settings-chip">Skills 受限</span>
                ) : null}
                {isPermissionTimeoutManaged ? (
                  <span className="settings-chip ok">审批超时受控</span>
                ) : null}
              </div>
            </div>
          ) : null}

          {section === "general" ? (
            <>
              <GeneralSettings
                desktopNotifications={draft.desktopNotificationsEnabled}
                outputStyle={draft.outputStyle ?? "default"}
                onDesktopNotificationsChange={() =>
                  void commitDraft(
                    {
                      ...draft,
                      desktopNotificationsEnabled:
                        !draft.desktopNotificationsEnabled,
                    },
                    draft.desktopNotificationsEnabled
                      ? "桌面通知已关闭。"
                      : "桌面通知已开启。",
                  )
                }
                onOutputStyleChange={(value) =>
                  void commitDraft(
                    { ...draft, outputStyle: value },
                    "输出风格已更新。",
                  )
                }
                onPreventSleepChange={() =>
                  void commitDraft(
                    { ...draft, preventSleep: !(draft.preventSleep ?? true) },
                    (draft.preventSleep ?? true)
                      ? "防止睡眠已关闭。"
                      : "防止睡眠已开启。",
                  )
                }
                preventSleep={draft.preventSleep ?? true}
              />
              <RuntimeSettings
                draft={draft}
                isPermissionTimeoutManaged={isPermissionTimeoutManaged}
                onCommitDraft={(nextDraft) => void commitDraft(nextDraft)}
              />
            </>
          ) : null}

          {section === "personalization" ? (
            <PersonalizationSettings
              customInstructions={draft.customInstructions ?? ""}
              onCustomInstructionsChange={(value) =>
                void commitDraft({ ...draft, customInstructions: value })
              }
            />
          ) : null}

          {section === "appearance" ? (
            <AppearanceSettings
              themeMode={themeMode}
              accentColor={accentColor}
              onResetAccentColor={resetAccentColor}
              onSetAccentColor={setAccentColor}
              onSetThemeMode={setThemeMode}
            />
          ) : null}

          {section === "providers" ? (
            <ProviderSection
              draft={draft}
              canEdit={canEditEndpointProfiles}
              pm={pm}
            />
          ) : null}

          {section === "audit" ? (
            <AuditSettings
              auditEvents={auditEvents}
              onAuditEventsChange={setAuditEvents}
              onStatus={setStatus}
            />
          ) : null}

          {section === "im-channels" ? (
            <ImChannelsSettings
              draft={draft}
              onCommitDraft={(nextDraft: AgentSettings) =>
                commitDraft(nextDraft)
              }
            />
          ) : null}

          {section === "version" ? <UpdateSettings /> : null}
        </div>
      </div>
    </section>
  );
}
