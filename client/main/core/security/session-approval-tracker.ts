/**
 * Per-thread approval tracker that survives across turns.
 *
 * When a user approves terminal.exec, the session is marked approved,
 * and subsequent terminal.write/read/resize calls are auto-allowed
 * (with audit) without re-prompting. Same pattern for browser.navigate
 * → browser.click/fill/screenshot/get_text.
 *
 * Lives as a ClaudeRuntime instance field (not per-turn). Cleared on
 * thread deletion, manual user clear, or TTL expiry (30 min).
 */
export class SessionApprovalTracker {
  private readonly sessions = new Map<string, number>();
  private readonly pages = new Map<string, number>();
  private readonly TTL_MS = 30 * 60 * 1000;

  markSessionApproved(sessionId: string): void {
    this.sessions.set(sessionId, Date.now());
  }

  markPageApproved(pageId: string): void {
    this.pages.set(pageId, Date.now());
  }

  isSessionApproved(sessionId: string): boolean {
    const ts = this.sessions.get(sessionId);
    if (!ts) return false;
    if (Date.now() - ts > this.TTL_MS) {
      this.sessions.delete(sessionId);
      return false;
    }
    return true;
  }

  isPageApproved(pageId: string): boolean {
    const ts = this.pages.get(pageId);
    if (!ts) return false;
    if (Date.now() - ts > this.TTL_MS) {
      this.pages.delete(pageId);
      return false;
    }
    return true;
  }

  clear(): void {
    this.sessions.clear();
    this.pages.clear();
  }
}
