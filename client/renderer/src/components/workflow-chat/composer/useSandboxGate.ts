import { useCallback, useState } from "react";
import type { ComposerAccessLevel, SandboxGateState } from "./composer-types";

export function useSandboxGate(
  onAccessLevelChange?: (level: ComposerAccessLevel) => void,
) {
  const [accessLevel, setAccessLevel] =
    useState<ComposerAccessLevel>("default");
  const [sandboxGate, setSandboxGate] = useState<SandboxGateState>(null);

  // Marloues has no bundled sandbox backend yet: "full" access is granted
  // directly without an install gate.
  const handleAccessSelect = useCallback(
    (level: ComposerAccessLevel) => {
      setSandboxGate(null);
      setAccessLevel(level);
      onAccessLevelChange?.(level);
    },
    [onAccessLevelChange],
  );

  const handleSandboxConfirm = useCallback(async () => {
    setSandboxGate(null);
  }, []);

  const handleSandboxCancel = useCallback(() => {
    setSandboxGate(null);
  }, []);

  return {
    accessLevel,
    sandboxGate,
    handleAccessSelect,
    handleSandboxConfirm,
    handleSandboxCancel,
  };
}
