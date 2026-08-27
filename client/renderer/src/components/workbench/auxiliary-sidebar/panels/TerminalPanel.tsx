import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

/**
 * Renders a single PTY session in an xterm instance.
 * The panel is always mounted by AuxiliaryViewPanel (hidden when inactive),
 * so the xterm buffer persists across tab switches.
 */
export function TerminalPanel({ sessionId }: { sessionId?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !sessionId) return;
    const container = containerRef.current;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "var(--font-mono, Menlo, monospace)",
      scrollback: 5000,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    // Initial fit + size sync (deferred so the container has layout)
    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
        window.marloues.terminal?.resize(sessionId, term.cols, term.rows);
      } catch {
        // container not visible yet — will retry on ResizeObserver
      }
    });

    // Replay history for reload recovery
    void window.marloues.terminal?.history(sessionId).then((history) => {
      if (history) term.write(history);
    });

    // PTY output -> xterm
    const offData = window.marloues.terminal?.onData((sid, data) => {
      if (sid === sessionId) term.write(data);
    });
    const offExit = window.marloues.terminal?.onExit((sid, exitCode) => {
      if (sid === sessionId) {
        term.write(
          `\r\n\x1b[90m[process exited with code ${exitCode}]\x1b[0m\r\n`,
        );
      }
    });

    // xterm input -> PTY
    const inputDisposable = term.onData((data) => {
      void window.marloues.terminal?.write(sessionId, data);
    });
    term.onResize(() => {
      void window.marloues.terminal?.resize(sessionId, term.cols, term.rows);
    });

    // Keep terminal fitted to container
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore — container might be hidden
      }
    });
    observer.observe(container);

    return () => {
      offData?.();
      offExit?.();
      inputDisposable.dispose();
      observer.disconnect();
      term.dispose();
    };
  }, [sessionId]);

  if (!sessionId) {
    return (
      <div className="terminal-panel-empty">
        <p>终端会话未初始化</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="terminal-panel-container"
      style={{ width: "100%", height: "100%", overflow: "hidden" }}
    />
  );
}
