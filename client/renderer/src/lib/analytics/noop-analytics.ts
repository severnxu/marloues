import type { AnalyticsProvider } from "@shared/analytics";

/** 默认空实现，所有方法 no-op，无任何副作用 */
export class NoopAnalyticsProvider implements AnalyticsProvider {
  async init(): Promise<void> {
    // no-op
  }
  syncUser(): void {
    // no-op
  }
  trackEvent(): void {
    // no-op
  }
  trackPageView(): void {
    // no-op
  }
  reportError(): void {
    // no-op
  }
  reportWarn(): void {
    // no-op
  }
}
