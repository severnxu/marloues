import { createPortal } from "react-dom";
import {
  Bot,
  Check,
  Eye,
  EyeOff,
  PlugZap,
  Plus,
  RefreshCcw,
  Trash2,
  X,
} from "lucide-react";
import type { ModelEndpointProtocol, ModelProviderConfig } from "@shared/types";
import { builtinProviderMetadata } from "@shared/builtin-provider-metadata";
import { SettingsCheckbox, SettingsRadio, SettingsSelect } from "./shared";
import type { ProviderManagement } from "./use-provider-management";
import styles from "./AddEndpointDialog.module.css";

export function ProviderDetailDialog({
  provider,
  pm,
  canEdit,
  defaultModel,
  onClose,
}: {
  provider: ModelProviderConfig;
  pm: ProviderManagement;
  canEdit: boolean;
  defaultModel: { providerId: string; modelId: string };
  onClose: () => void;
}) {
  const {
    visibleApiKeyProviderIds,
    checkingEndpointIds,
    checkingModelIds,
    fetchingModelIds,
    modelImportDraft,
    manualModelDraft,
    manualModelRef,
  } = pm;
  const builtinMetadata =
    provider.kind === "builtin"
      ? builtinProviderMetadata(provider.presetId)
      : undefined;
  const isApiKeyVisible = visibleApiKeyProviderIds.has(provider.id);
  const isCustom = provider.kind === "custom";

  return createPortal(
    <div className={styles.overlay} role="presentation" onMouseDown={onClose}>
      <div
        className={styles.modal}
        style={{ width: "min(600px, calc(100vw - 48px))" }}
        role="dialog"
        aria-modal="true"
        aria-label="编辑模型供应商"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.head}>
          <div className={styles.headTitle}>
            <strong>{provider.name || "未命名模型"}</strong>
            <small>
              {provider.kind === "builtin"
                ? "内置供应商 · 地址由 Marloues 维护"
                : `${provider.endpoints.length} 个端点 · ${provider.models.length} 个模型`}
            </small>
          </div>
          <button
            type="button"
            className={styles.close}
            title="关闭"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>

        <div className={`${styles.body} scrollbar-thin`}>
          <div className={styles.fieldGrid}>
            {provider.kind === "builtin" ? (
              <div className={styles.routingNote}>
                <strong>{builtinMetadata?.name ?? provider.name}</strong>
                <span>
                  内置地址由 Marloues
                  维护，当前运行时会自动选择可用协议；地址不可查看或修改。
                </span>
              </div>
            ) : (
              <label className={styles.field}>
                <span>供应商名称</span>
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
                  placeholder="供应商名称"
                />
              </label>
            )}
            <label className={styles.field}>
              <span>API Key</span>
              <div className={styles.apiKeyWrap}>
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
                  type="button"
                  className={styles.iconButton}
                  disabled={provider.locked || !canEdit}
                  title={isApiKeyVisible ? "隐藏 API 密钥" : "查看 API 密钥"}
                  onClick={() => pm.toggleApiKeyVisible(provider.id)}
                >
                  {isApiKeyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>
          </div>

          {isCustom ? (
            <div className={styles.endpointSection}>
              <div className={styles.modelSectionHead}>
                <span>模型端点</span>
                <button
                  type="button"
                  className={styles.addEndpointButton}
                  disabled={provider.locked || !canEdit}
                  onClick={() => pm.addProviderEndpoint(provider.id)}
                >
                  <Plus size={14} />
                  添加端点
                </button>
              </div>
              <div className={styles.endpointList}>
                {provider.endpoints.map((endpoint, index) => {
                  const endpointCheckId = `${provider.id}:${endpoint.id}`;
                  return (
                    <div className={styles.endpointRow} key={endpoint.id}>
                      <div className={styles.endpointRowHead}>
                        <label className={styles.configCheck}>
                          <SettingsCheckbox
                            checked={endpoint.enabled}
                            disabled={provider.locked || !canEdit}
                            onChange={(event) =>
                              pm.updateProviderEndpoint(
                                provider.id,
                                endpoint.id,
                                {
                                  enabled: event.target.checked,
                                },
                              )
                            }
                          />
                          端点 {index + 1}
                        </label>
                        <div className={styles.rowActions}>
                          <button
                            type="button"
                            className={styles.iconButton}
                            disabled={checkingEndpointIds.has(endpointCheckId)}
                            title="测试此端点"
                            onClick={() =>
                              void pm.testEndpointProfile(
                                provider.id,
                                endpoint.id,
                              )
                            }
                          >
                            {checkingEndpointIds.has(endpointCheckId) ? (
                              <RefreshCcw size={13} />
                            ) : (
                              <PlugZap size={13} />
                            )}
                          </button>
                          <button
                            type="button"
                            className={styles.iconButton}
                            disabled={
                              provider.locked ||
                              !canEdit ||
                              provider.endpoints.length === 1
                            }
                            title="删除端点"
                            onClick={() =>
                              pm.removeProviderEndpoint(
                                provider.id,
                                endpoint.id,
                              )
                            }
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                      <div className={styles.endpointGrid}>
                        <label className={styles.field}>
                          <span>协议</span>
                          <SettingsSelect
                            ariaLabel={`端点 ${index + 1} 协议`}
                            value={endpoint.protocol}
                            options={[
                              { value: "openai-chat", label: "OpenAI Chat" },
                              {
                                value: "openai-responses",
                                label: "OpenAI Responses",
                              },
                              { value: "anthropic", label: "Anthropic" },
                            ]}
                            disabled={provider.locked || !canEdit}
                            onChange={(value) =>
                              pm.updateProviderEndpoint(
                                provider.id,
                                endpoint.id,
                                {
                                  protocol: value as ModelEndpointProtocol,
                                },
                              )
                            }
                          />
                        </label>
                        <label className={styles.field}>
                          <span>优先级</span>
                          <input
                            type="number"
                            min={0}
                            value={endpoint.priority}
                            disabled={provider.locked || !canEdit}
                            onChange={(event) =>
                              pm.updateProviderEndpoint(
                                provider.id,
                                endpoint.id,
                                {
                                  priority: Number(event.target.value) || 0,
                                },
                              )
                            }
                          />
                        </label>
                        <label
                          className={`${styles.field} ${styles.endpointUrl}`}
                        >
                          <span>Base URL</span>
                          <input
                            value={endpoint.baseUrl}
                            disabled={provider.locked || !canEdit}
                            onChange={(event) =>
                              pm.updateProviderEndpoint(
                                provider.id,
                                endpoint.id,
                                {
                                  baseUrl: event.target.value,
                                },
                              )
                            }
                            placeholder="https://api.example.com/v1"
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className={styles.modelSection}>
            <div className={styles.modelSectionHead}>
              <span>模型</span>
              <div className={styles.rowActions}>
                <button
                  type="button"
                  disabled={
                    fetchingModelIds.has(provider.id) ||
                    provider.locked ||
                    !canEdit
                  }
                  onClick={() => void pm.fetchProviderModels(provider.id)}
                >
                  {fetchingModelIds.has(provider.id) ? (
                    <RefreshCcw size={14} />
                  ) : (
                    <Bot size={14} />
                  )}
                  {fetchingModelIds.has(provider.id) ? "获取中" : "获取模型"}
                </button>
                <button
                  type="button"
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

            {manualModelDraft?.providerId === provider.id ? (
              <div className={styles.manualRow} ref={manualModelRef}>
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
                  placeholder="输入模型 ID，例如 gpt-4o-mini"
                />
                <button
                  type="button"
                  className={styles.iconButton}
                  disabled={provider.locked || !canEdit}
                  title="手动添加模型"
                  onClick={() => void pm.applyManualModel()}
                >
                  <Plus size={14} />
                </button>
              </div>
            ) : null}

            {modelImportDraft?.providerId === provider.id ? (
              <div className={styles.importBlock}>
                <div className={styles.importHead}>
                  <div>
                    <strong>
                      发现 {modelImportDraft.models.length} 个新模型
                    </strong>
                    <small>勾选只是选择，点确定后才添加并启用。</small>
                  </div>
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      onClick={() => pm.setModelImportDraft(null)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className={styles.primary}
                      disabled={modelImportDraft.selectedIds.size === 0}
                      onClick={() => void pm.applyModelImport()}
                    >
                      确定
                    </button>
                  </div>
                </div>
                <div className={styles.importList}>
                  {modelImportDraft.models.map((model) => (
                    <label className={styles.importItem} key={model.id}>
                      <SettingsCheckbox
                        checked={modelImportDraft.selectedIds.has(model.id)}
                        onChange={() => pm.toggleModelImportSelection(model.id)}
                      />
                      <span>{model.label || model.id}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {provider.models.length > 0 ? (
              <div className={styles.modelList}>
                {provider.models.map((model) => {
                  const modelCheckId = `${provider.id}:${model.id}`;
                  const isDefault =
                    defaultModel.providerId === provider.id &&
                    defaultModel.modelId === model.id;
                  return (
                    <div className={styles.modelRow} key={model.id}>
                      <div className={styles.modelRowHead}>
                        <label className={styles.modelDefault}>
                          <SettingsRadio
                            name={`provider-default-${provider.id}`}
                            checked={isDefault}
                            disabled={provider.locked || !canEdit}
                            onChange={() =>
                              void pm.setDefaultModel(
                                provider.id,
                                model.id,
                                model.label || model.id || "未命名模型",
                              )
                            }
                          />
                          <strong>{model.label || model.id}</strong>
                          {isDefault ? (
                            <span className={styles.badgeDefault}>默认</span>
                          ) : null}
                        </label>
                        <div className={styles.modelRowState}>
                          <label className={styles.configCheck}>
                            <SettingsCheckbox
                              checked={model.enabled}
                              disabled={provider.locked || !canEdit}
                              onChange={() =>
                                void pm.toggleModelEnabled(
                                  provider.id,
                                  model.id,
                                  model.label || model.id || "未命名模型",
                                )
                              }
                            />
                            启用
                          </label>
                          <button
                            type="button"
                            className={styles.iconButton}
                            disabled={
                              checkingModelIds.has(modelCheckId) ||
                              provider.locked ||
                              !canEdit
                            }
                            title={
                              checkingModelIds.has(modelCheckId)
                                ? "探测中"
                                : "发送探测消息"
                            }
                            onClick={() =>
                              void pm.testProviderModel(provider, model.id)
                            }
                          >
                            {checkingModelIds.has(modelCheckId) ? (
                              <RefreshCcw size={13} />
                            ) : (
                              <PlugZap size={13} />
                            )}
                          </button>
                          <button
                            type="button"
                            className={styles.iconButton}
                            disabled={provider.locked || !canEdit}
                            title="移除"
                            onClick={() =>
                              void pm.removeProviderModel(provider.id, model.id)
                            }
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                      <div className={styles.modelConfigGrid}>
                        <label className={styles.configField}>
                          <span>上下文窗口</span>
                          <input
                            type="number"
                            min={1}
                            step={1000}
                            disabled={provider.locked || !canEdit}
                            value={model.contextWindowTokens ?? ""}
                            onChange={(event) =>
                              void pm.updateProviderModel(
                                provider.id,
                                model.id,
                                {
                                  contextWindowTokens: event.target.value
                                    ? Number(event.target.value)
                                    : undefined,
                                },
                              )
                            }
                            placeholder="例如 1000000"
                          />
                        </label>
                        <label className={styles.configField}>
                          <span>最大输出标记数</span>
                          <input
                            type="number"
                            min={1}
                            step={1000}
                            disabled={provider.locked || !canEdit}
                            value={model.maxOutputTokens ?? ""}
                            onChange={(event) =>
                              void pm.updateProviderModel(
                                provider.id,
                                model.id,
                                {
                                  maxOutputTokens: event.target.value
                                    ? Number(event.target.value)
                                    : undefined,
                                },
                              )
                            }
                            placeholder="例如 384000"
                          />
                        </label>
                        <label className={styles.configCheck}>
                          <SettingsCheckbox
                            disabled={provider.locked || !canEdit}
                            checked={Boolean(model.supportsVision)}
                            onChange={(event) =>
                              void pm.updateProviderModel(
                                provider.id,
                                model.id,
                                {
                                  supportsVision: event.target.checked,
                                },
                              )
                            }
                          />
                          视觉
                        </label>
                        <label className={styles.configCheck}>
                          <SettingsCheckbox
                            disabled={provider.locked || !canEdit}
                            checked={Boolean(model.supportsThinking)}
                            onChange={(event) =>
                              void pm.updateProviderModel(
                                provider.id,
                                model.id,
                                {
                                  supportsThinking: event.target.checked,
                                },
                              )
                            }
                          />
                          思考
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className={styles.emptyHint}>
                还没有模型。获取模型或手动添加一个。
              </p>
            )}
          </div>
        </div>

        <div className={styles.footer}>
          <button type="button" onClick={onClose}>
            <Check size={14} />
            完成
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
