import { useEffect, useState } from "react";
import { Info, MonitorCog, Package } from "lucide-react";
import { SettingRow, SettingsCard } from "@/components/settings";
import type { AppVersionInfo } from "@shared/hot-update";
import { STRINGS } from "@shared/strings.zh";

export function VersionSettings() {
  const [versionInfo, setVersionInfo] = useState<AppVersionInfo | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void window.marloues.app
      .getVersionInfo()
      .then((info) => {
        if (!cancelled) setVersionInfo(info);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <VersionSettingsView versionInfo={versionInfo} loadFailed={loadFailed} />
  );
}

export function VersionSettingsView({
  versionInfo,
  loadFailed = false,
}: {
  versionInfo: AppVersionInfo | null;
  loadFailed?: boolean;
}) {
  const renderVersion = (version?: string) => {
    if (loadFailed) return STRINGS.system.version.loadFailed;
    if (!versionInfo) return "读取中...";
    return version ? `v${version}` : "未知";
  };

  return (
    <SettingsCard
      title="版本信息"
      description="当前客户端与界面版本"
      icon={<Info size={16} />}
    >
      <SettingRow
        title="客户端"
        description="Marloues 主程序"
        icon={<Package size={16} />}
        trailing={
          <span className="settings-version-value">
            {renderVersion(versionInfo?.clientVersion)}
          </span>
        }
      />
      <SettingRow
        title="UI"
        description="界面资源"
        icon={<MonitorCog size={16} />}
        trailing={
          <span className="settings-version-value">
            {renderVersion(versionInfo?.uiVersion)}
          </span>
        }
      />
    </SettingsCard>
  );
}
