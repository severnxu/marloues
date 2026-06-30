import * as React from "react";
import { cn } from "@/lib/utils";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** Apply theme rounded radius token instead of full pill. */
  rounded?: boolean;
  className?: string;
}

// Unique keyframes name to avoid collisions if this component is used many
// times; React will dedupe identical <style> tag text.
const SKELETON_STYLE = `
@keyframes marlouesSkeletonShimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
`;

/** Placeholder block shown while content is loading. */
export function Skeleton({
  width = "100%",
  height = 16,
  rounded = false,
  className,
}: SkeletonProps) {
  return (
    <>
      <style>{SKELETON_STYLE}</style>
      <div
        className={cn(className)}
        style={{
          width,
          height,
          borderRadius: rounded ? "var(--radius-md)" : 9999,
          border: "1px solid var(--border)",
          backgroundImage:
            "linear-gradient(90deg, var(--panel-2) 25%, color-mix(in srgb, var(--accent) 12%, var(--panel-2)) 50%, var(--panel-2) 75%)",
          backgroundSize: "200% 100%",
          animation: "marlouesSkeletonShimmer 1.6s ease-in-out infinite",
        }}
      />
    </>
  );
}
Skeleton.displayName = "Skeleton";
