import { useCallback, useEffect, useRef, useState } from "react";
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
import type {
  ModelEndpointProtocol,
  ModelOption,
  ModelProviderConfig,
  ModelProviderEndpoint,
} from "@shared/types";
import {
  BUILTIN_PROVIDER_METADATA,
  builtinProviderMetadata,
  type BuiltinProviderPresetId,
} from "@shared/builtin-provider-metadata";
import { STRINGS } from "@shared/strings.zh";
import { SettingsCheckbox, SettingsRadio, SettingsSelect } from "./shared";
import { withModelMetadataDefaults } from "./SettingsWorkbench.utils";
import styles from "./AddEndpointDialog.module.css";

type StatusTone = "info" | "ok" | "error";

export interface AddEndpointStatus {
  (message: string, tone?: StatusTone): void;
}

const PROTOCOL_OPTIONS = [
  { value: "openai-chat", label: "OpenAI Chat" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic", label: "Anthropic" },
];

export function AddEndpointDialog({
  index,
  onConfirm,
  onCancel,
  onStatus,
}: {
  index: number;
  onConfirm: (
    provider: ModelProviderConfig,
    defaultModelId: string | null,
  ) => void;
  onCancel: () => void;
  onStatus: AddEndpointStatus;
}) {
  const [providerId] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<"builtin" | "custom">("builtin");
  const [presetId, setPresetId] = useState<BuiltinProviderPresetId>("deepseek");
  const [name, setName] = useState(`自定义供应商 ${index}`);
  const [endpoints, setEndpoints] = useState<ModelProviderEndpoint[]>(() => [
    createEndpoint(1),
  ]);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);
  const [importDraft, setImportDraft] = useState<{
    models: ModelOption[];
    selectedIds: Set<string>;
  } | null>(null);
  const [manualId, setManualId] = useState("");
  const [fetching, setFetching] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingEndpointIds, setTestingEndpointIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [testingModelIds, setTestingModelIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [error, setError] = useState<string | null>(null);

  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const preset = builtinProviderMetadata(presetId);
  const providerName =
    kind === "builtin"
      ? preset?.name || presetId
      : name.trim() || `自定义供应商 ${index}`;

  const buildProvider = useCallback(
    (): ModelProviderConfig =>
      kind === "builtin"
        ? {
            id: providerId,
            name: providerName,
            kind: "builtin",
            presetId,
            enabled: true,
            apiKey: apiKey.trim(),
            models,
          }
        : {
            id: providerId,
            name: providerName,
            kind: "custom",
            endpoints: endpoints.map((endpoint) => ({
              ...endpoint,
              name: endpoint.name?.trim(),
              baseUrl: endpoint.baseUrl.trim(),
            })),
            enabled: true,
            apiKey: apiKey.trim(),
            models,
          },
    [kind, providerId, providerName, presetId, apiKey, models, endpoints],
  );

  useEffect(() => {
    setModels([]);
    setDefaultModelId(null);
    setImportDraft(null);
  }, [kind, presetId]);

  // Esc to cancel (Enter handled per-field)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  // Autofocus first field on open
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      firstFieldRef.current?.focus();
      firstFieldRef.current?.select?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Keep a valid default model selection (auto-pick first when empty / removed)
  useEffect(() => {
    if (models.length === 0) {
      if (defaultModelId !== null) setDefaultModelId(null);
      return;
    }
    if (!models.some((model) => model.id === defaultModelId)) {
      setDefaultModelId(models[0].id);
    }
  }, [models, defaultModelId]);

  const flash = (message: string, tone: StatusTone = "info") => {
    setError(tone === "error" ? message : null);
    onStatus(message, tone);
  };

  const handleFetchModels = async () => {
    if (!providerIsComplete(kind, apiKey, endpoints)) {
      flash(STRINGS.model.missingEndpointFields, "error");
      return;
    }
    setFetching(true);
    onStatus(STRINGS.model.fetchingModels(providerName), "info");
    try {
      if (typeof window.marloues.config.listEndpointModels !== "function") {
        flash(STRINGS.model.preloadNotInjectedList, "error");
        return;
      }
      const result =
        await window.marloues.config.listEndpointModels(buildProvider());
      if (!result.ok || result.models.length === 0) {
        flash(
          STRINGS.model.endpointResult(
            providerName,
            result.message,
            result.latencyMs,
          ),
          "error",
        );
        return;
      }
      const currentIds = new Set(models.map((model) => model.id));
      const discovered = result.models
        .filter((model) => !currentIds.has(model.id))
        .map((model) => ({ ...model, enabled: false }));
      if (discovered.length === 0) {
        flash(STRINGS.model.noNewModels(providerName, result.latencyMs), "ok");
        setImportDraft((current) =>
          current?.models === discovered ? null : current,
        );
        return;
      }
      setImportDraft({ models: discovered, selectedIds: new Set() });
      flash(
        STRINGS.model.modelsDiscovered(
          providerName,
          discovered.length,
          result.latencyMs,
        ),
        "ok",
      );
    } catch (error) {
      flash(
        STRINGS.model.endpointResult(
          providerName,
          error instanceof Error ? error.message : String(error),
        ),
        "error",
      );
    } finally {
      setFetching(false);
    }
  };

  const toggleImportSelection = (modelId: string) => {
    setImportDraft((current) => {
      if (!current) return current;
      const selectedIds = new Set(current.selectedIds);
      if (selectedIds.has(modelId)) selectedIds.delete(modelId);
      else selectedIds.add(modelId);
      return { ...current, selectedIds };
    });
  };

  const applyImport = () => {
    if (!importDraft) return;
    const currentIds = new Set(models.map((model) => model.id));
    const selected = importDraft.models
      .filter(
        (model) =>
          importDraft.selectedIds.has(model.id) && !currentIds.has(model.id),
      )
      .map((model) => withModelMetadataDefaults({ ...model, enabled: true }));
    if (selected.length === 0) {
      flash(STRINGS.model.selectModelToAdd, "error");
      return;
    }
    setModels((current) => [...current, ...selected]);
    setImportDraft(null);
    flash(STRINGS.model.modelsImported(providerName, selected.length), "ok");
  };

  const applyManual = () => {
    const id = manualId.trim();
    if (!id) {
      flash(STRINGS.model.modelIdRequired, "error");
      return;
    }
    if (models.some((model) => model.id === id)) {
      flash(STRINGS.model.modelAlreadyExists(providerName, id), "error");
      return;
    }
    setModels((current) => [
      ...current,
      withModelMetadataDefaults({ id, label: id, enabled: true }),
    ]);
    setManualId("");
    flash(STRINGS.model.manualModelAdded(providerName, id), "ok");
  };

  const removeModel = (modelId: string) => {
    setModels((current) => current.filter((model) => model.id !== modelId));
  };

  const updateModel = (modelId: string, patch: Partial<ModelOption>) => {
    setModels((current) =>
      current.map((model) =>
        model.id === modelId ? { ...model, ...patch } : model,
      ),
    );
  };

  const handleTest = async () => {
    if (!providerIsComplete(kind, apiKey, endpoints)) {
      flash(STRINGS.model.missingEndpointFields, "error");
      return;
    }
    setTesting(true);
    onStatus(STRINGS.model.testingProvider(providerName), "info");
    try {
      const result =
        await window.marloues.config.testEndpointProfile(buildProvider());
      flash(
        STRINGS.model.endpointResult(
          providerName,
          result.message,
          result.latencyMs,
        ),
        result.ok ? "ok" : "error",
      );
    } catch (error) {
      flash(
        STRINGS.model.endpointResult(
          providerName,
          error instanceof Error ? error.message : String(error),
        ),
        "error",
      );
    } finally {
      setTesting(false);
    }
  };

  const handleTestEndpoint = async (endpointId: string) => {
    if (!providerIsComplete(kind, apiKey, endpoints)) {
      flash(STRINGS.model.missingEndpointFields, "error");
      return;
    }
    setTestingEndpointIds((ids) => new Set(ids).add(endpointId));
    try {
      const result = await window.marloues.config.testEndpointProfile(
        buildProvider(),
        endpointId,
      );
      flash(
        STRINGS.model.endpointResult(
          providerName,
          result.message,
          result.latencyMs,
        ),
        result.ok ? "ok" : "error",
      );
    } finally {
      setTestingEndpointIds((ids) => {
        const next = new Set(ids);
        next.delete(endpointId);
        return next;
      });
    }
  };

  const handleTestModel = async (modelId: string) => {
    if (!providerIsComplete(kind, apiKey, endpoints)) {
      flash(STRINGS.model.missingEndpointFields, "error");
      return;
    }
    const modelTitle = models.find((m) => m.id === modelId)?.label || modelId;
    setTestingModelIds((ids) => new Set(ids).add(modelId));
    onStatus(STRINGS.model.probingModel(modelTitle), "info");
    try {
      if (typeof window.marloues.config.testEndpointModel !== "function") {
        flash(STRINGS.model.preloadNotInjectedProbe, "error");
        return;
      }
      const result = await window.marloues.config.testEndpointModel(
        buildProvider(),
        modelId,
      );
      flash(
        STRINGS.model.endpointResult(
          providerName,
          result.message,
          result.latencyMs,
        ),
        result.ok ? "ok" : "error",
      );
    } catch (error) {
      flash(
        STRINGS.model.endpointResult(
          providerName,
          error instanceof Error ? error.message : String(error),
        ),
        "error",
      );
    } finally {
      setTestingModelIds((ids) => {
        const next = new Set(ids);
        next.delete(modelId);
        return next;
      });
    }
  };

  const handleConfirm = () => {
    if (!providerIsComplete(kind, apiKey, endpoints)) {
      flash(STRINGS.model.missingEndpointFields, "error");
      return;
    }
    if (models.length === 0) {
      flash(STRINGS.model.missingModel, "error");
      return;
    }
    onConfirm(buildProvider(), defaultModelId);
  };

  return createPortal(
    <div className={styles.overlay} role="presentation" onMouseDown={onCancel}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="添加模型"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.head}>
          <div className={styles.headTitle}>
            <strong>添加模型供应商</strong>
            <small>
              内置供应商自动匹配运行时协议；自定义供应商可配置多个端点。
            </small>
          </div>
          <button
            type="button"
            className={styles.close}
            title="关闭"
            onClick={onCancel}
          >
            <X size={15} />
          </button>
        </div>

        <div className={`${styles.body} scrollbar-thin`}>
          <div
            className={styles.kindSwitch}
            role="tablist"
            aria-label="供应商类型"
          >
            <button
              type="button"
              role="tab"
              aria-selected={kind === "builtin"}
              className={kind === "builtin" ? styles.kindActive : undefined}
              onClick={() => setKind("builtin")}
            >
              内置供应商
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={kind === "custom"}
              className={kind === "custom" ? styles.kindActive : undefined}
              onClick={() => setKind("custom")}
            >
              自定义
            </button>
          </div>

          <div className={styles.fieldGrid}>
            {kind === "builtin" ? (
              <>
                <label className={styles.field}>
                  <span>供应商</span>
                  <SettingsSelect
                    ariaLabel="供应商"
                    value={presetId}
                    options={BUILTIN_PROVIDER_METADATA.map((item) => ({
                      value: item.id,
                      label: item.name,
                    }))}
                    onChange={(value) =>
                      setPresetId(value as BuiltinProviderPresetId)
                    }
                  />
                </label>
                <div className={styles.routingNote}>
                  <strong>运行时自动适配</strong>
                  <span>
                    地址由 Marloues 内置维护，使用时按 SDK、Binary
                    或自研运行时自动选择协议。
                  </span>
                </div>
              </>
            ) : (
              <label className={styles.field}>
                <span>供应商名称</span>
                <input
                  ref={firstFieldRef}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="供应商名称"
                />
              </label>
            )}
            <label className={styles.field}>
              <span>API Key</span>
              <div className={styles.apiKeyWrap}>
                <input
                  type={apiKeyVisible ? "text" : "password"}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="API Key"
                />
                <button
                  type="button"
                  className={styles.iconButton}
                  title={apiKeyVisible ? "隐藏 API 密钥" : "查看 API 密钥"}
                  onClick={() => setApiKeyVisible((value) => !value)}
                >
                  {apiKeyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>
          </div>

          {kind === "custom" ? (
            <div className={styles.endpointSection}>
              <div className={styles.modelSectionHead}>
                <span>模型端点</span>
                <button
                  type="button"
                  className={styles.addEndpointButton}
                  onClick={() =>
                    setEndpoints((current) => [
                      ...current,
                      createEndpoint(current.length + 1),
                    ])
                  }
                >
                  <Plus size={14} />
                  添加端点
                </button>
              </div>
              <div className={styles.endpointList}>
                {endpoints.map((endpoint, endpointIndex) => (
                  <div className={styles.endpointRow} key={endpoint.id}>
                    <div className={styles.endpointRowHead}>
                      <label className={styles.configCheck}>
                        <SettingsCheckbox
                          checked={endpoint.enabled}
                          onChange={(event) =>
                            setEndpoints((current) =>
                              current.map((item) =>
                                item.id === endpoint.id
                                  ? { ...item, enabled: event.target.checked }
                                  : item,
                              ),
                            )
                          }
                        />
                        端点 {endpointIndex + 1}
                      </label>
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          className={styles.iconButton}
                          disabled={testingEndpointIds.has(endpoint.id)}
                          title="测试此端点"
                          onClick={() => void handleTestEndpoint(endpoint.id)}
                        >
                          {testingEndpointIds.has(endpoint.id) ? (
                            <RefreshCcw size={13} />
                          ) : (
                            <PlugZap size={13} />
                          )}
                        </button>
                        <button
                          type="button"
                          className={styles.iconButton}
                          disabled={endpoints.length === 1}
                          title="删除端点"
                          onClick={() =>
                            setEndpoints((current) =>
                              current.filter((item) => item.id !== endpoint.id),
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
                          ariaLabel={`端点 ${endpointIndex + 1} 协议`}
                          value={endpoint.protocol}
                          options={PROTOCOL_OPTIONS}
                          onChange={(value) =>
                            setEndpoints((current) =>
                              current.map((item) =>
                                item.id === endpoint.id
                                  ? {
                                      ...item,
                                      protocol: value as ModelEndpointProtocol,
                                    }
                                  : item,
                              ),
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
                          onChange={(event) =>
                            setEndpoints((current) =>
                              current.map((item) =>
                                item.id === endpoint.id
                                  ? {
                                      ...item,
                                      priority: Number(event.target.value) || 0,
                                    }
                                  : item,
                              ),
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
                          onChange={(event) =>
                            setEndpoints((current) =>
                              current.map((item) =>
                                item.id === endpoint.id
                                  ? { ...item, baseUrl: event.target.value }
                                  : item,
                              ),
                            )
                          }
                          placeholder="https://api.example.com/v1"
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className={styles.modelSection}>
            <div className={styles.modelSectionHead}>
              <span>模型</span>
              <div className={styles.rowActions}>
                <button
                  type="button"
                  disabled={fetching}
                  onClick={() => void handleFetchModels()}
                  title="从端点获取可用模型"
                >
                  {fetching ? <RefreshCcw size={14} /> : <Bot size={14} />}
                  {fetching ? "获取中" : "获取模型"}
                </button>
                <button
                  type="button"
                  disabled={testing}
                  onClick={() => void handleTest()}
                  title="测试端点连接"
                >
                  {testing ? <RefreshCcw size={14} /> : <PlugZap size={14} />}
                  {testing ? "测试中" : "测试连接"}
                </button>
              </div>
            </div>

            <label className={styles.manualRow}>
              <input
                value={manualId}
                onChange={(event) => setManualId(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyManual();
                  }
                }}
                placeholder="输入模型 ID，例如 gpt-4o-mini"
              />
              <button
                type="button"
                className={styles.iconButton}
                title="手动添加模型"
                onClick={applyManual}
              >
                <Plus size={14} />
              </button>
            </label>

            {importDraft ? (
              <div className={styles.importBlock}>
                <div className={styles.importHead}>
                  <div>
                    <strong>发现 {importDraft.models.length} 个新模型</strong>
                    <small>勾选只是选择，点确定后才添加并启用。</small>
                  </div>
                  <div className={styles.rowActions}>
                    <button type="button" onClick={() => setImportDraft(null)}>
                      取消
                    </button>
                    <button
                      type="button"
                      className={styles.primary}
                      disabled={importDraft.selectedIds.size === 0}
                      onClick={applyImport}
                    >
                      确定
                    </button>
                  </div>
                </div>
                <div className={styles.importList}>
                  {importDraft.models.map((model) => (
                    <label className={styles.importItem} key={model.id}>
                      <SettingsCheckbox
                        checked={importDraft.selectedIds.has(model.id)}
                        onChange={() => toggleImportSelection(model.id)}
                      />
                      <span>{model.label || model.id}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {models.length > 0 ? (
              <div className={`${styles.modelList} scrollbar-thin`}>
                {models.map((model) => (
                  <div className={styles.modelRow} key={model.id}>
                    <div className={styles.modelRowHead}>
                      <label className={styles.modelDefault}>
                        <SettingsRadio
                          name="add-endpoint-default-model"
                          checked={defaultModelId === model.id}
                          onChange={() => setDefaultModelId(model.id)}
                        />
                        <strong>{model.label || model.id}</strong>
                        {defaultModelId === model.id ? (
                          <span className={styles.badgeDefault}>默认</span>
                        ) : null}
                      </label>
                      <div className={styles.modelRowState}>
                        <label className={styles.configCheck}>
                          <SettingsCheckbox
                            checked={model.enabled}
                            onChange={(event) =>
                              updateModel(model.id, {
                                enabled: event.target.checked,
                              })
                            }
                          />
                          启用
                        </label>
                        <button
                          type="button"
                          className={styles.iconButton}
                          title={
                            testingModelIds.has(model.id)
                              ? "探测中"
                              : "发送探测消息"
                          }
                          disabled={testingModelIds.has(model.id)}
                          onClick={() => void handleTestModel(model.id)}
                        >
                          {testingModelIds.has(model.id) ? (
                            <RefreshCcw size={13} />
                          ) : (
                            <PlugZap size={13} />
                          )}
                        </button>
                        <button
                          type="button"
                          className={styles.iconButton}
                          title="移除"
                          onClick={() => removeModel(model.id)}
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
                          value={model.contextWindowTokens ?? ""}
                          onChange={(event) =>
                            updateModel(model.id, {
                              contextWindowTokens: event.target.value
                                ? Number(event.target.value)
                                : undefined,
                            })
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
                          value={model.maxOutputTokens ?? ""}
                          onChange={(event) =>
                            updateModel(model.id, {
                              maxOutputTokens: event.target.value
                                ? Number(event.target.value)
                                : undefined,
                            })
                          }
                          placeholder="例如 384000"
                        />
                      </label>
                      <label className={styles.configCheck}>
                        <SettingsCheckbox
                          checked={Boolean(model.supportsVision)}
                          onChange={(event) =>
                            updateModel(model.id, {
                              supportsVision: event.target.checked,
                            })
                          }
                        />
                        视觉
                      </label>
                      <label className={styles.configCheck}>
                        <SettingsCheckbox
                          checked={Boolean(model.supportsThinking)}
                          onChange={(event) =>
                            updateModel(model.id, {
                              supportsThinking: event.target.checked,
                            })
                          }
                        />
                        思考
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.emptyHint}>
                还没有模型。获取模型或手动添加一个。
              </p>
            )}
          </div>

          {error ? <p className={styles.errorText}>{error}</p> : null}
        </div>

        <div className={styles.footer}>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={models.length === 0}
            title={models.length === 0 ? "先添加至少一个模型" : "确认添加模型"}
            onClick={handleConfirm}
          >
            <Check size={14} />
            确定
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function createEndpoint(index: number): ModelProviderEndpoint {
  return {
    id: crypto.randomUUID(),
    name: `端点 ${index}`,
    protocol: "openai-chat",
    baseUrl: "",
    enabled: true,
    priority: index * 10,
  };
}

function providerIsComplete(
  kind: "builtin" | "custom",
  apiKey: string,
  endpoints: ModelProviderEndpoint[],
): boolean {
  if (!apiKey.trim()) return false;
  if (kind === "builtin") return true;
  return endpoints.some(
    (endpoint) => endpoint.enabled && endpoint.baseUrl.trim(),
  );
}
