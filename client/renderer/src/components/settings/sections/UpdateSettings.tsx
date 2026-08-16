import { useEffect } from "react";
import {
  Download,
  KeyRound,
  RefreshCw,
  Rocket,
  RotateCw,
  ShieldCheck,
} from "lucide-react";
import type {
  AppVersionInfo,
  UpdateChannel,
  UpdatePreferences,
  UpdateState,
} from "@shared/hot-update";
import { useUpdateStore } from "@/stores/update-store";
import {
  SegmentedOptions,
  SettingRow,
  SettingsCard,
  ToggleSwitch,
} from "@/components/settings";
import { VersionSettingsView } from "./VersionSettings";

/**
 * 版本与热更新管理页：
 * - 版本信息（客户端 / UI）
 * - 更新状态（检查 / 下载 / 安装，进度与错误）
 * - 更新通道（stable / beta / nightly）
 * - 自动化偏好（自动检查 / 自动下载 / 自动应用 UI）
 * - 签名信任状态
 *
 * 状态与动作全部来自 useUpdateStore，与侧边栏更新徽章共享同一条生命周期。
 */
export function UpdateSettings() {
  const state =
    useUpdateStore((s) => s.state) ?? ({ status: "idle" } as UpdateState);
  const versionInfo = useUpdateStore((s) => s.versionInfo);
  const preferences = useUpdateStore((s) => s.preferences);
  const isChecking = useUpdateStore((s) => s.isChecking);
  const isDownloading = useUpdateStore((s) => s.isDownloading);
  const load = useUpdateStore((s) => s.load);
  const check = useUpdateStore((s) => s.check);
  const download = useUpdateStore((s) => s.download);
  const installNow = useUpdateStore((s) => s.installNow);
  const savePreferences = useUpdateStore((s) => s.savePreferences);
  const ignoreVersion = useUpdateStore((s) => s.ignoreVersion);

  useEffect(() => {
    void load();
  }, [load]);

  const busy = isChecking || isDownloading;

  const updatePreferences = (
    mutate: (prefs: UpdatePreferences) => UpdatePreferences,
  ) => {
    if (!preferences) return;
    void savePreferences(mutate(preferences));
  };

  const primaryAction = (() => {
    if (state.status === "available") {
      return {
        label: "下载更新",
        icon: <Download size={14} />,
        run: () => void download(),
      };
    }
    if (state.status === "ready") {
      return {
        label:
          state.applyMode === "reload-ui" ? "应用并刷新界面" : "安装并重启",
        icon: <RotateCw size={14} />,
        run: () => void installNow(),
      };
    }
    return {
      label: isChecking ? "正在检查" : "检查更新",
      icon: <RefreshCw size={14} />,
      run: () => void check(),
    };
  })();

  return (
    <div className="update-settings">
      <VersionSettingsView versionInfo={versionInfo} loadFailed={false} />

      <SettingsCard
        title="更新状态"
        description={statusDescription(state, versionInfo)}
        icon={<Rocket size={16} />}
        action={
          <div className="settings-row-actions">
            {state.status === "available" && state.version ? (
              <button
                disabled={busy}
                onClick={() => void ignoreVersion(state.version!)}
                type="button"
              >
                忽略此版本
              </button>
            ) : null}
            <button
              disabled={
                busy ||
                state.status === "checking" ||
                state.status === "downloading" ||
                !versionInfo?.packaged
              }
              onClick={primaryAction.run}
              type="button"
            >
              {primaryAction.icon}
              {primaryAction.label}
            </button>
          </div>
        }
      >
        <div className="update-status-panel" data-status={state.status}>
          <strong>{statusTitle(state)}</strong>
          <small>
            {state.version
              ? `目标版本 ${state.version}`
              : "当前没有待处理的更新"}
          </small>
          {state.progress ? (
            <div className="update-progress">
              <span style={{ width: `${state.progress.percent}%` }} />
              <small>
                {state.progress.percent}% ·{" "}
                {formatBytes(state.progress.transferred)} /{" "}
                {formatBytes(state.progress.total)}
              </small>
            </div>
          ) : null}
          {state.releaseNotes ? <p>{state.releaseNotes}</p> : null}
          {state.error ? <p className="update-error">{state.error}</p> : null}
        </div>
      </SettingsCard>

      <SettingsCard
        title="更新通道"
        description="稳定版适合日常使用；测试版和每夜版由用户主动选择。"
        icon={<RefreshCw size={16} />}
      >
        <SegmentedOptions
          value={preferences?.channel ?? "stable"}
          onChange={(value) =>
            updatePreferences((prefs) => ({
              ...prefs,
              channel: value as UpdateChannel,
              ignoredVersion: undefined,
            }))
          }
          options={[
            {
              value: "stable",
              title: "稳定版",
              description: "经过验证的正式版本",
              icon: <ShieldCheck size={15} />,
            },
            {
              value: "beta",
              title: "测试版",
              description: "提前体验即将发布的功能",
              icon: <Rocket size={15} />,
            },
            {
              value: "nightly",
              title: "每夜版",
              description: "跟随最新开发进度",
              icon: <RefreshCw size={15} />,
            },
          ]}
        />
      </SettingsCard>

      <SettingsCard
        title="自动化"
        description="自动下载不会自动安装完整客户端；客户端安装始终需要确认。"
        icon={<Download size={16} />}
      >
        <SettingRow
          icon={<RefreshCw size={16} />}
          title="自动检查更新"
          description="启动时检查，并每 30 分钟重新检查一次。"
          trailing={
            <ToggleSwitch
              checked={preferences?.autoCheck ?? false}
              disabled={!preferences}
              onChange={() =>
                updatePreferences((prefs) => ({
                  ...prefs,
                  autoCheck: !prefs.autoCheck,
                }))
              }
            />
          }
        />
        <SettingRow
          icon={<Download size={16} />}
          title="自动下载"
          description="发现更新后在后台下载，应用时仍会显示确认操作。"
          trailing={
            <ToggleSwitch
              checked={preferences?.autoDownload ?? false}
              disabled={!preferences}
              onChange={() =>
                updatePreferences((prefs) => ({
                  ...prefs,
                  autoDownload: !prefs.autoDownload,
                  autoApplyUi: prefs.autoDownload ? false : prefs.autoApplyUi,
                }))
              }
            />
          }
        />
        <SettingRow
          icon={<RotateCw size={16} />}
          title="自动应用界面更新"
          description="仅刷新 UI，不自动安装或重启完整客户端。"
          trailing={
            <ToggleSwitch
              checked={preferences?.autoApplyUi ?? false}
              disabled={!preferences || !preferences.autoDownload}
              onChange={() =>
                updatePreferences((prefs) => ({
                  ...prefs,
                  autoApplyUi: !prefs.autoApplyUi,
                }))
              }
            />
          }
        />
      </SettingsCard>

      <SettingsCard
        title="签名信任"
        description="Marloues 只会安装由内置 Ed25519 公钥签名的界面包。"
        icon={<KeyRound size={16} />}
      >
        <SettingRow
          icon={<ShieldCheck size={16} />}
          title="UI 热更新"
          description={
            versionInfo?.hotUpdateConfigured
              ? `已配置可信密钥：${versionInfo.trustedKeyIds.join(", ")}`
              : "当前构建未配置热更新地址或可信公钥。"
          }
          trailing={
            <span
              className={`settings-chip ${versionInfo?.hotUpdateConfigured ? "ok" : ""}`}
            >
              {versionInfo?.hotUpdateConfigured ? "已启用" : "未配置"}
            </span>
          }
        />
      </SettingsCard>
    </div>
  );
}

function statusTitle(state: UpdateState): string {
  if (state.status === "checking") return "正在检查更新";
  if (state.status === "available") return "发现可用更新";
  if (state.status === "downloading") return "正在下载更新";
  if (state.status === "ready") return "更新已准备就绪";
  if (state.status === "error") return "更新检查失败";
  return "暂无待处理更新";
}

function statusDescription(
  state: UpdateState,
  versionInfo: AppVersionInfo | null,
): string {
  if (!versionInfo?.packaged)
    return "开发模式使用 Vite HMR；在线更新仅在打包版本中启用。";
  if (state.updateKind === "ui")
    return "这是界面更新，应用后无需重启完整客户端。";
  if (state.updateKind === "client")
    return "这是完整客户端更新，安装时需要重启 Marloues。";
  if (state.lastCheckedAt)
    return `上次检查：${new Date(state.lastCheckedAt).toLocaleString()}`;
  return "检查完整客户端和独立 UI 包的最新版本。";
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
