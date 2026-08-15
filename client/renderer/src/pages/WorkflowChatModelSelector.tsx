/**
 * ModelSelector — provider/model selection popover for the composer.
 * Extracted from WorkflowChatPage.
 */

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";

export function ModelSelector({
  switchWarningVisible = false,
}: {
  switchWarningVisible?: boolean;
}) {
  const settings = useSettingsStore((s) => s.settings);
  const setModel = useSettingsStore((s) => s.setModel);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const providerGroups =
    settings?.providers
      .filter((provider) => provider.enabled)
      .map((provider) => ({
        provider,
        models: provider.models.filter((model) => model.enabled),
      }))
      .filter((group) => group.models.length > 0) ?? [];
  const currentModelId = settings?.defaultModel.modelId;
  const currentProviderId = settings?.defaultModel.providerId;
  const currentProvider = settings?.providers.find(
    (provider) => provider.id === currentProviderId,
  );
  const currentModel = currentProvider?.models.find(
    (model) => model.id === currentModelId,
  );
  const currentProviderLabel =
    currentProvider?.name ?? currentProviderId ?? "provider";
  const currentLabel = currentModel?.label ?? currentModelId ?? "local-loop";

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (providerGroups.length === 0) return null;

  return (
    <div className="model-selector-surface" ref={menuRef}>
      {switchWarningVisible ? (
        <div className="model-switch-warning-bubble" role="status">
          在对话过程中切换模型会降低性能表现。
        </div>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="model-chip"
        title={`${currentProviderLabel} / ${currentLabel}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
      >
        <span>{currentProviderLabel}</span>
        <strong>{currentLabel}</strong>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          id={menuId}
          className="composer-popover model-popover"
          role="menu"
          aria-label="选择模型"
        >
          <div className="popover-title">选择模型</div>
          <div className="model-option-list">
            {providerGroups.map(({ provider, models }) => (
              <div
                className="model-provider-group"
                key={provider.id}
                role="group"
                aria-label={provider.name}
              >
                <div className="model-provider-label">
                  <span>{provider.name}</span>
                  <small>{provider.purpose ?? "endpoint"}</small>
                </div>
                {models.map((model) => {
                  const isActive =
                    provider.id === currentProviderId &&
                    model.id === currentModelId;
                  return (
                    <button
                      key={`${provider.id}:${model.id}`}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isActive}
                      onClick={() => {
                        void setModel(provider.id, model.id);
                        setOpen(false);
                      }}
                      className={`model-option ${isActive ? "active" : ""}`}
                    >
                      <span className="model-avatar">
                        {(provider.name || model.label || model.id || "M")
                          .slice(0, 1)
                          .toUpperCase()}
                      </span>
                      <span>
                        <strong>{model.label || model.id}</strong>
                        <small>{isActive ? "当前路由模型" : model.id}</small>
                      </span>
                      {isActive ? <Check size={16} /> : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
