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
import type { ModelOption, ModelProviderConfig } from "@shared/types";
import { STRINGS } from "@shared/strings.zh";
import { withModelMetadataDefaults } from "./SettingsWorkbench.utils";
import styles from "./AddEndpointDialog.module.css";

type StatusTone = "info" | "ok" | "error";

export interface AddEndpointStatus {
  (message: string, tone?: StatusTone): void;
}

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
  const [name, setName] = useState(`Endpoint ${index}`);
  const [baseUrl, setBaseUrl] = useState("");
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
  const [testingModelIds, setTestingModelIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [error, setError] = useState<string | null>(null);

  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const providerName = name.trim() || `Endpoint ${index}`;

  const buildProvider = useCallback(
    (): ModelProviderConfig => ({
      id: providerId,
      name: name.trim() || `Endpoint ${index}`,
      type: "openai-compatible",
      enabled: true,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      models,
    }),
    [providerId, name, index, baseUrl, apiKey, models],
  );

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
    if (!baseUrl.trim() || !apiKey.trim()) {
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
    if (!baseUrl.trim() || !apiKey.trim()) {
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

  const handleTestModel = async (modelId: string) => {
    if (!baseUrl.trim() || !apiKey.trim()) {
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
    if (!baseUrl.trim() || !apiKey.trim()) {
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
            <strong>添加模型</strong>
            <small>配置一个端点，并至少添加一个模型进入模型池。</small>
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
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span>Profile 名称</span>
              <input
                ref={firstFieldRef}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Profile 名称"
              />
            </label>
            <label className={styles.field}>
              <span>Base URL</span>
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://api.example.com/v1"
              />
            </label>
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
                      <input
                        type="checkbox"
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
                        <input
                          type="radio"
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
                          <input
                            type="checkbox"
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
                        <input
                          type="checkbox"
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
                        <input
                          type="checkbox"
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
