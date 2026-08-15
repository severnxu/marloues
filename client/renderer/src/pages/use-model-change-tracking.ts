/**
 * useModelChangeTracking — tracks model switches mid-conversation and shows
 * a warning notice when the model changes while a turn is streaming.
 *
 * Encapsulates:
 * - pendingModelChangeNotice state (shown as a divider in the message list)
 * - modelSwitchWarningVisible state (shown as a bubble in ModelSelector)
 * - session reset on activeSessionId change
 * - timer cleanup on unmount
 * - model change detection effect
 */

import { useState, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { notify } from "@/lib/notifications";
import type { AgentSettings } from "@shared/types";
import type { PendingModelChangeNotice } from "./workflow-chat-helpers";

export function useModelChangeTracking(
  activeSessionId: string | null | undefined,
  activeSessionIsStreaming: boolean,
  modelName: string,
  settings: AgentSettings | null,
): {
  pendingModelChangeNotice: PendingModelChangeNotice | null;
  setPendingModelChangeNotice: Dispatch<
    SetStateAction<PendingModelChangeNotice | null>
  >;
  modelSwitchWarningVisible: boolean;
} {
  const [pendingModelChangeNotice, setPendingModelChangeNotice] =
    useState<PendingModelChangeNotice | null>(null);
  const [modelSwitchWarningVisible, setModelSwitchWarningVisible] =
    useState(false);

  const lastModelRef = useRef<{ id: string; label: string } | null>(null);
  const modelSwitchWarningTimerRef = useRef<number | null>(null);

  // Reset model change notice + warning when switching sessions.
  useEffect(() => {
    setPendingModelChangeNotice(null);
    setModelSwitchWarningVisible(false);
  }, [activeSessionId]);

  // Cleanup warning timer on unmount.
  useEffect(() => {
    return () => {
      if (modelSwitchWarningTimerRef.current != null) {
        window.clearTimeout(modelSwitchWarningTimerRef.current);
      }
    };
  }, []);

  // Detect model changes while streaming and surface a notice.
  useEffect(() => {
    if (!settings || !activeSessionId) return;
    const currentModel = {
      id: `${settings.defaultModel.providerId}:${settings.defaultModel.modelId}`,
      label: modelName,
    };
    const previousModel = lastModelRef.current;
    lastModelRef.current = currentModel;
    if (!previousModel || previousModel.id === currentModel.id) return;
    if (!activeSessionIsStreaming) return;

    setPendingModelChangeNotice((existing) => {
      if (
        existing?.sessionId === activeSessionId &&
        !existing.beforeUserMessageId
      ) {
        if (existing.fromModel === currentModel.label) return null;
        return { ...existing, toModel: currentModel.label };
      }

      notify({
        title: "在对话过程中切换模型会降低性能表现。",
        tone: "info",
      });
      setModelSwitchWarningVisible(true);
      if (modelSwitchWarningTimerRef.current != null) {
        window.clearTimeout(modelSwitchWarningTimerRef.current);
      }
      modelSwitchWarningTimerRef.current = window.setTimeout(() => {
        setModelSwitchWarningVisible(false);
        modelSwitchWarningTimerRef.current = null;
      }, 2400);

      return {
        id: `${Date.now()}-${currentModel.id}`,
        sessionId: activeSessionId,
        fromModel: previousModel.label,
        toModel: currentModel.label,
      };
    });
  }, [activeSessionId, activeSessionIsStreaming, modelName, settings]);

  return {
    pendingModelChangeNotice,
    setPendingModelChangeNotice,
    modelSwitchWarningVisible,
  };
}
