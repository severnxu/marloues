import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  PlugZap,
  Plus,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import type { ModelProviderConfig, ModelSelection } from "@shared/types";
import { STRINGS } from "@shared/strings.zh";
import { ProviderModelCard } from "./ProviderModelCard";
import type { ProviderManagement } from "./use-provider-management";

export function ProviderRow({
  provider,
  pm,
  canEdit,
  defaultModel,
}: {
  provider: ModelProviderConfig;
  pm: ProviderManagement;
  canEdit: boolean;
  defaultModel: ModelSelection;
}) {
  const {
    expandedProviderIds,
    visibleApiKeyProviderIds,
    newProviderId,
    modelImportDraft,
    manualModelDraft,
    manualModelRef,
    providerEditRef,
    checkingEndpointIds,
    checkingModelIds,
    fetchingModelIds,
  } = pm;

  const isExpanded = expandedProviderIds.has(provider.id);
  const isNew = newProviderId === provider.id;
  const isApiKeyVisible = visibleApiKeyProviderIds.has(provider.id);
  const isCheckingEndpoint = checkingEndpointIds.has(provider.id);
  const isFetchingModels = fetchingModelIds.has(provider.id);

  return (
    <div
      className="provider-row"
      key={provider.id}
      ref={isNew ? providerEditRef : null}
    >
      <div className="provider-row-head">
        <button
          className="provider-expand-button"
          onClick={() => pm.toggleProviderExpanded(provider.id)}
          title={isExpanded ? "收起模型" : "展开模型"}
        >
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <div className="provider-row-title">
          <div>
            <strong>{provider.name || "未命名模型"}</strong>
          </div>
          <small>
            {provider.models.length === 0
              ? "暂无模型"
              : `${provider.models.length} 个模型（已启用 ${provider.models.filter((model) => model.enabled).length} 个）`}
          </small>
        </div>
        <div className="settings-row-actions provider-actions">
          <label
            className="settings-inline-check provider-enable-check"
            title={
              provider.enabled
                ? STRINGS.model.providerEnabledTitle
                : STRINGS.model.providerDisabledTitle
            }
          >
            <input
              type="checkbox"
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
            disabled={isCheckingEndpoint}
            onClick={() => void pm.testEndpointProfile(provider.id)}
            title={isCheckingEndpoint ? "测试中" : "测试连接"}
          >
            {isCheckingEndpoint ? (
              <RefreshCcw size={14} />
            ) : (
              <PlugZap size={14} />
            )}
          </button>
          <button
            className="icon-button"
            disabled={provider.locked || !canEdit}
            onClick={() => void pm.removeEndpointProfile(provider.id)}
            title={
              provider.locked
                ? "企业预置端点配置不可删除"
                : canEdit
                  ? "删除端点配置"
                  : "企业策略禁止删除本地端点配置"
            }
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {isExpanded ? (
        <div className={`provider-row-body ${isNew ? "draft" : ""}`}>
          {/* ── Provider fields grid ── */}
          <div className="provider-fields-grid">
            <label>
              Profile 名称
              <input
                value={provider.name}
                disabled={provider.locked || !canEdit}
                onChange={(event) =>
                  pm.updateProviderField(
                    provider.id,
                    "name",
                    event.target.value,
                  )
                }
                placeholder="Profile 名称"
              />
            </label>
            <label>
              Base URL
              <input
                value={provider.baseUrl ?? ""}
                disabled={provider.locked || !canEdit}
                onChange={(event) =>
                  pm.updateProviderField(
                    provider.id,
                    "baseUrl",
                    event.target.value,
                  )
                }
                placeholder="Base URL"
              />
            </label>
            <label>
              API Key
              <div className="api-key-input-wrap">
                <input
                  type={isApiKeyVisible ? "text" : "password"}
                  value={provider.apiKey ?? ""}
                  disabled={provider.locked || !canEdit}
                  onChange={(event) =>
                    pm.updateProviderField(
                      provider.id,
                      "apiKey",
                      event.target.value,
                    )
                  }
                  placeholder="sk-..."
                />
                <button
                  className="icon-button api-key-visibility-button"
                  disabled={provider.locked || !canEdit}
                  onClick={() => pm.toggleApiKeyVisible(provider.id)}
                  title={isApiKeyVisible ? "隐藏 API 密钥" : "查看 API 密钥"}
                  type="button"
                >
                  {isApiKeyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>
          </div>

          {/* ── Model section ── */}
          <div className="provider-model-section">
            <div className="provider-model-section-head">
              <span>模型</span>
              <div className="settings-row-actions">
                <button
                  disabled={isFetchingModels || provider.locked || !canEdit}
                  onClick={() => void pm.fetchProviderModels(provider.id)}
                >
                  {isFetchingModels ? (
                    <RefreshCcw size={14} />
                  ) : (
                    <Bot size={14} />
                  )}
                  {isFetchingModels ? "获取中" : "获取模型"}
                </button>
                <button
                  disabled={provider.locked || !canEdit}
                  onClick={() =>
                    pm.setManualModelDraft({
                      providerId: provider.id,
                      modelId: "",
                    })
                  }
                >
                  <Plus size={14} />
                  手动添加
                </button>
              </div>
            </div>

            {/* ── Manual model draft ── */}
            {manualModelDraft?.providerId === provider.id ? (
              <div className="provider-model-manual" ref={manualModelRef}>
                <input
                  autoFocus
                  value={manualModelDraft.modelId}
                  onChange={(event) =>
                    pm.setManualModelDraft({
                      providerId: provider.id,
                      modelId: event.target.value,
                    })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void pm.applyManualModel();
                    if (event.key === "Escape") pm.setManualModelDraft(null);
                  }}
                  placeholder="输入模型 ID，例如 MiniMax-M2.7-highspeed"
                />
                <div className="settings-row-actions provider-model-import-actions">
                  <button onClick={() => pm.setManualModelDraft(null)}>
                    取消
                  </button>
                  <button
                    className="primary"
                    onClick={() => void pm.applyManualModel()}
                  >
                    确定
                  </button>
                </div>
              </div>
            ) : null}

            {/* ── Model import draft ── */}
            {modelImportDraft?.providerId === provider.id ? (
              <div className="provider-model-import">
                <div className="provider-model-import-head">
                  <div>
                    <strong>
                      发现 {modelImportDraft.models.length} 个新模型
                    </strong>
                    <small>勾选只是选择，点确定后才添加并启用。</small>
                  </div>
                  <div className="settings-row-actions provider-model-import-actions">
                    <button onClick={() => pm.setModelImportDraft(null)}>
                      取消
                    </button>
                    <button
                      className="primary"
                      disabled={modelImportDraft.selectedIds.size === 0}
                      onClick={() => void pm.applyModelImport()}
                    >
                      确定
                    </button>
                  </div>
                </div>
                <div className="provider-model-import-list">
                  {modelImportDraft.models.map((model) => (
                    <label
                      className="provider-model-import-item"
                      key={model.id}
                    >
                      <input
                        type="checkbox"
                        checked={modelImportDraft.selectedIds.has(model.id)}
                        onChange={() => pm.toggleModelImportSelection(model.id)}
                      />
                      <span>
                        <strong>{model.label || model.id}</strong>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {/* ── Model list ── */}
            {provider.models.length > 0 ? (
              <div className="provider-model-list">
                {provider.models.map((model) => {
                  const modelCheckId = `${provider.id}:${model.id}`;
                  const isDefault =
                    defaultModel.providerId === provider.id &&
                    defaultModel.modelId === model.id;
                  return (
                    <ProviderModelCard
                      key={model.id}
                      model={model}
                      provider={provider}
                      isDefault={isDefault}
                      canEdit={canEdit}
                      isChecking={checkingModelIds.has(modelCheckId)}
                      onSetDefault={() =>
                        void pm.setDefaultModel(
                          provider.id,
                          model.id,
                          model.label || model.id || "未命名模型",
                        )
                      }
                      onToggleEnabled={() =>
                        void pm.toggleModelEnabled(
                          provider.id,
                          model.id,
                          model.label || model.id || "未命名模型",
                        )
                      }
                      onTest={() =>
                        void pm.testProviderModel(provider, model.id)
                      }
                      onRemove={() =>
                        void pm.removeProviderModel(provider.id, model.id)
                      }
                      onUpdate={(patch) =>
                        void pm.updateProviderModel(
                          provider.id,
                          model.id,
                          patch,
                        )
                      }
                    />
                  );
                })}
              </div>
            ) : null}
          </div>

          {/* ── Draft panel (new provider confirm/cancel) ── */}
          {isNew ? (
            <div className="provider-draft-panel">
              <div className="settings-row-actions provider-draft-actions">
                <button onClick={() => pm.discardNewProviderDraft(provider.id)}>
                  取消
                </button>
                <button
                  className="primary"
                  disabled={provider.models.length === 0}
                  onClick={() => void pm.confirmNewProviderDraft(provider.id)}
                  title={
                    provider.models.length === 0
                      ? "先添加至少一个模型"
                      : "确认添加模型"
                  }
                >
                  <Check size={14} />
                  确定
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
