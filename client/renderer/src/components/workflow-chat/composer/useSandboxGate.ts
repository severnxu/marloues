import { useCallback, useEffect, useState } from "react";
import type { AgentSecurityMode } from "@shared/types";

export function useSecurityModeGate(
  onSecurityModeChange?: (mode: AgentSecurityMode) => void,
  controlledSecurityMode?: AgentSecurityMode,
) {
  const [securityMode, setSecurityMode] = useState<AgentSecurityMode>(
    controlledSecurityMode ?? "request",
  );
  const [fullAccessConfirmationOpen, setFullAccessConfirmationOpen] =
    useState(false);

  useEffect(() => {
    if (!controlledSecurityMode) return;
    setSecurityMode(controlledSecurityMode);
  }, [controlledSecurityMode]);

  const handleSecurityModeSelect = useCallback(
    (mode: AgentSecurityMode) => {
      if (mode === "full-access" && securityMode !== "full-access") {
        setFullAccessConfirmationOpen(true);
        return;
      }
      setSecurityMode(mode);
      onSecurityModeChange?.(mode);
    },
    [onSecurityModeChange, securityMode],
  );

  const handleFullAccessConfirm = useCallback(() => {
    setSecurityMode("full-access");
    onSecurityModeChange?.("full-access");
    setFullAccessConfirmationOpen(false);
  }, [onSecurityModeChange]);

  const handleFullAccessCancel = useCallback(() => {
    setFullAccessConfirmationOpen(false);
  }, []);

  return {
    securityMode,
    fullAccessConfirmationOpen,
    handleSecurityModeSelect,
    handleFullAccessConfirm,
    handleFullAccessCancel,
  };
}
