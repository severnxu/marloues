import { useEffect, useState } from "react";
import {
  Bell,
  Check,
  Code2,
  Laptop,
  Moon,
  Palette,
  Pencil,
  Pipette,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Sun,
} from "lucide-react";
import {
  DEFAULT_ACCENT_COLOR,
  getThemeDefinitions,
  hslToHex,
  type ThemeMode,
} from "@/stores/theme-store";
import {
  SegmentedOptions,
  SettingRow,
  SettingsCard,
  ToggleSwitch,
} from "@/components/settings";

export function AppearanceSettings({
  themeMode,
  accentColor,
  onResetAccentColor,
  onSetAccentColor,
  onSetThemeMode,
}: {
  themeMode: ThemeMode;
  accentColor: string | null;
  onResetAccentColor: () => void;
  onSetAccentColor: (color: string) => void;
  onSetThemeMode: (mode: ThemeMode) => void;
}) {
  const themeDefinitions = getThemeDefinitions();
  const themeAccentCss =
    typeof document === "undefined"
      ? DEFAULT_ACCENT_COLOR
      : getComputedStyle(document.documentElement)
          .getPropertyValue("--accent")
          .trim() || DEFAULT_ACCENT_COLOR;
  const themeAccent = hslToHex(themeAccentCss) ?? DEFAULT_ACCENT_COLOR;
  const shownAccent = accentColor ?? themeAccent;
  const isCustomAccent = Boolean(accentColor);
  const [accentDraft, setAccentDraft] = useState(accentColor ?? "");

  useEffect(() => {
    setAccentDraft(accentColor ?? "");
  }, [accentColor]);

  return (
    <div className="appearance-settings">
      <SettingsCard
        title="基础主题"
        description="在浅色和深色界面之间切换。"
        icon={<Sun size={16} />}
        surface="plain"
      >
        <SegmentedOptions
          value={themeMode}
          onChange={(value) => {
            if (value === "system") {
              onSetThemeMode("system");
              return;
            }
            onSetThemeMode(value as ThemeMode);
          }}
          options={[
            {
              value: "system",
              title: "System",
              description: "跟随系统外观自动切换。",
              icon: <Laptop size={15} />,
            },
            ...themeDefinitions.map((theme) => ({
              value: theme.mode,
              title: theme.label,
              description:
                theme.mode === "warm"
                  ? "柔和纸感，适合长时间阅读。"
                  : theme.colorScheme === "light"
                    ? "适合明亮环境。"
                    : "适合长时间使用与低光环境。",
              icon:
                theme.mode === "warm" ? (
                  <Sparkles size={15} />
                ) : theme.colorScheme === "light" ? (
                  <Sun size={15} />
                ) : (
                  <Moon size={15} />
                ),
            })),
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
            <span
              className="appearance-accent-swatch"
              style={{ background: shownAccent }}
            />
            <div>
              <strong>{isCustomAccent ? "当前强调色" : "主题默认色"}</strong>
              <small>
                {isCustomAccent
                  ? shownAccent.toUpperCase()
                  : shownAccent.toUpperCase()}
              </small>
            </div>
            <button
              className="appearance-accent-reset"
              onClick={onResetAccentColor}
              type="button"
              title="恢复默认强调色"
              aria-label="恢复默认强调色"
            >
              <RotateCcw size={14} />
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
              <input
                type="color"
                value={shownAccent}
                onChange={(event) => onSetAccentColor(event.target.value)}
              />
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
  outputStyle,
  onDesktopNotificationsChange,
  onOutputStyleChange,
  onPreventSleepChange,
  preventSleep,
}: {
  desktopNotifications: boolean;
  outputStyle: "default" | "coding" | "explanatory";
  onDesktopNotificationsChange: () => void;
  onOutputStyleChange: (value: "default" | "coding" | "explanatory") => void;
  onPreventSleepChange: () => void;
  preventSleep: boolean;
}) {
  return (
    <div className="appearance-settings">
      <SettingsCard
        title="运行"
        description="控制任务运行时的桌面行为。"
        icon={<ShieldCheck size={16} />}
      >
        <SettingRow
          icon={<Moon size={16} />}
          title="运行任务时防止睡眠"
          description="长任务执行时保持电脑唤醒。"
          trailing={
            <ToggleSwitch
              checked={preventSleep}
              onChange={onPreventSleepChange}
            />
          }
        />
        <SettingRow
          icon={<Bell size={16} />}
          title="桌面通知"
          description="任务完成或需要确认时提醒你。"
          trailing={
            <ToggleSwitch
              checked={desktopNotifications}
              onChange={onDesktopNotificationsChange}
            />
          }
        />
      </SettingsCard>

      <SettingsCard
        title="输出风格"
        description="决定 Marloues 回复的详细程度与风格。"
        icon={<Code2 size={16} />}
        surface="plain"
      >
        <SegmentedOptions
          value={outputStyle}
          onChange={(value) =>
            onOutputStyleChange(value as "default" | "coding" | "explanatory")
          }
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
              description: "聚焦代码，精简解释，注重正确性。",
              icon: <Code2 size={15} />,
            },
            {
              value: "explanatory",
              title: "Explanatory",
              description: "附带实现选择与模式的教学性解释。",
              icon: <Sparkles size={15} />,
            },
          ]}
        />
      </SettingsCard>
    </div>
  );
}

export function PersonalizationSettings({
  customInstructions,
  onCustomInstructionsChange,
}: {
  customInstructions: string;
  onCustomInstructionsChange: (value: string) => void;
}) {
  return (
    <div className="appearance-settings">
      <SettingsCard
        title="自定义指令"
        description="这些偏好会附加到系统提示词，塑造后续任务的默认沟通方式。"
        icon={<Pencil size={16} />}
        surface="plain"
      >
        <textarea
          aria-label="自定义指令"
          className="settings-large-textarea"
          value={customInstructions}
          onChange={(event) => onCustomInstructionsChange(event.target.value)}
        />
      </SettingsCard>
    </div>
  );
}
