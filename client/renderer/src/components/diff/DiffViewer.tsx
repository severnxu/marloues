import { memo } from "react";
import type { ReactElement } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { useThemeStore } from "@/stores/theme-store";

export type DiffViewerProps = {
  /** Original (before) content. */
  oldValue: string;
  /** Updated (after) content. */
  newValue: string;
  /** Language label used for code-style rendering hints (informational). */
  language?: string;
  /** When true (default) renders split view; false renders inline/unified. */
  splitView?: boolean;
  /** Number of unchanged context lines surrounding each diff hunk. */
  extraLinesSurroundingDiff?: number;
  /** When true, disables word-level diff (faster for large inputs). */
  disableWordDiff?: boolean;
  /** Optional className applied to the host wrapper. */
  className?: string;
};

/**
 * Lightweight wrapper around react-diff-viewer-continued for line-level diffs.
 *
 * Theme is derived from the marloues theme store so the viewer follows the
 * active dark/light/warm mode. Styling is intentionally minimal; the component
 * can be enhanced later with custom styles and syntax highlighting.
 */
function DiffViewerImpl(props: DiffViewerProps): ReactElement {
  const {
    oldValue,
    newValue,
    language,
    splitView = true,
    extraLinesSurroundingDiff = 3,
    disableWordDiff = false,
    className,
  } = props;
  const isDark = useThemeStore((state) => state.isDark);

  return (
    <div
      className={["marloues-diff-viewer", className].filter(Boolean).join(" ")}
      data-language={language ?? "text"}
    >
      <ReactDiffViewer
        oldValue={oldValue}
        newValue={newValue}
        splitView={splitView}
        useDarkTheme={isDark}
        compareMethod={DiffMethod.LINES}
        extraLinesSurroundingDiff={extraLinesSurroundingDiff}
        disableWordDiff={disableWordDiff}
        hideLineNumbers={false}
      />
    </div>
  );
}

export const DiffViewer = memo(DiffViewerImpl);
