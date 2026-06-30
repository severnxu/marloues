import { useEffect, useState } from "react";
import { Bell, Bot, Check, Code2, Laptop, Moon, Palette, Pencil, Pipette, ShieldCheck, Sparkles, Sun } from "lucide-react";
import { WARM_ACCENT_COLOR, DEFAULT_ACCENT_COLOR, type ThemeMode } from "@/stores/theme-store";
import { SegmentedOptions, SettingRow, SettingsCard, ToggleSwitch } from "@/components/settings/shared";

export function AppearanceSettings({
  themeMode,
  accentColor,
  onResetAccentColor,
  onSetAccentColor,
  onSetDark,
  onSetThemeMode,
}: {
  themeMode: ThemeMode;
  accentColor: string | null;
  onResetAccentColor: () => void;
  onSetAccentColor: (color: string) => void;
  onSetDark: (dark: boolean) => void;
  onSetThemeMode: (mode: ThemeMode) => void;
}) {
  const shownAccent = accentColor ?? (themeMode === "warm" ? WARM_ACCENT_COLOR : DEFAULT_ACCENT_COLOR);
  const isCustomAccent = Boolean(accentColor);
  const [accentDraft, setAccentDraft] = useState(accentColor ?? "");

  useEffect(() => {
    setAccentDraft(accentColor ?? "");
  }, [accentColor]);

  return (
    <div className="appearance-settings">
      <SettingsCard title="基础主题" description="在浅色和深色界面之间切换。" icon={<Sun size={16} />}>
        <SegmentedOptions
          value={themeMode}
          onChange={(value) => {
            if (value === "system") {
              onSetThemeMode("system");
              return;
            }
            if (value === "light" || value === "dark") {
              onSetDark(value === "dark");
              return;
            }
            onSetThemeMode(value as ThemeMode);
          }}
          options={[
            { value: "system", title: "System", description: "跟随系统外观自动切换。", icon: <Laptop size={15} /> },
            { value: "light", title: "Light", description: "更适合明亮环境。", icon: <Sun size={15} /> },
            { value: "dark", title: "Dark", description: "降低长时间使用的视觉压力。", icon: <Moon size={15} /> },
            {
              value: "warm",
              title: "Warm",
              description: "纸感米色，适合长时间阅读与低蓝光场景。",
              icon: <Sparkles size={15} />,
            },
          ]}
        />
      </SettingsCard>

      <SettingsCard
        title="强调色"
        description="默认是 personal-claw 使用的蓝色，也可以自定义并随时恢复。"
        icon={<Palette size={16} />}
      >
        <div className="appearance-accent-panel">
          <div className="appearance-accent-current">
            <span className="appearance-accent-swatch" style={{ background: shownAccent }} />
            <div>
              <strong>{isCustomAccent ? "当前强调色" : themeMode === "warm" ? "深紫品牌色" : "默认蓝色"}</strong>
              <small>
                {isCustomAccent
                  ? shownAccent.toUpperCase()
                  : themeMode === "warm"
                    ? WARM_ACCENT_COLOR.toUpperCase()
                    : "默认蓝色"}
              </small>
            </div>
            <button onClick={onResetAccentColor} type="button">
              恢复默认
            </button>
          </div>

          <div className="appearance-accent-controls">
            <label>
              自定义颜色
              <input
                value={accentDraft}
                onChange={(event) => {
                  const value = event.target.value.trim();
                  setAccentDraft(event.target.value);
                  if (!value) {
                    onResetAccentColor();
                    return;
                  }
                  onSetAccentColor(value);
                }}
                placeholder={DEFAULT_ACCENT_COLOR}
              />
            </label>
            <label className="appearance-color-picker" title="选择强调色">
              <input type="color" value={shownAccent} onChange={(event) => onSetAccentColor(event.target.value)} />
              <Pipette size={16} />
            </label>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}

export function GeneralSettings({
  desktopNotifications,
  detailLevel,
  onDesktopNotificationsChange,
  onDetailLevelChange,
  onPreventSleepChange,
  preventSleep,
}: {
  desktopNotifications: boolean;
  detailLevel: "default" | "coding";
  onDesktopNotificationsChange: () => void;
  onDetailLevelChange: (value: "default" | "coding") => void;
  onPreventSleepChange: () => void;
  preventSleep: boolean;
}) {
  return (
    <div className="appearance-settings">
      <SettingsCard title="运行" description="控制任务运行时的桌面行为。" icon={<ShieldCheck size={16} />}>
        <SettingRow
          icon={<Moon size={16} />}
          title="运行任务时防止睡眠"
          description="长任务执行时保持电脑唤醒。"
          trailing={<ToggleSwitch checked={preventSleep} onChange={onPreventSleepChange} />}
        />
        <SettingRow
          icon={<Bell size={16} />}
          title="桌面通知"
          description="任务完成或需要确认时提醒你。"
          trailing={<ToggleSwitch checked={desktopNotifications} onChange={onDesktopNotificationsChange} />}
        />
      </SettingsCard>

      <SettingsCard title="细节级别" description="决定 Marloues 工作时展示多少过程信息。" icon={<Code2 size={16} />}>
        <SegmentedOptions
          value={detailLevel}
          onChange={(value) => onDetailLevelChange(value as "default" | "coding")}
          options={[
            {
              value: "default",
              title: "Default",
              description: "展示关键进度，保持对话清爽。",
              icon: <Check size={15} />,
            },
            {
              value: "coding",
              title: "Coding",
              description: "显示更具体的命令和执行细节。",
              icon: <Code2 size={15} />,
            },
          ]}
        />
      </SettingsCard>
    </div>
  );
}

export function PersonalizationSettings({
  customInstructions,
  friendlyTone,
  onCustomInstructionsChange,
  onFriendlyToneChange,
}: {
  customInstructions: string;
  friendlyTone: boolean;
  onCustomInstructionsChange: (value: string) => void;
  onFriendlyToneChange: () => void;
}) {
  return (
    <div className="appearance-settings">
      <SettingsCard title="回复风格" description="让助手的语气更贴近你的偏好。" icon={<Bot size={16} />}>
        <SettingRow
          icon={<Bot size={16} />}
          title="友好语气"
          description="开启后会更自然地解释取舍和下一步。"
          trailing={<ToggleSwitch checked={friendlyTone} onChange={onFriendlyToneChange} />}
        />
      </SettingsCard>

      <SettingsCard
        title="自定义指令"
        description="这些偏好会用于塑造后续任务的默认沟通方式。"
        icon={<Pencil size={16} />}
      >
        <textarea
          className="settings-large-textarea"
          value={customInstructions}
          onChange={(event) => onCustomInstructionsChange(event.target.value)}
        />
      </SettingsCard>
    </div>
  );
}
