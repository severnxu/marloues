import { useAuthStore } from "@/stores/auth-store";

/**
 * Auth gate — shows login page when unauthenticated, children otherwise.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const phase = useAuthStore((state) => state.phase);

  // For Phase 1, skip auth gate and render directly.
  if (phase === "anonymous") {
    // Allow unauthenticated access for now — auth gate is a shell
  }

  return <>{children}</>;
}
