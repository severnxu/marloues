import type { AnalyticsProvider, EventInfo } from "@shared/analytics";

/** 调试用 Provider：所有事件打印到 console，便于开发时观察埋点流 */
export class ConsoleAnalyticsProvider implements AnalyticsProvider {
  async init(): Promise<void> {
    console.info("[Analytics] Console provider initialized");
  }
  syncUser(user: { userId: string; env?: string } | null): void {
    console.info("[Analytics] syncUser:", user);
  }
  trackEvent(name: string, eventInfo?: EventInfo, eventValue?: string): void {
    console.info("[Analytics] event:", name, eventInfo ?? {}, eventValue ?? "");
  }
  trackPageView(pageId: string, eventInfo?: EventInfo): void {
    console.info("[Analytics] page:", pageId, eventInfo ?? {});
  }
  reportError(message: string, eventInfo?: EventInfo): void {
    console.error("[Analytics] error:", message, eventInfo ?? {});
  }
  reportWarn(message: string, eventInfo?: EventInfo): void {
    console.warn("[Analytics] warn:", message, eventInfo ?? {});
  }
}
