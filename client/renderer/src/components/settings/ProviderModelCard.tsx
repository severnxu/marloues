import { Check, PlugZap, Power, RefreshCcw, Trash2 } from "lucide-react";
import type { ModelOption, ModelProviderConfig } from "@shared/types";
import { STRINGS } from "@shared/strings.zh";

export function ProviderModelCard({
  model,
  provider,
  isDefault,
  canEdit,
  isChecking,
  onSetDefault,
  onToggleEnabled,
  onTest,
  onRemove,
  onUpdate,
}: {
  model: ModelOption;
  provider: ModelProviderConfig;
  isDefault: boolean;
  canEdit: boolean;
  isChecking: boolean;
  onSetDefault: () => void;
  onToggleEnabled: () => void;
  onTest: () => void;
  onRemove: () => void;
  onUpdate: (patch: Partial<ModelOption>) => void;
}) {
  const modelTitle = model.label || model.id || "未命名模型";

  return (
    <div
      className={`provider-model-card ${model.enabled ? "" : "disabled"}`}
      key={model.id}
    >
      <div className="provider-model-main">
        <div className="provider-model-title-line">
          <strong title={model.id || modelTitle}>{modelTitle}</strong>
          <span
            className={
              isDefault ? "default" : model.enabled ? "enabled" : "disabled"
            }
          >
            {isDefault ? "默认" : model.enabled ? "启用" : "停用"}
          </span>
        </div>
        <div className="provider-model-config-grid">
          <label>
            上下文窗口
            <input
              type="number"
              min={1}
              step={1000}
              disabled={provider.locked || !canEdit}
              value={model.contextWindowTokens ?? ""}
              onChange={(event) =>
                onUpdate({
                  contextWindowTokens: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                })
              }
              placeholder="例如 1000000"
            />
          </label>
          <label>
            最大输出标记数
            <input
              type="number"
              min={1}
              step={1000}
              disabled={provider.locked || !canEdit}
              value={model.maxOutputTokens ?? ""}
              onChange={(event) =>
                onUpdate({
                  maxOutputTokens: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                })
              }
              placeholder="例如 384000"
            />
          </label>
          <label className="settings-inline-check">
            <input
              type="checkbox"
              checked={Boolean(model.supportsVision)}
              disabled={provider.locked || !canEdit}
              onChange={(event) =>
                onUpdate({ supportsVision: event.target.checked })
              }
            />
            视觉
          </label>
          <label className="settings-inline-check">
            <input
              type="checkbox"
              checked={Boolean(model.supportsThinking)}
              disabled={provider.locked || !canEdit}
              onChange={(event) =>
                onUpdate({ supportsThinking: event.target.checked })
              }
            />
            思考中
          </label>
        </div>
      </div>
      <div
        className={`settings-row-actions provider-model-actions ${isChecking ? "visible" : ""}`}
      >
        <button
          className="icon-button"
          disabled={!provider.enabled || !model.enabled || isDefault}
          onClick={onSetDefault}
          title={
            isDefault
              ? STRINGS.model.alreadyDefaultButtonTitle
              : STRINGS.model.setDefaultButtonTitle
          }
        >
          <Check size={13} />
        </button>
        <button
          className="icon-button"
          disabled={provider.locked || !canEdit}
          onClick={onToggleEnabled}
          title={
            model.enabled && isDefault
              ? "默认模型不能直接禁用，请先切换默认模型"
              : model.enabled
                ? "禁用模型"
                : "启用模型"
          }
        >
          {model.enabled ? <Power size={13} /> : <Check size={13} />}
        </button>
        <button
          className="icon-button"
          disabled={isChecking}
          onClick={onTest}
          title={isChecking ? "探测中" : "发送探测消息"}
        >
          {isChecking ? <RefreshCcw size={13} /> : <PlugZap size={13} />}
        </button>
        <button
          className="icon-button"
          disabled={provider.locked || !canEdit}
          onClick={onRemove}
          title="删除模型"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
