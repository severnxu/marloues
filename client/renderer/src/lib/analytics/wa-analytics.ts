/**
 * WA 上报 Provider — 封装 @webank/wa-sdk，上报到公司内部 WA 平台。
 *
 * init 配置与 marloues-client/src/renderer/services/tracking.ts 完全一致：
 * lazy + route=false + perf=false + device=false + errorCatch=false，
 * syncUser 后 startReport() 启动延迟上报。
 *
 * 对齐 marloues-client/src/renderer/services/tracking.ts：
 * - syncUser 调用 setOpenId + setParam(user_id/user_env) + startReport
 * - reportError / reportWarn 通过 wa.error() / wa.warn() 上报
 */
import { MARLOUES_ENV } from "@shared/env";
import type {
  AnalyticsProvider,
  AnalyticsUser,
  EventInfo,
} from "@shared/analytics";

/** WA env：直接透传 MARLOUES_ANALYTICS_ENV（test/release/adm） */
function resolveWaEnv(): string {
  return MARLOUES_ENV.analyticsEnv || "test";
}

/** 将内部 EventInfo 转为 wa-sdk 兼容格式：剔除 null/undefined/boolean */
function toWaEventInfo(info?: EventInfo): Record<string, string | number> {
  if (!info) return {};
  const result: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(info)) {
    if (v == null || typeof v === "boolean") continue;
    result[k] = v;
  }
  return result;
}

/** wa-sdk 最小类型面：只声明本项目用到的 API，避免引入公司私有包类型。 */
interface WaSdkModule {
  init?: (options: Record<string, unknown>) => Promise<void>;
  setParam?: (key: string, value: string) => void;
  setOpenId?: (payload: { wx_openid: string }) => void;
  startReport?: () => void;
  track?: {
    (
      name: string,
      eventInfo?: Record<string, string | number>,
      eventValue?: string,
    ): void;
    page?: (
      pageId: string,
      opts?: { eventInfo?: Record<string, string | number> },
    ) => void;
  };
  error?: (
    message: string,
    eventInfo?: Record<string, string | number>,
  ) => void;
  warn?: (message: string, eventInfo?: Record<string, string | number>) => void;
}

export class WaAnalyticsProvider implements AnalyticsProvider {
  private ready = false;
  private started = false;
  private initPromise: Promise<void> | null = null;
  private waModule: WaSdkModule | null = null;
  private get waInstance(): WaSdkModule {
    return this.waModule ?? {};
  }

  async init(): Promise<void> {
    if (this.ready) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    await this.initPromise;
  }

  private async doInit(): Promise<void> {
    const waAppId = MARLOUES_ENV.analyticsAppId;
    if (!waAppId) {
      console.warn(
        "[Analytics] WA provider 需要配置 MARLOUES_ANALYTICS_APP_ID，当前为空，跳过初始化。",
      );
      return;
    }
    try {
      // 与 marloues-client initTracking() 完全一致的配置
      if (!this.waModule) {
        try {
          const modName = "@webank/wa-sdk" as const;
          const mod = await import(modName);
          this.waModule =
            (mod as { default?: WaSdkModule }).default ??
            (mod as unknown as WaSdkModule);
        } catch (importErr) {
          console.warn(
            "[Analytics] @webank/wa-sdk 不可用（公司私有包未安装），WA 上报已自动跳过：",
            importErr,
          );
          return;
        }
      }
      const waModule = this.waModule;
      if (!waModule) return;
      await waModule.init?.({
        waAppId,
        subAppId: MARLOUES_ENV.analyticsSubAppId || waAppId,
        env: resolveWaEnv(),
        protocol: MARLOUES_ENV.analyticsProtocol as "ipv4" | "ipv6",
        debug: MARLOUES_ENV.analyticsDebug,
        route: false,
        lazy: true,
        perf: false,
        device: false,
        errorCatch: false,
      });
      this.ready = true;
      console.info(
        `[Analytics] WA provider 已初始化 (appId=${waAppId}, env=${resolveWaEnv()})`,
      );
    } catch (err) {
      console.error("[Analytics] WA init 失败，埋点将不可用：", err);
    }
  }

  syncUser(user: AnalyticsUser | null): void {
    if (!this.ready || !user) return;
    try {
      // 对齐 marloues-client syncTrackingUser
      const waInstance = this.waInstance;
      waInstance.setParam?.("user_id", user.userId);
      if (user.env) waInstance.setParam?.("user_env", user.env);
      if (typeof waInstance.setOpenId === "function") {
        waInstance.setOpenId({ wx_openid: user.userId });
      } else {
        waInstance.setParam?.("wx_openid", user.userId);
      }
      // lazy 模式：首次 syncUser 后启动上报（对齐 marloues-client）
      if (!this.started) {
        waInstance.startReport?.();
        this.started = true;
      }
    } catch (err) {
      console.error("[Analytics] WA syncUser 失败:", err);
    }
  }

  trackEvent(name: string, eventInfo?: EventInfo, eventValue?: string): void {
    if (!this.ready) return;
    try {
      this.waInstance.track?.(name, toWaEventInfo(eventInfo), eventValue);
    } catch (err) {
      console.error("[Analytics] WA trackEvent 失败:", err);
    }
  }

  trackPageView(pageId: string, eventInfo?: EventInfo): void {
    if (!this.ready) return;
    try {
      const waInstance = this.waInstance;
      if (waInstance.track?.page) {
        waInstance.track.page(pageId, { eventInfo: toWaEventInfo(eventInfo) });
        return;
      }
      waInstance.track?.(pageId, toWaEventInfo(eventInfo));
    } catch (err) {
      console.error("[Analytics] WA trackPageView 失败:", err);
    }
  }
  reportError(message: string, eventInfo?: EventInfo): void {
    if (!this.ready) return;
    try {
      this.waInstance.error?.(message, toWaEventInfo(eventInfo));
    } catch (err) {
      console.error("[Analytics] WA reportError 失败:", err);
    }
  }

  reportWarn(message: string, eventInfo?: EventInfo): void {
    if (!this.ready) return;
    try {
      this.waInstance.warn?.(message, toWaEventInfo(eventInfo));
    } catch (err) {
      console.error("[Analytics] WA reportWarn 失败:", err);
    }
  }
}
