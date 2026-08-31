import { useEffect, useRef } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useThemeStore } from "@/stores/theme-store";

/**
 * Resolve Marloues CSS tokens to concrete rgb(a) colors. xterm parses colors
 * outside the normal CSS cascade, so passing `var(--token)` directly would
 * fall back to its built-in black theme.
 */
function readTerminalTheme(container: HTMLElement): ITheme {
  const document = container.ownerDocument;
  const view = document.defaultView;
  if (!view) return {};

  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none;width:0;height:0";
  container.appendChild(probe);

  const resolveColor = (expression: string, fallback: string): string => {
    probe.style.color = expression;
    return view.getComputedStyle(probe).color.trim() || fallback;
  };

  try {
    const background = resolveColor("var(--surface-workspace)", "#212121");
    const foreground = resolveColor("var(--text-1)", "#ebebeb");
    const muted = resolveColor("var(--text-3)", "#858585");
    const accent = resolveColor("var(--accent)", "#3d9bff");
    const danger = resolveColor("var(--danger)", "#ff5f57");
    const success = resolveColor("var(--success)", "#28c840");
    const warning = resolveColor("var(--warning)", "#febc2e");
    const magenta = resolveColor(
      "color-mix(in srgb, var(--accent) 58%, var(--danger))",
      "#c678dd",
    );
    const cyan = resolveColor(
      "color-mix(in srgb, var(--accent) 58%, var(--success))",
      "#56b6c2",
    );
    const brighter = (color: string): string =>
      resolveColor(`color-mix(in srgb, ${color} 78%, var(--text-1))`, color);

    return {
      background,
      foreground,
      cursor: accent,
      cursorAccent: background,
      selectionBackground: resolveColor(
        "color-mix(in srgb, var(--accent) 28%, transparent)",
        "rgba(61, 155, 255, 0.28)",
      ),
      selectionForeground: foreground,
      selectionInactiveBackground: resolveColor(
        "color-mix(in srgb, var(--accent) 16%, transparent)",
        "rgba(61, 155, 255, 0.16)",
      ),
      black: foreground,
      red: danger,
      green: success,
      yellow: warning,
      blue: accent,
      magenta,
      cyan,
      white: resolveColor("var(--text-2)", "#c8c8c8"),
      brightBlack: muted,
      brightRed: brighter(danger),
      brightGreen: brighter(success),
      brightYellow: brighter(warning),
      brightBlue: brighter(accent),
      brightMagenta: brighter(magenta),
      brightCyan: brighter(cyan),
      brightWhite: foreground,
    };
  } finally {
    probe.remove();
  }
}

/**
 * Renders a single PTY session in an xterm instance.
 * The panel is always mounted by AuxiliaryViewPanel (hidden when inactive),
 * so the xterm buffer persists across tab switches.
 */
export function TerminalPanel({ sessionId }: { sessionId?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const themeMode = useThemeStore((state) => state.mode);
  const accentColor = useThemeStore((state) => state.accentColor);
  const isDark = useThemeStore((state) => state.isDark);

  useEffect(() => {
    if (!containerRef.current || !sessionId) return;
    const container = containerRef.current;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "var(--font-mono, Menlo, monospace)",
      scrollback: 5000,
      theme: readTerminalTheme(container),
    });
    terminalRef.current = term;
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
      if (terminalRef.current === term) terminalRef.current = null;
      offData?.();
      offExit?.();
      inputDisposable.dispose();
      observer.disconnect();
      term.dispose();
    };
  }, [sessionId]);

  // Update the existing xterm instance in place so theme changes preserve the
  // terminal buffer, cursor position, selection, and PTY session.
  useEffect(() => {
    const terminal = terminalRef.current;
    const container = containerRef.current;
    if (!terminal || !container) return;

    const frame = requestAnimationFrame(() => {
      if (terminalRef.current === terminal) {
        terminal.options.theme = readTerminalTheme(container);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [accentColor, isDark, themeMode]);

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
