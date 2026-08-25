import { useCallback, useEffect, useState } from "react";
import type { AgentSandboxMode } from "@shared/types";
import type { ComposerAccessLevel, SandboxGateState } from "./composer-types";

export function useSandboxGate(
  onAccessLevelChange?: (level: ComposerAccessLevel) => void,
  controlledAccessLevel?: ComposerAccessLevel,
  onSandboxModeChange?: (mode: AgentSandboxMode) => void,
  controlledSandboxMode?: AgentSandboxMode,
) {
  const [accessLevel, setAccessLevel] = useState<ComposerAccessLevel>(
    controlledAccessLevel ?? "default",
  );
  const [sandboxMode, setSandboxMode] = useState<AgentSandboxMode>(
    controlledSandboxMode ?? "workspace-write",
  );
  const [pendingSandboxMode, setPendingSandboxMode] =
    useState<AgentSandboxMode | null>(null);
  const [sandboxGate, setSandboxGate] = useState<SandboxGateState>(null);

  useEffect(() => {
    if (!controlledAccessLevel) return;
    setAccessLevel(controlledAccessLevel);
  }, [controlledAccessLevel]);

  useEffect(() => {
    if (!controlledSandboxMode) return;
    setSandboxMode(controlledSandboxMode);
  }, [controlledSandboxMode]);

  const handleAccessSelect = useCallback(
    (level: ComposerAccessLevel) => {
      setSandboxGate(null);
      setAccessLevel(level);
      onAccessLevelChange?.(level);
    },
    [onAccessLevelChange],
  );

  const handleSandboxSelect = useCallback(
    (mode: AgentSandboxMode) => {
      if (mode === "danger-full-access") {
        setPendingSandboxMode(mode);
        setSandboxGate({
          phase: "prompt",
          message: "关闭沙箱后，命令可访问工作区外的文件和系统资源。",
        });
        return;
      }
      setPendingSandboxMode(null);
      setSandboxGate(null);
      setSandboxMode(mode);
      onSandboxModeChange?.(mode);
    },
    [onSandboxModeChange],
  );

  const handleSandboxConfirm = useCallback(async () => {
    if (pendingSandboxMode) {
      setSandboxMode(pendingSandboxMode);
      onSandboxModeChange?.(pendingSandboxMode);
    }
    setPendingSandboxMode(null);
    setSandboxGate(null);
  }, [onSandboxModeChange, pendingSandboxMode]);

  const handleSandboxCancel = useCallback(() => {
    setPendingSandboxMode(null);
    setSandboxGate(null);
  }, []);

  return {
    accessLevel,
    sandboxMode,
    sandboxGate,
    handleAccessSelect,
    handleSandboxSelect,
    handleSandboxConfirm,
    handleSandboxCancel,
  };
}
