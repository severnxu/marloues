import { EventEmitter } from "node:events";
import { spawn as ptySpawn, type IPty } from "node-pty";
import { logInfo, logWarn } from "../core/logging/app-logger";

export interface TerminalSessionInfo {
  sessionId: string;
  threadId?: string;
  pid: number;
  process: string;
  cwd: string;
  createdAt: number;
  lastOutputAt: number;
  rendererAttached: boolean;
}

export interface TerminalReadResult {
  data: string;
  stable: boolean;
  exitCode?: number;
}

interface SessionState {
  pty: IPty;
  threadId?: string;
  cwd: string;
  createdAt: number;
  lastOutputAt: number;
  rendererAttached: boolean;
  buffer: string;
  readCursor: number;
  exitCode?: number;
  exited: boolean;
  dataDisposable: { dispose: () => void };
  exitDisposable: { dispose: () => void };
  idleTimer?: ReturnType<typeof setTimeout>;
}

const MAX_SESSIONS = 8;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_BUFFER_SIZE = 1024 * 1024; // 1MB per session

/**
 * Main-process singleton managing PTY sessions via node-pty.
 * Sessions are isolated by threadId and survive across turns.
 */
class TerminalServiceImpl extends EventEmitter {
  private readonly sessions = new Map<string, SessionState>();

