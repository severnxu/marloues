import { useEffect, useId, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Cpu,
  LoaderCircle,
  TerminalSquare,
} from "lucide-react";
import { notify } from "@/lib/notifications";
import { runtimePresentation } from "@/lib/runtime-presentation";
import { useSettingsStore } from "@/stores/settings-store";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import type { RuntimeKind } from "@shared/types";

export function RuntimeSelector() {
  const runtimeState = useSettingsStore((state) => state.runtimeState);
  const switchingRuntimeId = useSettingsStore(
    (state) => state.switchingRuntimeId,
  );
  const switchRuntime = useSettingsStore((state) => state.switchRuntime);
  const hasRunningTask = useUnifiedChatStore((state) => state.isStreaming);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const activeRuntimeId = runtimeState?.activeRuntimeId ?? "sdk";
  const active = runtimePresentation(activeRuntimeId);
  const busy = Boolean(switchingRuntimeId);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
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

  const handleSelect = async (runtimeId: RuntimeKind) => {
    if (runtimeId === activeRuntimeId || hasRunningTask || busy) {
      setOpen(false);
      return;
    }
    try {
      await switchRuntime(runtimeId);
      setOpen(false);
      notify({
        title: `已切换到 ${runtimePresentation(runtimeId).label}`,
        description: `后续任务将使用 ${runtimePresentation(runtimeId).protocol} 协议路由模型。`,
        tone: "success",
      });
    } catch (error) {
      notify({
        title: "运行时切换失败",
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    }
  };

  if (!runtimeState) return null;

  return (
    <div className="runtime-selector-surface" ref={menuRef}>
      <button
        ref={triggerRef}
        type="button"
        className="runtime-chip"
        aria-label={`运行时：${active.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={busy}
        title={
          hasRunningTask
            ? "任务执行期间不能切换运行时"
            : `${active.label} · ${active.protocol}`
        }
        onClick={() => setOpen((value) => !value)}
      >
        {busy ? (
          <LoaderCircle className="runtime-spinner" size={14} />
        ) : (
          <Cpu size={14} />
        )}
        <strong>{active.label}</strong>
        <ChevronDown size={14} />
      </button>

      {open ? (
        <div
          id={menuId}
          className="composer-popover runtime-popover"
          role="menu"
          aria-label="选择运行时"
        >
          <div className="popover-title">选择运行时</div>
          <div className="runtime-option-list">
            {runtimeState.runtimes.map((runtime) => {
              const presentation = runtimePresentation(runtime.id);
              const isActive = runtime.id === activeRuntimeId;
              const disabled =
                runtime.status !== "available" || hasRunningTask || busy;
              return (
                <button
                  key={runtime.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  disabled={disabled}
                  className={`runtime-option ${isActive ? "active" : ""}`}
                  onClick={() => void handleSelect(runtime.id)}
                  title={runtime.statusReason}
                >
                  <span className="runtime-option-icon">
                    {runtime.id === "binary" ? (
                      <TerminalSquare size={15} />
                    ) : (
                      <Cpu size={15} />
                    )}
                  </span>
                  <span className="runtime-option-copy">
                    <strong>{presentation.label}</strong>
                    <small>{presentation.description}</small>
                  </span>
                  <span className="runtime-protocol">
                    {presentation.protocol}
                  </span>
                  {isActive ? (
                    <Check className="runtime-check" size={15} />
                  ) : null}
                </button>
              );
            })}
          </div>
          {hasRunningTask ? (
            <p className="runtime-popover-note">任务结束后可以切换运行时。</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
