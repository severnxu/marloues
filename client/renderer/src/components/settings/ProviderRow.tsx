import { PlugZap, RefreshCcw, Trash2 } from "lucide-react";
import type { ModelProviderConfig } from "@shared/types";
import { STRINGS } from "@shared/strings.zh";
import type { ProviderManagement } from "./use-provider-management";
import { SettingsCheckbox } from "./shared";

export function ProviderRow({
  provider,
  pm,
  canEdit,
}: {
  provider: ModelProviderConfig;
  pm: ProviderManagement;
  canEdit: boolean;
}) {
  const isChecking = pm.checkingEndpointIds.has(provider.id);

  return (
    <div className="provider-row">
      <div
        className="provider-row-head"
        role="button"
        tabIndex={0}
        aria-label={`配置 ${provider.name || "模型"}`}
        onClick={() => pm.openProviderDetail(provider.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            pm.openProviderDetail(provider.id);
          }
        }}
      >
        <div className="provider-row-title">
          <div>
            <strong>{provider.name || "未命名模型"}</strong>
          </div>
          <small>
            {provider.kind === "builtin"
              ? `内置供应商 · 自动适配运行时 · ${provider.models.length} 个模型`
              : `${provider.endpoints.length} 个端点 · ${
                  provider.models.length
                } 个模型（已启用 ${
                  provider.models.filter((model) => model.enabled).length
                } 个）`}
          </small>
        </div>
        <div
          className="settings-row-actions provider-actions"
          onClick={(event) => event.stopPropagation()}
        >
          <label
            className="settings-inline-check provider-enable-check"
            title={
              provider.enabled
                ? STRINGS.model.providerEnabledTitle
                : STRINGS.model.providerDisabledTitle
            }
          >
            <SettingsCheckbox
              checked={provider.enabled}
              disabled={provider.locked || !canEdit}
              onChange={(event) =>
                void pm.toggleProviderEnabled(provider.id, event.target.checked)
              }
            />
            启用
          </label>
          <button
            className="icon-button"
            disabled={isChecking}
            onClick={() => void pm.testEndpointProfile(provider.id)}
            title={isChecking ? "测试中" : "测试连接"}
          >
            {isChecking ? <RefreshCcw size={14} /> : <PlugZap size={14} />}
          </button>
          <button
            className="icon-button"
            disabled={provider.locked || !canEdit}
            onClick={() => void pm.removeEndpointProfile(provider.id)}
            title={
              provider.locked
                ? "企业预置供应商不可删除"
                : canEdit
                  ? "删除供应商"
                  : "企业策略禁止删除本地供应商"
            }
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