  spawn(
    cwd: string,
    opts?: { threadId?: string; cols?: number; rows?: number },
  ): string {
    if (this.sessions.size >= MAX_SESSIONS) {
      // Evict the oldest idle session
      const oldest = this.findOldestIdle();
      if (oldest) {
        this.killInternal(oldest, "max-sessions-evict");
      } else {
        throw new Error("Maximum terminal sessions reached.");
      }
    }

    const sessionId = crypto.randomUUID();
    const shell = this.resolveShell();
    const pty = ptySpawn(shell.executable, shell.args, {
      name: "xterm-256color",
      cols: opts?.cols ?? 80,
      rows: opts?.rows ?? 24,
      cwd,
      env: process.env as Record<string, string>,
      encoding: "utf8",
    });

    const state: SessionState = {
      pty,
      threadId: opts?.threadId,
      cwd,
      createdAt: Date.now(),
      lastOutputAt: Date.now(),
      rendererAttached: false,
      buffer: "",
      readCursor: 0,
      exited: false,
      dataDisposable: pty.onData((data) => this.onPtyData(sessionId, data)),
      exitDisposable: pty.onExit((e) => this.onPtyExit(sessionId, e.exitCode)),
    };

    this.sessions.set(sessionId, state);
    this.resetIdleTimer(sessionId);
    logInfo("terminal.spawn", {
      sessionId,
      threadId: opts?.threadId,
      pid: pty.pid,
    });
    return sessionId;
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.exited) {
      throw new Error(`Terminal session ${sessionId} not found or exited.`);
    }
    session.pty.write(data);
    // Audit is handled by the caller (canUseTool short-circuit writes to auditTrail)
    this.resetIdleTimer(sessionId);
  }

  read(sessionId: string): TerminalReadResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { data: "", stable: true };
    }
    const data = session.buffer.slice(session.readCursor);
    session.readCursor = session.buffer.length;
    return {
      data,
      stable: session.exited,
      exitCode: session.exitCode,
    };
  }

  async readUntilStable(
    sessionId: string,
    silenceWindowMs = 300,
    totalTimeoutMs = 5000,
  ): Promise<TerminalReadResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { data: "", stable: true };
    }

    const start = Date.now();
    let lastDataLen = session.buffer.length;
    let stableSince = start;

    return new Promise((resolve) => {
      const check = () => {
        const now = Date.now();
        const currentLen = session.buffer.length;
        if (currentLen > lastDataLen) {
          lastDataLen = currentLen;
          stableSince = now;
        }
        const elapsed = now - start;
        const silent = now - stableSince;
        const exited = session.exited;

        if (
          exited ||
          (silent >= silenceWindowMs && elapsed >= silenceWindowMs * 2)
        ) {
          const data = session.buffer.slice(session.readCursor);
          session.readCursor = session.buffer.length;
          resolve({ data, stable: true, exitCode: session.exitCode });
          return;
        }
        if (elapsed >= totalTimeoutMs) {
          const data = session.buffer.slice(session.readCursor);
          session.readCursor = session.buffer.length;
          resolve({ data, stable: false, exitCode: session.exitCode });
          return;
        }
        setTimeout(check, 50);
      };
      setTimeout(check, silenceWindowMs);
    });
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.exited) return;
    try {
      session.pty.resize(cols, rows);
    } catch {
      // best-effort
    }
    this.resetIdleTimer(sessionId);
  }

  kill(sessionId: string): void {
    this.killInternal(sessionId, "user-requested");
  }

  listSessions(threadId?: string): TerminalSessionInfo[] {
    const results: TerminalSessionInfo[] = [];
    for (const [sessionId, state] of this.sessions) {
      if (threadId && state.threadId !== threadId) continue;
      results.push({
        sessionId,
        threadId: state.threadId,
        pid: state.pty.pid,
        process: state.pty.process,
        cwd: state.cwd,
        createdAt: state.createdAt,
        lastOutputAt: state.lastOutputAt,
        rendererAttached: state.rendererAttached,
      });
    }
    return results;
  }

  getHistory(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    return session?.buffer ?? "";
  }

  setRendererAttached(sessionId: string, attached: boolean): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.rendererAttached = attached;
      this.resetIdleTimer(sessionId);
    }
  }

  killByThread(threadId: string): void {
    for (const [sessionId, state] of this.sessions) {
      if (state.threadId === threadId) {
        this.killInternal(sessionId, "thread-cleanup");
      }
    }
  }

  clearByThread(threadId: string): void {
    this.killByThread(threadId);
  }

  private onPtyData(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.buffer += data;
    session.lastOutputAt = Date.now();
    // Cap buffer to prevent unbounded growth
    if (session.buffer.length > MAX_BUFFER_SIZE) {
      const excess = session.buffer.length - MAX_BUFFER_SIZE;
      session.buffer = session.buffer.slice(excess);
      // Adjust readCursor if it's now past the start
      if (session.readCursor > excess) {
        session.readCursor -= excess;
      } else {
        session.readCursor = 0;
      }
    }
    this.emit("data", sessionId, data);
    this.resetIdleTimer(sessionId);
  }

  private onPtyExit(sessionId: string, exitCode: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.exited = true;
    session.exitCode = exitCode;
    this.emit("exit", sessionId, exitCode);
    logInfo("terminal.exit", { sessionId, exitCode });
    // Auto-cleanup after a delay to allow final read
    setTimeout(() => {
      this.killInternal(sessionId, "post-exit-cleanup");
    }, 5000);
  }

  private killInternal(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      session.dataDisposable.dispose();
      session.exitDisposable.dispose();
      if (!session.exited) {
        session.pty.kill();
      }
    } catch {
      // best-effort
    }
    if (session.idleTimer) clearTimeout(session.idleTimer);
    this.sessions.delete(sessionId);
    logInfo("terminal.kill", { sessionId, reason });
  }

  private resetIdleTimer(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      // Only kill if no renderer attached and no recent output
      if (!session.rendererAttached && !session.exited) {
        const idle = Date.now() - session.lastOutputAt;
        if (idle >= IDLE_TIMEOUT_MS) {
          logWarn("terminal.idleTimeout", { sessionId, idleMs: idle });
          this.killInternal(sessionId, "idle-timeout");
        }
      }
    }, IDLE_TIMEOUT_MS);
  }

  private findOldestIdle(): string | undefined {
    let oldest: string | undefined;
    let oldestTime = Date.now();
    for (const [sessionId, state] of this.sessions) {
      if (!state.rendererAttached && state.lastOutputAt < oldestTime) {
        oldestTime = state.lastOutputAt;
        oldest = sessionId;
      }
    }
    return oldest;
  }

  private resolveShell(): { executable: string; args: string[] } {
    if (process.platform === "win32") {
      // Prefer PowerShell 7+, fall back to Windows PowerShell
      return {
        executable: "powershell.exe",
        args: ["-NoLogo", "-NoProfile"],
      };
    }
    return {
      executable: process.env.SHELL || "/bin/zsh",
      args: ["-l"],
    };
  }
}

export const terminalService = new TerminalServiceImpl();
