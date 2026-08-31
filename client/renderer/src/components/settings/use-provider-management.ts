import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  AgentSettings,
  ModelOption,
  ModelProviderConfig,
  ModelProviderEndpoint,
} from "@shared/types";
import { STRINGS } from "@shared/strings.zh";
import {
  normalizeModelMetadataPatch,
  withModelMetadataDefaults,
} from "./SettingsWorkbench.utils";

type StatusTone = "info" | "ok" | "error";

export type CommitDraft = (
  nextDraft: AgentSettings,
  message?: string,
  tone?: StatusTone,
) => Promise<void>;

export type SetStatus = (message: string, tone?: StatusTone) => void;

export interface ModelImportDraft {
  providerId: string;
  models: ModelOption[];
  selectedIds: Set<string>;
}

export interface ManualModelDraft {
  providerId: string;
  modelId: string;
}

export function useProviderManagement(
  draft: AgentSettings | null,
  setDraft: Dispatch<SetStateAction<AgentSettings | null>>,
  commitDraft: CommitDraft,
  setStatus: SetStatus,
) {
  const [checkingEndpointIds, setCheckingEndpointIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [checkingModelIds, setCheckingModelIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [fetchingModelIds, setFetchingModelIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedProviderIds, setExpandedProviderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [visibleApiKeyProviderIds, setVisibleApiKeyProviderIds] = useState<
    Set<string>
  >(() => new Set());
  const [modelImportDraft, setModelImportDraft] =
    useState<ModelImportDraft | null>(null);
  const [manualModelDraft, setManualModelDraft] =
    useState<ManualModelDraft | null>(null);
  const manualModelRef = useRef<HTMLDivElement | null>(null);

  // ── Provider CRUD ──────────────────────────────────────────────

  const removeEndpointProfile = async (providerId: string) => {
    if (!draft) return;
    if (draft.providers.length <= 1) {
      setStatus("至少需要保留一个模型供应商。", "error");
      return;
    }
    const removedProvider = draft.providers.find(
      (provider) => provider.id === providerId,
    );
    const providers = draft.providers.filter(
      (provider) => provider.id !== providerId,
    );
    const fallback = providers[0];
    const fallbackModelId =
      fallback?.models.find((model) => model.enabled)?.id ??
      fallback?.models[0]?.id ??
      "";
    await commitDraft(
      {
        ...draft,
        providers,
        defaultModel:
          draft.defaultModel.providerId === providerId
            ? {
                providerId: fallback.id,
                modelId: fallbackModelId,
              }
            : draft.defaultModel,
      },
      STRINGS.model.removeProvider(removedProvider?.name || "模型"),
    );
  };

  // ── Dialog-based add (does not pollute draft until confirmed) ──

  const commitNewProvider = async (
    provider: ModelProviderConfig,
    defaultModelId?: string | null,
  ) => {
    if (!draft) return;
    const id = provider.id || crypto.randomUUID();
    const next = {
      ...draft,
      providers: [
        { ...provider, id, enabled: provider.enabled !== false },
        ...draft.providers,
      ],
      defaultModel: defaultModelId
        ? { providerId: id, modelId: defaultModelId }
        : draft.defaultModel,
    };
    setExpandedProviderIds((ids) => new Set(ids).add(id));
    await commitDraft(
      next,
      STRINGS.model.addProvider(provider.name || "新模型"),
    );
  };

  // ── Provider UI toggles ────────────────────────────────────────

  const toggleProviderExpanded = (providerId: string) => {
    setExpandedProviderIds((ids) => {
      const next = new Set(ids);
      if (next.has(providerId)) next.delete(providerId);
      else next.add(providerId);
      return next;
    });
  };

  const openProviderDetail = (providerId: string) => {
    setExpandedProviderIds((ids) => new Set(ids).add(providerId));
  };

  const closeProviderDetail = (providerId: string) => {
    setExpandedProviderIds((ids) => {
      const next = new Set(ids);
      next.delete(providerId);
      return next;
    });
  };

  const toggleApiKeyVisible = (providerId: string) => {
    setVisibleApiKeyProviderIds((ids) => {
      const next = new Set(ids);
      if (next.has(providerId)) next.delete(providerId);
      else next.add(providerId);
      return next;
    });
  };

  // ── Provider field updates (extracted from inline JSX) ─────────

  const updateProviderField = (
    providerId: string,
    field: "name" | "apiKey",
    value: string,
  ) => {
    if (!draft) return;
    const nextDraft = {
      ...draft,
      providers: draft.providers.map((item) =>
        item.id === providerId ? { ...item, [field]: value } : item,
      ),
    };
    void commitDraft(nextDraft);
  };

  const updateProviderEndpoint = (
    providerId: string,
    endpointId: string,
    patch: Partial<ModelProviderEndpoint>,
  ) => {
    if (!draft) return;
    const nextDraft: AgentSettings = {
      ...draft,
      providers: draft.providers.map((provider) =>
        provider.id === providerId && provider.kind === "custom"
          ? {
              ...provider,
              endpoints: provider.endpoints.map((endpoint) =>
                endpoint.id === endpointId
                  ? { ...endpoint, ...patch }
                  : endpoint,
              ),
            }
          : provider,
      ),
    };
    void commitDraft(nextDraft);
  };

  const addProviderEndpoint = (providerId: string) => {
    if (!draft) return;
    const nextDraft: AgentSettings = {
      ...draft,
      providers: draft.providers.map((provider) =>
        provider.id === providerId && provider.kind === "custom"
          ? {
              ...provider,
              endpoints: [
                ...provider.endpoints,
                createProviderEndpoint(provider.endpoints.length + 1),
              ],
            }
          : provider,
      ),
    };
    void commitDraft(nextDraft);
  };

  const removeProviderEndpoint = (providerId: string, endpointId: string) => {
    if (!draft) return;
    const nextDraft: AgentSettings = {
      ...draft,
      providers: draft.providers.map((provider) =>
        provider.id === providerId && provider.kind === "custom"
          ? {
              ...provider,
              endpoints: provider.endpoints.filter(
                (endpoint) => endpoint.id !== endpointId,
              ),
            }
          : provider,
      ),
    };
    void commitDraft(nextDraft);
  };

  const toggleProviderEnabled = async (
    providerId: string,
    enabled: boolean,
  ) => {
    if (!draft) return;
    const provider = draft.providers.find((item) => item.id === providerId);
    if (!provider) return;
    const nextDraft = {
      ...draft,
      providers: draft.providers.map((item) =>
        item.id === providerId ? { ...item, enabled } : item,
      ),
    };
    await commitDraft(
      nextDraft,
      STRINGS.model.toggleProvider(provider.name, enabled),
    );
  };

  const testEndpointProfile = async (
    providerId: string,
    endpointId?: string,
  ) => {
    if (!draft) return;
    const provider = draft.providers.find((item) => item.id === providerId);
    if (!provider) return;
    const checkId = endpointId ? `${provider.id}:${endpointId}` : provider.id;
    setCheckingEndpointIds((ids) => new Set(ids).add(checkId));
    setStatus(STRINGS.model.testingProvider(provider.name));
    try {
      const result = await window.marloues.config.testEndpointProfile(
        provider,
        endpointId,
      );
      setStatus(
        STRINGS.model.endpointResult(
          provider.name,
          result.message,
          result.latencyMs,
        ),
        result.ok ? "ok" : "error",
      );
    } finally {
      setCheckingEndpointIds((ids) => {
        const next = new Set(ids);
        next.delete(checkId);
        return next;
      });
    }
  };

  // ── Model import / manual add ──────────────────────────────────

  const toggleModelImportSelection = (modelId: string) => {
    if (!modelImportDraft) return;
    setModelImportDraft((current) => {
      if (!current) return current;
      const selectedIds = new Set(current.selectedIds);
      if (selectedIds.has(modelId)) selectedIds.delete(modelId);
      else selectedIds.add(modelId);
      return { ...current, selectedIds };
    });
  };

  const applyModelImport = async () => {
    if (!modelImportDraft || !draft) return;
    const provider = draft.providers.find(
      (item) => item.id === modelImportDraft.providerId,
    );
    if (!provider) {
      setModelImportDraft(null);
      return;
    }
    const currentIds = new Set(provider.models.map((model) => model.id));
    const selectedModels = modelImportDraft.models
      .filter(
        (model) =>
          modelImportDraft.selectedIds.has(model.id) &&
          !currentIds.has(model.id),
      )
      .map((model) => withModelMetadataDefaults({ ...model, enabled: true }));

    if (selectedModels.length === 0) {
      setStatus(STRINGS.model.selectModelToAdd, "error");
      return;
    }

    const nextDraft = {
      ...draft,
      providers: draft.providers.map((item) =>
        item.id === provider.id
          ? { ...item, models: [...item.models, ...selectedModels] }
          : item,
      ),
    };
    setModelImportDraft(null);
    await commitDraft(
      nextDraft,
      STRINGS.model.modelsImported(provider.name, selectedModels.length),
    );
  };

  const applyManualModel = async () => {
    if (!manualModelDraft || !draft) return;
    const modelId = manualModelDraft.modelId.trim();
    const provider = draft.providers.find(
      (item) => item.id === manualModelDraft.providerId,
    );
    if (!provider) {
      setManualModelDraft(null);
      return;
    }
    if (!modelId) {
      setStatus(STRINGS.model.modelIdRequired, "error");
      return;
    }
    if (provider.models.some((model) => model.id === modelId)) {
      setStatus(
        STRINGS.model.modelAlreadyExists(provider.name, modelId),
        "error",
      );
      return;
    }
    const nextDraft = {
      ...draft,
      providers: draft.providers.map((item) =>
        item.id === provider.id
          ? {
              ...item,
              models: [
                ...item.models,
                withModelMetadataDefaults({
                  id: modelId,
                  label: modelId,
                  enabled: true,
                }),
              ],
            }
          : item,
      ),
    };
    setManualModelDraft(null);
    await commitDraft(
      nextDraft,
      STRINGS.model.manualModelAdded(provider.name, modelId),
    );
  };

  const fetchProviderModels = async (providerId: string) => {
    if (!draft) return;
    const provider = draft.providers.find((item) => item.id === providerId);
    if (!provider) return;

    setFetchingModelIds((ids) => new Set(ids).add(providerId));
    setStatus(STRINGS.model.fetchingModels(provider.name));
    try {
      if (typeof window.marloues.config.listEndpointModels !== "function") {
        setStatus(STRINGS.model.preloadNotInjectedList, "error");
        return;
      }
      const result = await window.marloues.config.listEndpointModels(provider);
      if (!result.ok || result.models.length === 0) {
        setStatus(
          STRINGS.model.endpointResult(
            provider.name,
            result.message,
            result.latencyMs,
          ),
          "error",
        );
        return;
      }

      const currentIds = new Set(provider.models.map((model) => model.id));
      const discoveredModels = result.models
        .filter((model) => !currentIds.has(model.id))
        .map((model) => ({ ...model, enabled: false }));
      if (discoveredModels.length === 0) {
        setStatus(
          STRINGS.model.noNewModels(provider.name, result.latencyMs),
          "ok",
        );
        setModelImportDraft((current) =>
          current?.providerId === providerId ? null : current,
        );
        return;
      }

      setModelImportDraft({
        providerId,
        models: discoveredModels,
        selectedIds: new Set(),
      });
      setExpandedProviderIds((ids) => new Set(ids).add(providerId));
      setStatus(
        STRINGS.model.modelsDiscovered(
          provider.name,
          discoveredModels.length,
          result.latencyMs,
        ),
        "ok",
      );
    } finally {
      setFetchingModelIds((ids) => {
        const next = new Set(ids);
        next.delete(providerId);
        return next;
      });
    }
  };

  // ── Model CRUD ──────────────────────────────────────────────────

  const removeProviderModel = async (providerId: string, modelId: string) => {
    if (!draft) return;
    const provider = draft.providers.find((item) => item.id === providerId);
    if (!provider) return;
    const models = provider.models.filter((model) => model.id !== modelId);
    await commitDraft(
      {
        ...draft,
        providers: draft.providers.map((item) =>
          item.id === providerId ? { ...item, models } : item,
        ),
        defaultModel:
          draft.defaultModel.providerId === providerId &&
          draft.defaultModel.modelId === modelId
            ? {
                providerId,
                modelId:
                  models.find((model) => model.enabled)?.id ??
                  models[0]?.id ??
                  "",
              }
            : draft.defaultModel,
      },
      STRINGS.model.modelRemoved(provider.name, modelId),
    );
  };

  const updateProviderModel = async (
    providerId: string,
    modelId: string,
    patch: Partial<ModelOption>,
    message?: string,
  ) => {
    if (!draft) return;
    const provider = draft.providers.find((item) => item.id === providerId);
    const model = provider?.models.find((item) => item.id === modelId);
    if (!provider || !model) return;
    const nextDraft = {
      ...draft,
      providers: draft.providers.map((item) =>
        item.id === providerId
          ? {
              ...item,
              models: item.models.map((current) =>
                current.id === modelId
                  ? normalizeModelMetadataPatch({ ...current, ...patch })
                  : current,
              ),
            }
          : item,
      ),
    };
    await commitDraft(nextDraft, message);
  };

  const testProviderModel = async (
    provider: ModelProviderConfig,
    modelId: string,
  ) => {
    const checkId = `${provider.id}:${modelId}`;
    setCheckingModelIds((ids) => new Set(ids).add(checkId));
    setStatus(STRINGS.model.probingModel(modelId));
    try {
      if (typeof window.marloues.config.testEndpointModel !== "function") {
        setStatus(STRINGS.model.preloadNotInjectedProbe, "error");
        return;
      }
      const result = await window.marloues.config.testEndpointModel(
        provider,
        modelId,
      );
      setStatus(
        STRINGS.model.endpointResult(
          provider.name,
          result.message,
          result.latencyMs,
        ),
        result.ok ? "ok" : "error",
      );
    } finally {
      setCheckingModelIds((ids) => {
        const next = new Set(ids);
        next.delete(checkId);
        return next;
      });
    }
  };

  // ── Model UI helpers (extracted from inline JSX) ────────────────

  const setDefaultModel = async (
    providerId: string,
    modelId: string,
    modelTitle: string,
  ) => {
    if (!draft) return;
    const nextDraft = {
      ...draft,
      defaultModel: { providerId, modelId },
    };
    await commitDraft(nextDraft, STRINGS.model.setAsDefault(modelTitle));
  };

  const toggleModelEnabled = async (
    providerId: string,
    modelId: string,
    modelTitle: string,
  ) => {
    if (!draft) return;
    const provider = draft.providers.find((item) => item.id === providerId);
    const model = provider?.models.find((item) => item.id === modelId);
    if (!provider || !model) return;
    const nextDraft = {
      ...draft,
      providers: draft.providers.map((item) =>
        item.id === providerId
          ? {
              ...item,
              models: item.models.map((current) =>
                current.id === modelId
                  ? { ...current, enabled: !current.enabled }
                  : current,
              ),
            }
          : item,
      ),
    };
    await commitDraft(
      nextDraft,
      STRINGS.model.toggleModel(modelTitle, !model.enabled),
    );
  };

  // ── Effects (click-outside) ─────────────────────────────────────

  useEffect(() => {
    if (!manualModelDraft) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && manualModelRef.current?.contains(target))
        return;
      setManualModelDraft(null);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [manualModelDraft]);

  return {
    // State
    checkingEndpointIds,
    checkingModelIds,
    fetchingModelIds,
    expandedProviderIds,
    visibleApiKeyProviderIds,
    modelImportDraft,
    manualModelDraft,
    // Refs
    manualModelRef,
    // Setters
    setManualModelDraft,
    setModelImportDraft,
    setStatus,
    // Functions
    commitNewProvider,
    removeEndpointProfile,
    toggleProviderExpanded,
    openProviderDetail,
    closeProviderDetail,
    toggleApiKeyVisible,
    toggleModelImportSelection,
    applyModelImport,
    applyManualModel,
    fetchProviderModels,
    removeProviderModel,
    updateProviderModel,
    testProviderModel,
    updateProviderField,
    updateProviderEndpoint,
    addProviderEndpoint,
    removeProviderEndpoint,
    toggleProviderEnabled,
    testEndpointProfile,
    setDefaultModel,
    toggleModelEnabled,
  };
}

export type ProviderManagement = ReturnType<typeof useProviderManagement>;

function createProviderEndpoint(index: number): ModelProviderEndpoint {
  return {
    id: crypto.randomUUID(),
    name: `端点 ${index}`,
    protocol: "openai-chat",
    baseUrl: "",
    enabled: true,
    priority: index * 10,
  };
}
